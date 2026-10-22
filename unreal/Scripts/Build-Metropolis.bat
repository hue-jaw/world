@echo off
rem ===========================================================================
rem  METROPOLIS - script de compilation pour Windows 11
rem  Unreal Engine 5.8.4 + Visual Studio Community 2026
rem
rem  Usage :
rem    Build-Metropolis.bat            compile l'editeur (MetropolisEditor)
rem    Build-Metropolis.bat game       compile le jeu (Metropolis, Win64)
rem    Build-Metropolis.bat vs         genere seulement les fichiers VS
rem
rem  Le script :
rem    1. cherche Unreal Engine 5.8 (variable UE_ROOT, puis registre Epic) ;
rem    2. verifie que Visual Studio 2026 a bien la charge C++ (vswhere) ;
rem    3. supprime .vs / Binaries / Intermediate / DerivedDataCache / *.sln ;
rem    4. lance Build.bat et ecrit TOUT dans BuildLog.txt ;
rem    5. affiche la PREMIERE erreur, celle qu'il faut m'envoyer.
rem
rem  Aucun accent dans ce fichier : la console Windows n'est pas en UTF-8 par
rem  defaut et les .bat non-ASCII produisent des erreurs de syntaxe absurdes.
rem ===========================================================================
setlocal EnableExtensions
chcp 65001 >nul 2>&1

set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."
for %%I in ("%PROJECT_DIR%") do set "PROJECT_DIR=%%~fI"
set "UPROJECT=%PROJECT_DIR%\Metropolis.uproject"
set "LOG=%PROJECT_DIR%\BuildLog.txt"
set "MODE=%~1"
if "%MODE%"=="" set "MODE=editor"

echo.
echo ===========================================================
echo  METROPOLIS - compilation Unreal Engine 5.8.4
echo  Projet : %UPROJECT%
echo ===========================================================
echo.

if not exist "%UPROJECT%" (
  echo [ECHEC] Metropolis.uproject est introuvable.
  echo         Le fichier .bat doit rester dans Metropolis\Scripts\.
  goto :fail
)

rem ---------------------------------------------------------------------------
rem 1. Localiser le moteur
rem ---------------------------------------------------------------------------
if defined UE_ROOT (
  if exist "%UE_ROOT%\Engine\Build\BatchFiles\Build.bat" goto :engine_ok
)

set "UE_ROOT="
for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\EpicGames\Unreal Engine\5.8" /v InstalledDirectory 2^>nul ^| findstr /i InstalledDirectory') do set "UE_ROOT=%%B"
if defined UE_ROOT if exist "%UE_ROOT%\Engine\Build\BatchFiles\Build.bat" goto :engine_ok

set "UE_ROOT="
for %%D in (
  "C:\Program Files\Epic Games\UE_5.8"
  "C:\Program Files (x86)\Epic Games\UE_5.8"
  "D:\Epic Games\UE_5.8"
  "D:\Program Files\Epic Games\UE_5.8"
  "E:\Epic Games\UE_5.8"
) do (
  if exist "%%~D\Engine\Build\BatchFiles\Build.bat" set "UE_ROOT=%%~D"
)
if defined UE_ROOT goto :engine_ok

echo [ECHEC] Unreal Engine 5.8 est introuvable.
echo.
echo   Installez UE 5.8.4 depuis Epic Games Launcher, puis relancez ce script.
echo   Si le moteur est installe ailleurs, definissez la variable :
echo       set UE_ROOT=D:\Chemin\Vers\UE_5.8
echo.
goto :fail

:engine_ok
echo [OK]    Moteur        : %UE_ROOT%

rem ---------------------------------------------------------------------------
rem 2. Verifier Visual Studio (charge de travail C++)
rem ---------------------------------------------------------------------------
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" set "VSWHERE=%ProgramFiles%\Microsoft Visual Studio\Installer\vswhere.exe"

set "VS_DESC="
if exist "%VSWHERE%" (
  "%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property displayName > "%TEMP%\metropolis_vs.txt" 2>nul
  if exist "%TEMP%\metropolis_vs.txt" (
    for /f "usebackq delims=" %%V in ("%TEMP%\metropolis_vs.txt") do if not defined VS_DESC set "VS_DESC=%%V"
    del /q "%TEMP%\metropolis_vs.txt" 2>nul
  )
)
if defined VS_DESC (
  echo [OK]    Visual Studio : %VS_DESC%
) else (
  echo [ALERTE] Aucune installation Visual Studio avec la charge C++ detectee.
  echo          Ouvrir Visual Studio Installer, modifier l'installation et cocher
  echo          "Developpement de jeux avec C++" ^(MSVC v145 + Windows 11 SDK^).
  echo          La compilation va probablement echouer : voir la fin du log.
)

rem ---------------------------------------------------------------------------
rem 3. Nettoyer les caches (obligatoire apres un changement de version)
rem ---------------------------------------------------------------------------
echo.
echo [..]    Nettoyage des intermediaires...
for %%P in (".vs" "Binaries" "Intermediate" "DerivedDataCache" "Saved\Logs") do (
  if exist "%PROJECT_DIR%\%%~P" rmdir /s /q "%PROJECT_DIR%\%%~P" 2>nul
)
del /q "%PROJECT_DIR%\*.sln" 2>nul
echo [OK]    Caches supprimes.

rem ---------------------------------------------------------------------------
rem 4. Generation des fichiers Visual Studio (optionnel)
rem ---------------------------------------------------------------------------
if /i "%MODE%"=="vs" (
  echo.
  echo [..]    Generation des fichiers Visual Studio...
  call "%UE_ROOT%\Engine\Build\BatchFiles\Build.bat" -projectfiles -project="%UPROJECT%" -game -rocket -progress
  if errorlevel 1 goto :fail
  echo [OK]    Fichiers .sln regeneres dans %PROJECT_DIR%
  goto :done
)

rem ---------------------------------------------------------------------------
rem 5. Compilation
rem ---------------------------------------------------------------------------
if /i "%MODE%"=="game" (
  set "TARGET=Metropolis"
) else (
  set "TARGET=MetropolisEditor"
)

echo.
echo [..]    Compilation de %TARGET% ^(Win64 Development^)...
echo         La premiere compilation prend 3 a 10 minutes.
echo.

call "%UE_ROOT%\Engine\Build\BatchFiles\Build.bat" %TARGET% Win64 Development -project="%UPROJECT%" -waitmutex > "%LOG%" 2>&1
set "BUILD_RESULT=%ERRORLEVEL%"

echo.
if "%BUILD_RESULT%"=="0" (
  echo ===========================================================
  echo  [SUCCES] Compilation terminee.
  echo  Ouvrez Metropolis.uproject, puis : Nouveau niveau ^> Basic ^> Play.
  echo  Journal complet : %LOG%
  echo ===========================================================
  goto :done
)

echo ===========================================================
echo  [ECHEC] La compilation a echoue ^(code %BUILD_RESULT%^).
echo ===========================================================
echo.
echo  Premieres erreurs trouvees :
echo  ---------------------------------------------------------
findstr /i /c:"error C" /c:"error :" /c:"error MSB" /c:"fatal error" /c:"Unable to" "%LOG%" | more +0
echo  ---------------------------------------------------------
echo.
echo  Envoyez le fichier : %LOG%
echo  ^(ou seulement les 30 premieres lignes contenant "error"^)
echo.
goto :fail

:done
endlocal
exit /b 0

:fail
echo.
pause
endlocal
exit /b 1
