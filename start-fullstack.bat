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

where py >nul 2>nul
if errorlevel 1 (
  where python >nul 2>nul
  if errorlevel 1 (
    echo Python was not found.
    echo Please install Python 3 first, then run this file again.
    pause
    exit /b 1
  )
)

if exist "%~dp0scripts\run-backend.ps1" (
) else (
  echo Backend start script was not found: scripts\run-backend.ps1
  pause
  exit /b 1
)

set "HOST=127.0.0.1"
set "PORT=8000"
start "Combat Simulator Backend" /D "%CD%" powershell -NoExit -ExecutionPolicy Bypass -File "%CD%\scripts\run-backend.ps1"

set "HOST=127.0.0.1"
set "PORT=4173"
start "Combat Simulator Frontend" /D "%CD%" cmd.exe /k "npm run dev"

powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 4; Start-Process 'http://127.0.0.1:4173'"

echo Opening page: http://127.0.0.1:4173
echo If needed, switch UI mode to backend API: http://127.0.0.1:8000
timeout /t 2 >nul
