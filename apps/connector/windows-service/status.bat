@echo off
rem Shows every KesherIO connector service on this PC: service state + the receiver's own status file.
setlocal enabledelayedexpansion
set ROOT=%ProgramData%\KesherIO\Connector
set FOUND=0
for /d %%D in ("%ROOT%\*") do (
  set FOUND=1
  echo ==========================================================
  echo Analyzer connector: %%~nxD
  sc query "KesherIOConnector-%%~nxD" | findstr /i "STATE"
  if exist "%%D\status.json" (type "%%D\status.json") else (echo No status file yet - the service has not started.)
  echo Logs: %%D\logs
  echo.
)
if "!FOUND!"=="0" echo No connector is installed (nothing under %ROOT%).
pause
