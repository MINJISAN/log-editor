@echo off
cd /d %~dp0

echo Starting dev server...
start "" cmd /k npm run dev

REM Vite 서버가 뜰 시간을 조금 기다림
timeout /t 3 >nul

echo Opening browser...
start http://localhost:5173
