@echo off
rem ============================================================
rem  POOLCORE FLIGHT - Windows one-click launcher
rem  Tries a local static server, then opens the game in a browser.
rem ============================================================
setlocal
cd /d "%~dp0"
set PORT=8123

echo [poolcore-flight] starting local server on port %PORT% ...
start "" /b node lib\serve.js %PORT%

timeout /t 1 /nobreak >nul

echo [poolcore-flight] opening browser ...
start "" "http://127.0.0.1:%PORT%/index.html"

echo.
echo If the page did not open, run:  start http://127.0.0.1:%PORT%/index.html
echo If the browser shows a blank white page, double-click index.html directly
echo (pointer-lock and WebGL work from file:// in Chrome/Edge).
endlocal
