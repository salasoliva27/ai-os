@echo off
setlocal enabledelayedexpansion

REM Double-click installer for Windows.
REM Creates a Desktop launcher that starts THIS instance from the local repo.
REM Requires Git Bash, because the main launcher is ./dash.
REM
REM Brand-agnostic: discovers the per-instance .cmd in the repo root
REM (Janus IA.cmd / Pablo AI.cmd / JP AI.cmd / AI OS.cmd) by skipping
REM install*.cmd files. The first match wins.

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

REM Find the brand launcher in the repo root.
set "LAUNCHER_NAME="
for %%F in ("%ROOT%\*.cmd") do (
  set "FNAME=%%~nxF"
  REM Skip install*.cmd files (these are installers, not the brand launcher).
  echo !FNAME! | findstr /b /i "install" >nul
  if errorlevel 1 (
    if not defined LAUNCHER_NAME set "LAUNCHER_NAME=!FNAME!"
  )
)

if not defined LAUNCHER_NAME (
  echo No brand launcher found in "%ROOT%".
  echo Expected a .cmd file like "Janus IA.cmd" or "Pablo AI.cmd" at the repo root.
  pause
  exit /b 1
)

for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "DESKTOP=%%D"
if "%DESKTOP%"=="" set "DESKTOP=%USERPROFILE%\Desktop"
if not exist "%DESKTOP%" mkdir "%DESKTOP%"

set "LAUNCHER=%DESKTOP%\!LAUNCHER_NAME!"

> "%LAUNCHER%" echo @echo off
>> "%LAUNCHER%" echo setlocal
>> "%LAUNCHER%" echo set "ROOT=%ROOT%"
>> "%LAUNCHER%" echo call "%%ROOT%%\!LAUNCHER_NAME!"

echo Installed: "%LAUNCHER%"
echo.
echo Double-click "!LAUNCHER_NAME!" on your Desktop to launch the UI.
echo The UI will still let you switch engines and models from the top bar.
echo.
pause
