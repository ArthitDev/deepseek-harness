#requires -Version 5.1
<#
Observe WSL, shells and terminal hosts without collecting arguments or environment.
Run with -File scripts/watch-wsl-processes.ps1. Logs are exclusive JSONL files in
.artifacts; create <output>.stop to stop early, or wait for DurationSeconds.
Polling can miss a process that starts and exits between snapshots.
#>
[CmdletBinding()]
param(
    [ValidateRange(1, 86400)][int]$DurationSeconds = 1800,
    [string]$OutputFile
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This observer requires Windows.' }
if (-not $OutputFile) {
    $root = Split-Path -Parent $PSScriptRoot
    $OutputFile = Join-Path $root ('.artifacts\wsl-process-trace-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff') + '.jsonl')
}
$OutputFile = [IO.Path]::GetFullPath($OutputFile)
$stopFile = $OutputFile + '.stop'
if ([IO.File]::Exists($stopFile)) { throw 'The stop marker already exists; choose a new output file.' }
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($OutputFile)) | Out-Null

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

public sealed class DshObservedProcess {
    public uint Pid;
    public uint ParentPid;
    public string Name;
}

public static class DshProcessSnapshot {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Entry {
        public uint Size, Usage, Pid;
        public UIntPtr Heap;
        public uint Module, Threads, ParentPid;
        public int Priority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Name;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", EntryPoint = "Process32FirstW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool First(IntPtr snapshot, ref Entry entry);
    [DllImport("kernel32.dll", EntryPoint = "Process32NextW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Next(IntPtr snapshot, ref Entry entry);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);

    public static List<DshObservedProcess> Read() {
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            var result = new List<DshObservedProcess>();
            var entry = new Entry { Size = (uint)Marshal.SizeOf(typeof(Entry)) };
            if (!First(snapshot, ref entry)) throw new Win32Exception(Marshal.GetLastWin32Error());
            do {
                result.Add(new DshObservedProcess { Pid = entry.Pid, ParentPid = entry.ParentPid, Name = entry.Name });
            } while (Next(snapshot, ref entry));
            int error = Marshal.GetLastWin32Error();
            if (error != 18) throw new Win32Exception(error);
            return result;
        } finally { CloseHandle(snapshot); }
    }
}
'@

$trackedNames = @(
    'wsl.exe', 'wslhost.exe', 'wslrelay.exe', 'wslservice.exe', 'vmmemWSL',
    'conhost.exe', 'OpenConsole.exe', 'WindowsTerminal.exe', 'wt.exe',
    'cmd.exe', 'powershell.exe', 'pwsh.exe', 'bash.exe', 'sh.exe',
    'node.exe', 'bun.exe', 'dsh.exe', 'rtk.exe'
)

function Write-Record($record) {
    $writer.WriteLine((ConvertTo-Json -InputObject $record -Depth 6 -Compress))
}

function Get-Record($kind, $item, $current, $previous) {
    $ancestors = @()
    $next = $item.ParentPid
    $seen = @{}
    for ($depth = 0; $depth -lt 8 -and $next -ne 0 -and -not $seen.ContainsKey($next); $depth++) {
        $seen[$next] = $true
        $parent = $current[$next]
        if (-not $parent) { $parent = $previous[$next] }
        $ancestors += [ordered]@{ pid = $next; name = $(if ($parent) { $parent.Name } else { $null }) }
        if (-not $parent) { break }
        $next = $parent.ParentPid
    }
    return [ordered]@{
        kind = $kind
        observedAtUtc = [DateTime]::UtcNow.ToString('o')
        pid = $item.Pid
        parentPid = $item.ParentPid
        name = $item.Name
        ancestors = @($ancestors)
    }
}

$stream = [IO.File]::Open($OutputFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
$writer = New-Object IO.StreamWriter($stream, (New-Object Text.UTF8Encoding($false)))
$writer.AutoFlush = $true
$previous = @{}
$selected = @{}
$first = $true
$reason = 'duration'
$clock = [Diagnostics.Stopwatch]::StartNew()
try {
    while ($clock.Elapsed.TotalSeconds -lt $DurationSeconds) {
        if ([IO.File]::Exists($stopFile)) { $reason = 'stop-marker'; break }
        $current = @{}
        foreach ($item in [DshProcessSnapshot]::Read()) { $current[$item.Pid] = $item }
        foreach ($key in @($previous.Keys)) {
            $old = $previous[$key]
            $item = $current[$key]
            if (-not $item -or $item.Name -ne $old.Name -or $item.ParentPid -ne $old.ParentPid) {
                if ($selected.ContainsKey($key)) {
                    $record = $selected[$key]
                    $record.kind = 'observed-stop'
                    $record.observedAtUtc = [DateTime]::UtcNow.ToString('o')
                    Write-Record $record
                    $selected.Remove($key)
                }
            }
        }
        foreach ($key in $current.Keys) {
            $item = $current[$key]
            $old = $previous[$key]
            if ($trackedNames -contains $item.Name -and (
                -not $old -or $old.Name -ne $item.Name -or $old.ParentPid -ne $item.ParentPid
            )) {
                $kind = if ($first) { 'snapshot' } else { 'observed-start' }
                $record = Get-Record $kind $item $current $previous
                $selected[$key] = $record
                Write-Record $record
            }
        }
        $previous = $current
        if ($first) {
            Write-Record ([ordered]@{
                kind = 'ready'; observedAtUtc = [DateTime]::UtcNow.ToString('o'); observerPid = $PID
                mode = 'native-snapshot'; pollMs = 50; durationSeconds = $DurationSeconds
                commandLinesCollected = $false; environmentsCollected = $false
            })
            Write-Host "Observer ready: $OutputFile"
            $first = $false
        }
        Start-Sleep -Milliseconds 50
    }
} finally {
    try {
        Write-Record ([ordered]@{
            kind = 'trace-end'; observedAtUtc = [DateTime]::UtcNow.ToString('o'); reason = $reason
        })
    } finally { $writer.Dispose(); $stream.Dispose() }
}
