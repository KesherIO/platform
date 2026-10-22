@echo off
rem Usage: replay-capture.bat path\to\capture.hl7   (receiver must already be running)
cd /d "%~dp0"
if "%~1"=="" (
  echo Usage: replay-capture.bat path\to\capture.hl7
  exit /b 1
)
node vh30-replay.cjs "%~1" --host 127.0.0.1 --port 8001 --random-chunks
pause
