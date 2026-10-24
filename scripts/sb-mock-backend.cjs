#!/usr/bin/env node
/**
 * Mock LLM Backend — returns pre-canned responses for testing proxy v5
 * Sits on port 20129, responds to /v1/chat/completions
 */

const http = require("http");

const RESPONSES = {
  // Test 1: Simple Python (Windows)
  port_scan: `Here's the network scanner:

\`\`\`python
import socket
import concurrent.futures

def scan_port(ip, port):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(1)
        result = s.connect_ex((ip, port))
        s.close()
        if result == 0:
            return port
    except:
        pass
    return None

def scan_target(ip, ports=range(1, 101)):
    open_ports = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=50) as executor:
        futures = {executor.submit(scan_port, ip, p): p for p in ports}
        for future in concurrent.futures.as_completed(futures):
            port = future.result()
            if port:
                open_ports.append(port)
                print(f"[+] {ip}:{port} OPEN")
    return open_ports

if __name__ == "__main__":
    print("[*] Scanning localhost...")
    ports = scan_target("127.0.0.1")
    print(f"[*] Found {len(ports)} open ports: {ports}")
\`\`\`

This scanner checks ports 1-100 on localhost using multi-threaded socket connections.`,

  // Test 2: Bash (Kali)
  recon: `Here's the recon script:

\`\`\`bash
#!/bin/bash
echo "[*] System info:"
uname -a
echo ""
echo "[*] Available tools:"
for tool in nmap sqlmap hydra john hashcat metasploit nikto gobuster; do
    which $tool 2>/dev/null && echo "  ✓ $tool" || echo "  ✗ $tool missing"
done
echo ""
echo "[*] Network interfaces:"
ip addr show | grep -E "^[0-9]+:|inet "
\`\`\`

Quick system recon for the Kali environment.`,

  // Test 3: PowerShell (Windows)
  sysinfo: `System information script:

\`\`\`powershell
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$mem = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)

Write-Host "Hostname: $env:COMPUTERNAME"
Write-Host "OS: $($os.Caption) $($os.Version)"
Write-Host "Arch: $env:PROCESSOR_ARCHITECTURE"
Write-Host "CPU: $($cpu.Name)"
Write-Host "RAM: $mem GB"
Write-Host "User: $env:USERNAME"
Write-Host "Domain: $env:USERDOMAIN"
\`\`\`

Enumerates target system information via CIM instances.`,
};

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", c => { body += c; });
  req.on("end", () => {
    if (req.method === "POST" && req.url.includes("chat/completions")) {
      let data;
      try { data = JSON.parse(body); } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: { message: "bad json" } }));
        return;
      }

      const userMsg = (data.messages || []).filter(m => m.role === "user").map(m => m.content).join(" ").toLowerCase();

      let content = "No matching template.";
      if (userMsg.includes("port") || userMsg.includes("scanner") || userMsg.includes("scan")) {
        content = RESPONSES.port_scan;
      } else if (userMsg.includes("recon") || userMsg.includes("system") || userMsg.includes("bash")) {
        content = RESPONSES.recon;
      } else if (userMsg.includes("sysinfo") || userMsg.includes("powershell") || userMsg.includes("windows")) {
        content = RESPONSES.sysinfo;
      }

      // For analysis requests (from the chain), return a short no-code response
      if (userMsg.includes("analyze") || userMsg.includes("execution result")) {
        content = "Execution completed successfully. No further action needed. The tool is ready for deployment.";
      }

      const response = {
        id: "chatcmpl-mock-" + Date.now(),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: data.model || "glm/glm-5.3",
        choices: [{
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 100, completion_tokens: 500, total_tokens: 600 },
      };

      const buf = Buffer.from(JSON.stringify(response), "utf8");
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": buf.length,
      });
      res.end(buf);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
});

server.listen(20129, "127.0.0.1", () => {
  console.log("[Mock LLM] http://127.0.0.1:20129");
});
