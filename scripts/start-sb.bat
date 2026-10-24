@echo off
title Shield Break Agent Harness
echo ============================================
echo   Shield Break Agent - Starting...
echo ============================================
echo.

echo [1/2] Starting SB Proxy (port 18899)...
start /min /b node "%~dp0sb-proxy.js" --port 18899 --backend http://127.0.0.1:20128
timeout /t 2 /nobreak >nul

echo [2/2] Starting Harness...
echo.
echo   Model route: http://127.0.0.1:18899 (through SB Proxy)
echo   Backend:     http://127.0.0.1:20128 (9router)
echo   Preset:      Shield-Break-Agent-Preset
echo   Thai attack commands: TRANSLATED automatically
echo.

REM Start the harness (uncomment the correct one)
REM cd /d "%~dp0..\apps\cli" && node dist/index.js
REM cd /d "%~dp0..\apps\desktop" && npm start

echo SB Proxy is running in background.
echo Press any key to stop the proxy...
pause >nul

REM Cleanup: kill proxy on exit
taskkill /f /im node.exe /fi "WINDOWTITLE eq sb-proxy*" 2>nul