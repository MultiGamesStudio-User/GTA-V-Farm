@echo off
chcp 65001 >nul 2>&1
title GTA V Farm Control
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo  ============================================================
echo             GTA V FARM CONTROL  -  MacroEngine v2.0
echo  ============================================================
echo.
echo  Dossier : %~dp0
echo.

:: ============================================================
::  1. NODE.JS PORTABLE  (dans .\node\)
:: ============================================================
set "NODE_DIR=%~dp0node"
set "NODE_EXE=%~dp0node\node.exe"
set "NPM_CMD=%~dp0node\npm.cmd"
set "NODE_ZIP=%~dp0node-v20.11.1-win-x64.zip"

if exist "%NODE_EXE%" (
    set "PATH=%~dp0node;%~dp0node\node_modules\npm\bin;%PATH%"
    echo  [OK] Node.js portable detecte
    goto :node_done
)

echo  [..] Node.js manquant - telechargement en cours...
echo       1/3  Telechargement de Node.js v20.11.1...
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip' -OutFile '%NODE_ZIP%' -UseBasicParsing"
if not exist "%NODE_ZIP%" (
    echo  [ERREUR] Echec du telechargement de Node.js.
    pause & exit /b 1
)
echo       2/3  Extraction...
powershell -NoProfile -Command "Expand-Archive -Force -Path '%NODE_ZIP%' -DestinationPath '%~dp0'"
if exist "%~dp0node-v20.11.1-win-x64" (
    if exist "%NODE_DIR%" rmdir /s /q "%NODE_DIR%"
    rename "%~dp0node-v20.11.1-win-x64" node
)
del /f /q "%NODE_ZIP%" 2>nul
if not exist "%NODE_EXE%" (
    echo  [ERREUR] Extraction Node.js echouee.
    pause & exit /b 1
)
set "PATH=%~dp0node;%~dp0node\node_modules\npm\bin;%PATH%"
echo       3/3  Node.js installe
echo  [OK] Node.js v20.11.1 installe dans .\node\

:node_done

:: ============================================================
::  2. PYTHON EMBARQUE  (dans .\python-embed\)
:: ============================================================
set "PYTHON_DIR=%~dp0python-embed"
set "PYTHON_EXE=%~dp0python-embed\python.exe"
set "PY_ZIP=%~dp0python-3.11.9-embed-amd64.zip"
set "PTH_FILE=%~dp0python-embed\python311._pth"

if exist "%PYTHON_EXE%" (
    echo  [OK] Python embarque detecte
    goto :python_done
)

echo  [..] Python manquant - telechargement en cours...
echo       1/4  Telechargement de Python 3.11.9 embed...
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip' -OutFile '%PY_ZIP%' -UseBasicParsing"
if not exist "%PY_ZIP%" (
    echo  [ERREUR] Echec du telechargement de Python.
    pause & exit /b 1
)
echo       2/4  Extraction dans .\python-embed\...
if exist "%PYTHON_DIR%" rmdir /s /q "%PYTHON_DIR%"
mkdir "%PYTHON_DIR%"
powershell -NoProfile -Command "Expand-Archive -Force -Path '%PY_ZIP%' -DestinationPath '%PYTHON_DIR%'"
del /f /q "%PY_ZIP%" 2>nul

echo       3/4  Activation pip + site-packages...
if exist "%PTH_FILE%" (
    powershell -NoProfile -Command "$c = Get-Content '%PTH_FILE%' -Raw; $c = $c -replace '#\s*import site','import site'; if ($c -notmatch 'Lib\\site-packages') { $c += \"`nLib\\site-packages`n\" }; Set-Content '%PTH_FILE%' $c -NoNewline"
)
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile '%PYTHON_DIR%\get-pip.py' -UseBasicParsing"
"%PYTHON_EXE%" "%PYTHON_DIR%\get-pip.py" --no-warn-script-location >nul 2>&1
del /f /q "%PYTHON_DIR%\get-pip.py" 2>nul

echo       4/4  Installation des dependances Python...
"%PYTHON_EXE%" -m pip install -r "%~dp0requirements.txt" --no-warn-script-location --disable-pip-version-check --quiet
"%PYTHON_EXE%" -m pip uninstall opencv-python -y --quiet >nul 2>&1
"%PYTHON_EXE%" -m pip install opencv-python-headless --no-warn-script-location --disable-pip-version-check --quiet
"%PYTHON_EXE%" -m pip uninstall pip setuptools wheel -y --quiet >nul 2>&1
echo  [OK] Python + dependances installes dans .\python-embed\

:python_done

:: ============================================================
::  3. DEPENDANCES NODE  (dans .\electron-app\node_modules\)
:: ============================================================
cd /d "%~dp0electron-app"

if not exist "node_modules\electron" (
    echo  [..] Installation des modules Node.js...
    call "%NPM_CMD%" install --loglevel=error
    if errorlevel 1 (
        echo  [ERREUR] npm install a echoue.
        pause & exit /b 1
    )
    echo  [OK] Modules Node.js installes
) else (
    echo  [OK] Modules Node.js deja presents
)

:: ============================================================
::  4. LANCEMENT
:: ============================================================
set "PYTHON_OVERRIDE=%~dp0python-embed\python.exe"
set "LOG_FILE=%~dp0app.log"

echo.
echo  ------------------------------------------------------------
echo   Demarrage de GTA V Farm Control...
echo  ------------------------------------------------------------
echo.

call "%NPM_CMD%" start
set "APP_EXIT=%errorlevel%"

:: ============================================================
::  5. GESTION D'ERREUR - affiche le log si crash
:: ============================================================
if %APP_EXIT% NEQ 0 (
    echo.
    echo  ============================================================
    echo   ERREUR - L'application s'est fermee  (code: %APP_EXIT%)
    echo  ============================================================
    echo.
    if exist "%LOG_FILE%" (
        echo  --- Dernieres lignes de app.log ---
        echo.
        powershell -NoProfile -Command "Get-Content '%LOG_FILE%' -Tail 40"
        echo.
        echo  Fichier log complet : %LOG_FILE%
    ) else (
        echo  Aucun fichier app.log trouve.
        echo  Possible cause : electron-app\node_modules\ absent ou corrompu.
    )
    echo.
    pause
)
