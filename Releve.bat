@echo off
setlocal
title Releve - Journal de theses
cd /d "%~dp0"

REM ---------------------------------------------------------------------------
REM Lanceur. Double-clic, rien d'autre.
REM
REM Cette fenetre reste ouverte tant que l'application tourne. La fermer arrete
REM l'application. Si quelque chose echoue, le message s'affiche ICI : ne la
REM ferme pas avant de l'avoir lu.
REM ---------------------------------------------------------------------------

echo.
echo   RELEVE — Journal de theses
echo   ---------------------------------------------------------------
echo.

REM --- 1. Une instance tourne-t-elle deja ?
netstat -ano | findstr /r /c:":8501 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo   Une instance de Releve tourne deja.
    echo   Ouverture de http://localhost:8501
    echo.
    echo   Pour la redemarrer proprement : lance "Arreter Releve.bat" d'abord.
    echo.
    start "" http://localhost:8501
    timeout /t 4 >nul
    exit /b 0
)

REM --- 2. Python present ?
set "PY="
where python >nul 2>&1 && set "PY=python"
if not defined PY where py >nul 2>&1 && set "PY=py"
if not defined PY (
    echo   [ERREUR] Python est introuvable.
    echo.
    echo   Installe-le depuis https://python.org
    echo   en cochant "Add python.exe to PATH" sur le PREMIER ecran.
    echo.
    pause
    exit /b 1
)

REM --- 3. Environnement isole
if not exist ".venv\Scripts\python.exe" (
    echo   Premier lancement : preparation de l'environnement.
    echo   2 a 3 minutes. Une seule fois. Ne ferme pas cette fenetre.
    echo.
    %PY% -m venv .venv
    if errorlevel 1 (
        echo   [ERREUR] Creation de l'environnement impossible.
        pause
        exit /b 1
    )
    ".venv\Scripts\python.exe" -m pip install --upgrade pip --quiet
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt
    if errorlevel 1 (
        echo.
        echo   [ERREUR] Installation des dependances echouee.
        echo   Verifie ta connexion internet, puis relance.
        pause
        exit /b 1
    )
    echo.
    echo   Environnement pret.
    echo.
)

REM --- 4. Verification du noyau : si les chiffres sont faux, autant le savoir ici.
echo   Verification du noyau...
".venv\Scripts\python.exe" -m pytest tests/ -q --no-header 2>nul | findstr /c:"passed"
if errorlevel 1 (
    echo   [ATTENTION] Des tests echouent. L'app va demarrer, mais certains
    echo               chiffres peuvent etre faux. Signale-le.
    echo.
)

REM --- 5. Demarrage
echo.
echo   Demarrage... le navigateur va s'ouvrir sur http://localhost:8501
echo   Ferme CETTE fenetre pour arreter l'application.
echo.
start "" http://localhost:8501
".venv\Scripts\python.exe" -m streamlit run app\main.py

REM Si streamlit se termine tout seul, c'est une erreur : on garde la fenetre.
echo.
echo   L'application s'est arretee.
pause
