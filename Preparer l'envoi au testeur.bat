@echo off
chcp 850 >nul
title Relev? - pr?parer l'envoi ? un testeur
cd /d "%~dp0"

echo.
echo   RELEV? - pr?paration du dossier ? envoyer
echo   ==========================================
echo.
echo   Fabrique une copie PROPRE du programme dans "dist-testeur\Releve",
echo   avec une notice, et la compresse en ZIP pr?t ? envoyer.
echo.

if not exist "dist\Releve\Releve.exe" (
    echo   ?CHEC : le programme n'a pas encore ?t? construit.
    echo   Lance d'abord "Construire l'exe.bat".
    pause
    exit /b 1
)

echo   [1/4] Copie du programme...
if exist "dist-testeur" rmdir /s /q "dist-testeur"
mkdir "dist-testeur\Releve"
xcopy "dist\Releve" "dist-testeur\Releve" /E /I /Q /Y >nul

echo   [2/4] Ajout de la notice...
copy /y "LISEZ-MOI-testeur.txt" "dist-testeur\Releve\LISEZ-MOI.txt" >nul

echo   [3/4] V?rification - aucune donn?e personnelle...
rem  Le programme n'?crit jamais dans son propre dossier (les donn?es vont dans
rem  le profil de l'utilisateur), donc une copie est vierge par construction.
rem  On le V?RIFIE quand m?me : une v?rification qui n'?choue jamais ne co?te
rem  rien, et celle-ci a d?j? attrap? un rapport de trading oubli?.
set FUITE=0
if exist "dist-testeur\Releve\*.jsonl" set FUITE=1
if exist "dist-testeur\Releve\_internal\data" set FUITE=1
if exist "dist-testeur\Releve\_internal\tests" set FUITE=1
if "%FUITE%"=="1" (
    echo.
    echo   ?CHEC : des fichiers de donn?es se trouvent dans la copie.
    echo   NE PAS ENVOYER. Signale-le avant d'aller plus loin.
    pause
    exit /b 1
)

echo   [4/4] Compression...
if exist "dist-testeur\Releve.zip" del "dist-testeur\Releve.zip"
powershell -NoProfile -Command "Compress-Archive -Path 'dist-testeur\Releve' -DestinationPath 'dist-testeur\Releve.zip' -CompressionLevel Optimal"

echo.
echo   ==========================================
echo   TERMIN?.
echo.
echo   ? envoyer :  dist-testeur\Releve.zip
echo.
echo   La personne d?compresse, ouvre le dossier, double-clique Releve.exe.
echo   Ses donn?es iront dans SON dossier utilisateur - jamais dans le tien.
echo   ==========================================
echo.
pause
