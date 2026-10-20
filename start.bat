@echo off
rem Double-click to start JARVIS. Add --dev, --lan, --rebuild or --no-open as needed.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get the current LTS from https://nodejs.org & pause & exit /b 1)
node scripts\launch.mjs %*
pause
