@echo off
rem Builds dist\simple-hl7-<version>-windows-amd64.exe (needs Node 22 and npm).
setlocal
cd /d "%~dp0"
call npm ci || exit /b 1
call npm test || exit /b 1
node scripts\build-exe.mjs %* || exit /b 1
