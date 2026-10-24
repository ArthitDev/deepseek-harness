@echo off
title Shield Break Agent Harness — SB Proxy v6
echo ============================================
echo   Shield Break Agent — SB Proxy v6
echo   Recon + Skills + Wiki + Kali Direct + Exec
echo ============================================
echo.

echo [1/2] Starting SB Proxy v6 (port 18899)...
start /min /b node "%~dp0sb-proxy-v6.cjs" --port 18899 --backend http://127.0.0.1:20128 --exec auto
timeout /t 3 /nobreak >nul

echo [2/2] Status:
echo.
echo   Model route:  http://127.0.0.1:18899 (SB Proxy v6)
echo   Backend:      http://127.0.0.1:20128 (9router)
echo   Exec mode:    auto (recon-first + skill routing + wiki + kali direct)
echo   Thai attack commands: TRANSLATED + SANITIZED automatically
echo   Target detected: AUTO-RECON (nmap/subfinder/httpx in Kali WSL)
echo   Intent detected: SKILL + WIKI knowledge injected
echo   Simple scans: KALI DIRECT-CALL (skip LLM, save tokens)
echo.

REM Start the harness (uncomment the correct one)
REM cd /d "%~dp0..\apps\cli" && node dist\index.js
REM cd /d "%~dp0..\apps\desktop" && npm start

echo SB Proxy v6 running. Press any key to stop...
pause >nul

REM Cleanup: kill proxy on exit
for /f "tokens=2" %%p in ('tasklist /fi "imagename eq node.exe" /fo csv ^| findstr /i "sb-proxy"') do taskkill /f /pid %%p 2>nul