@echo off
title Releve - accessible depuis le telephone
cd /d "%~dp0"

REM Lance l'app en l'exposant au reseau local.
REM Ouvre ensuite l'adresse "Network URL" affichee ci-dessous depuis le
REM navigateur de ton telephone. PC et telephone doivent etre sur le meme Wi-Fi.
REM Rien ne sort de ton reseau : aucun cloud, aucun tiers.

if not exist ".venv\Scripts\python.exe" (
    echo   Lance d'abord Releve.bat une fois pour installer l'environnement.
    pause
    exit /b 1
)

echo.
echo   Adresses a ouvrir depuis ton telephone :
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo      http://%%a:8501
echo.
".venv\Scripts\python.exe" -m streamlit run app\main.py --server.address 0.0.0.0
