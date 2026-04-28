@echo off
setlocal

REM Creates a Desktop shortcut that delegates to this clone's AI OS.cmd.

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "DESKTOP=%%D"
if "%DESKTOP%"=="" set "DESKTOP=%USERPROFILE%\Desktop"
if not exist "%DESKTOP%" mkdir "%DESKTOP%"

set "LAUNCHER=%DESKTOP%\AI OS.cmd"

> "%LAUNCHER%" echo @echo off
>> "%LAUNCHER%" echo setlocal
>> "%LAUNCHER%" echo set "ROOT=%ROOT%"
>> "%LAUNCHER%" echo call "%%ROOT%%\AI OS.cmd"

echo Installed: "%LAUNCHER%"
echo.
echo Double-click "AI OS.cmd" on your Desktop to launch this AI.
echo.
pause
