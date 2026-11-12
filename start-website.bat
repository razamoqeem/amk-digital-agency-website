@echo off
rem AMK Digital Agency Website: builds the pages, then opens the site with working tools.
cd /d "%~dp0"
".venv\Scripts\python.exe" cms\build.py
if errorlevel 1 pause & exit /b 1
start "" http://localhost:8080
".venv\Scripts\python.exe" -m uvicorn api.main:app --port 8080
pause
