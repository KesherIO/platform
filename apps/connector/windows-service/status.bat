@echo off
rem Double-click to see every KesherIO connector on this PC. Runs status.ps1 as administrator (the data folder is
rem readable only by Administrators and the service). Takes no arguments.
setlocal
cd /d "%~dp0"
if not exist "%~dp0status.ps1" (
  echo status.ps1 was not found next to this file. Unzip the whole package first.
  pause
  exit /b 1
)
fltmc >nul 2>&1
if errorlevel 1 (
  echo Asking Windows for administrator permission...
  set "KESHERIO_SELF=%~f0"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath $env:KESHERIO_SELF -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0status.ps1"
set "RC=%errorlevel%"
echo.
if not "%RC%"=="0" echo The script finished with code %RC%. Read the messages above.
pause
exit /b %RC%
