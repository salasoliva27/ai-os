@echo off
setlocal

REM Double-click installer for Windows.
REM It creates a Desktop launcher that starts Janus IA from this local repo.
REM Requires Git Bash, because the main Janus launcher is ./dash.

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "DESKTOP=%%D"
if "%DESKTOP%"=="" set "DESKTOP=%USERPROFILE%\Desktop"
if not exist "%DESKTOP%" mkdir "%DESKTOP%"

set "LAUNCHER=%DESKTOP%\Janus IA.cmd"

> "%LAUNCHER%" echo @echo off
>> "%LAUNCHER%" echo setlocal
>> "%LAUNCHER%" echo set "ROOT=%ROOT%"
>> "%LAUNCHER%" echo call "%%ROOT%%\Janus IA.cmd"

echo Installed: "%LAUNCHER%"
echo.
echo Double-click "Janus IA.cmd" on your Desktop to launch the UI.
echo The UI will still let you switch engines and models from the top bar.
echo.
pause
