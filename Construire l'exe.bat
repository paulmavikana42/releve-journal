@echo off
chcp 850 >nul
title Relev? - construction de l'application
cd /d "%~dp0"

echo.
echo   RELEV? - construction du programme distribuable
echo   ================================================
echo.
echo   Ce script fabrique le dossier "dist\Releve" que tu pourras
echo   donner ? quelqu'un d'autre : il contient Python, Streamlit et
echo   l'application. La personne n'a RIEN ? installer.
echo.
echo   Compte 5 ? 10 minutes la premi?re fois.
echo.

if not exist ".venv\Scripts\python.exe" (
    echo   [1/4] Cr?ation de l'environnement Python...
    python -m venv .venv
    if errorlevel 1 (
        echo.
        echo   ?CHEC : Python n'est pas install? sur cette machine.
        echo   Installe-le depuis python.org en cochant "Add python.exe to PATH".
        pause
        exit /b 1
    )
) else (
    echo   [1/4] Environnement Python : d?j? l?.
)

echo   [2/4] Installation des d?pendances...
".venv\Scripts\python.exe" -m pip install --quiet --disable-pip-version-check -r requirements.txt
".venv\Scripts\python.exe" -m pip install --quiet --disable-pip-version-check pyinstaller

echo   [3/4] V?rification (les tests doivent tous passer)...
".venv\Scripts\python.exe" -m pytest tests/ -q --no-header
if errorlevel 1 (
    echo.
    echo   ?CHEC : des tests ne passent pas. On ne construit pas un programme
    echo   dont on sait qu'il ment. Corrige d'abord, reconstruis ensuite.
    pause
    exit /b 1
)

echo   [4/4] Construction du programme (c'est la partie longue)...
rem  Le programme ne doit pas tourner pendant qu'on le remplace : Windows
rem  verrouille ses fichiers, la construction ?choue ? mi-chemin et laisse un
rem  dossier incomplet. On ferme d'abord, sans ?tat d'?me.
taskkill /f /im Releve.exe >nul 2>&1
rem  On VIDE le dossier de sortie ensuite. PyInstaller ?crase les fichiers qu'il
rem  produit, mais ne supprime jamais ceux qu'il ne produit plus : un fichier
rem  retir? de la recette resterait dans le programme distribu? - c'est ainsi
rem  qu'un rapport de trading personnel a bien failli repartir dans un exe.
if exist "dist\Releve" rmdir /s /q "dist\Releve"
".venv\Scripts\python.exe" -m PyInstaller releve.spec --noconfirm --clean --distpath dist --workpath build
if errorlevel 1 (
    echo.
    echo   ?CHEC de la construction. Le d?tail est au-dessus.
    pause
    exit /b 1
)

echo.
echo   ================================================
echo   TERMIN?.
echo.
echo   Le programme est dans :  dist\Releve\
echo   Le fichier ? lancer   :  dist\Releve\Releve.exe
echo.
echo   Pour le donner ? quelqu'un : compresse le dossier "Releve"
echo   en ZIP et envoie-le. Il d?compresse, il double-clique, c'est tout.
echo.
echo   Ses donn?es ? lui iront dans son propre dossier utilisateur
echo   (%%LOCALAPPDATA%%\Releve\data) - jamais dans le programme.
echo   ================================================
echo.
pause
