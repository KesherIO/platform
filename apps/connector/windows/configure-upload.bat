@echo off
rem Saves where to upload and the connector token (given once by the lab administrator).
rem Stored in data\connector.json - not in this file. Restart start-receiver.bat afterwards.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 18 or newer from https://nodejs.org and run this again.
  pause
  exit /b 1
)
set /p VH30_API_URL=API address (https://...): 
set /p VH30_API_TOKEN=Connector token (kvc_...): 
set VH30_DATA_DIR=%~dp0data
node vh30-receiver.cjs --configure --api-url "%VH30_API_URL%" --token "%VH30_API_TOKEN%"
pause
