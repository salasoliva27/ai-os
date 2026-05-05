@echo off
setlocal

REM Portable Windows launcher. Double-click this file from a local Janus IA
REM clone to update, install missing runtime pieces, start the dashboard, and
REM open http://localhost:3100.

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "JANUS_OPEN_BROWSER=0"
set "BASH="

if exist "%ProgramFiles%\Git\bin\bash.exe" set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not defined BASH if exist "%ProgramFiles%\Git\usr\bin\bash.exe" set "BASH=%ProgramFiles%\Git\usr\bin\bash.exe"
if not defined BASH if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "BASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not defined BASH if exist "%ProgramFiles(x86)%\Git\usr\bin\bash.exe" set "BASH=%ProgramFiles(x86)%\Git\usr\bin\bash.exe"
if not defined BASH if exist "%LocalAppData%\Programs\Git\bin\bash.exe" set "BASH=%LocalAppData%\Programs\Git\bin\bash.exe"
if not defined BASH if exist "%LocalAppData%\Programs\Git\usr\bin\bash.exe" set "BASH=%LocalAppData%\Programs\Git\usr\bin\bash.exe"
if not defined BASH if exist "%USERPROFILE%\scoop\apps\git\current\bin\bash.exe" set "BASH=%USERPROFILE%\scoop\apps\git\current\bin\bash.exe"
if not defined BASH if exist "%USERPROFILE%\scoop\apps\git\current\usr\bin\bash.exe" set "BASH=%USERPROFILE%\scoop\apps\git\current\usr\bin\bash.exe"

if not defined BASH (
  for /f "usebackq delims=" %%G in (`where git.exe 2^>nul`) do if not defined GIT_EXE set "GIT_EXE=%%G"
  if defined GIT_EXE (
    for %%I in ("%GIT_EXE%") do set "GIT_CMD_DIR=%%~dpI"
    if exist "%GIT_CMD_DIR%..\bin\bash.exe" set "BASH=%GIT_CMD_DIR%..\bin\bash.exe"
    if not defined BASH if exist "%GIT_CMD_DIR%..\usr\bin\bash.exe" set "BASH=%GIT_CMD_DIR%..\usr\bin\bash.exe"
  )
)

if not defined BASH (
  echo Git Bash was not found.
  echo Install Git for Windows, then run install-desktop.cmd again.
  echo Do not use the Windows WSL bash launcher for Janus IA.
  pause
  exit /b 1
)

start "" /min powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='http://localhost:3100'; for ($i=0; $i -lt 180; $i++) { try { $r=Invoke-WebRequest -UseBasicParsing -Uri ($u + '/health') -TimeoutSec 1; if ($r.StatusCode -eq 200) { Start-Process $u; exit } } catch {}; Start-Sleep -Milliseconds 500 }; Start-Process $u"

pushd "%ROOT%"
"%BASH%" dash
set "ERR=%ERRORLEVEL%"
popd

if not "%ERR%"=="0" (
  echo.
  echo Janus IA failed to start. Review the error above.
  pause
)
