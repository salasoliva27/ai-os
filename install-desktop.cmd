@echo off
setlocal

REM Creates a Desktop shortcut with an icon that delegates to this clone's
REM AI OS.cmd. The repo launcher still handles template updates on every run.

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "DESKTOP=%%D"
if "%DESKTOP%"=="" set "DESKTOP=%USERPROFILE%\Desktop"
if not exist "%DESKTOP%" mkdir "%DESKTOP%"

set "SHORTCUT=%DESKTOP%\AI OS.lnk"
set "ICON=%ROOT%\assets\ai-os.ico"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$s = $ws.CreateShortcut($env:SHORTCUT); " ^
  "$s.TargetPath = Join-Path $env:ROOT 'AI OS.cmd'; " ^
  "$s.WorkingDirectory = $env:ROOT; " ^
  "$s.IconLocation = $env:ICON; " ^
  "$s.Save()"

echo Installed: "%SHORTCUT%"
echo.
echo Double-click "AI OS" on your Desktop to launch this AI.
echo.
pause
