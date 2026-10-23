@echo off
rem Double-click to run install.ps1 as administrator. Takes no arguments (use the .ps1 directly for options).
rem The path of this file travels in an environment variable, never pasted into a command line, so odd folder
rem names cannot change what gets run.
setlocal
cd /d "%~dp0"
if not exist "%~dp0install.ps1" (
  echo install.ps1 was not found next to this file. Unzip the whole package first.
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
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set "RC=%errorlevel%"
echo.
if not "%RC%"=="0" echo The script finished with code %RC%. Read the messages above.
pause
exit /b %RC%
