@echo off
setlocal

pushd "%~dp0"
if errorlevel 1 (
  echo Failed to enter project directory.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found.
  echo Please install Node.js first, then run this file again.
  pause
  exit /b 1
)

set "HOST=127.0.0.1"
set "PORT=4173"
start "Combat Simulator Frontend" /D "%CD%" cmd.exe /k "npm run dev"

powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:4173'"

echo Opening page: http://127.0.0.1:4173
echo Use local simulation mode by default.
timeout /t 2 >nul
