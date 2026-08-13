@echo off
title Arreter Releve
echo.
echo   Arret de Releve...

for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":8501 .*LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
    echo   Processus %%p arrete.
)

echo   Termine.
timeout /t 2 >nul
