@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title Mainer
echo.
echo  ================================
echo   Mainer - starting clean
echo  ================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not on PATH.
  echo Install from https://nodejs.org/ then try again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing npm packages...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
  )
  echo.
)

echo Stopping old Mainer processes if any...
node scripts\kill-ports.mjs
echo.

echo Starting web + API (Ctrl+C to stop)...
echo   App:  http://localhost:5173/
echo   API:  http://127.0.0.1:8787/
echo.

call npm run start
set EXITCODE=%ERRORLEVEL%

echo.
if not "%EXITCODE%"=="0" (
  echo Mainer exited with code %EXITCODE%.
  pause
)
exit /b %EXITCODE%
