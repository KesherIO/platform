@echo off
rem ---- Edit these lines if the network setup changes ----------------------
set VH30_HOST=192.168.5.13
set VH30_PORT=8001
set VH30_ALLOW_FROM=192.168.5.14
rem ACK to the analyzer: off | length-mllp | mllp  (leave "off" until the hardware checklist, Phase C, has passed)
set VH30_ACK=off
rem -------------------------------------------------------------------------
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 18 or newer from https://nodejs.org and run this again.
  pause
  exit /b 1
)
set VH30_DATA_DIR=%~dp0data
node vh30-receiver.cjs
echo.
echo The receiver stopped. Messages already received are safe in %VH30_DATA_DIR%
pause
