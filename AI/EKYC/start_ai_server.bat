@echo off
chcp 65001 > nul
title FastAPI E-KYC Laptop AI Server (:8000)
echo ===================================================
echo   FASTAPI E-KYC AI SERVER - LAPTOP WEBCAM (:8000)
echo ===================================================
cd /d "%~dp0"

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do (
    echo [THONG BAO] Phat hien cong 8000 dang bi chiem boi tien trinh cu [PID %%a]. Dang giai phong...
    taskkill /F /PID %%a >nul 2>nul
    ping 127.0.0.1 -n 2 >nul
)

REM 1. Uu tien Virtual Environment trong thu muc du an (.venv / venv) neu co
if exist "%~dp0.venv\Scripts\python.exe" (
    echo [THONG BAO] Phat hien .venv tai thu muc du an. Dang khoi dong...
    "%~dp0.venv\Scripts\python.exe" server_module/app.py
    pause
    exit /b
)
if exist "%~dp0venv\Scripts\python.exe" (
    echo [THONG BAO] Phat hien venv tai thu muc du an. Dang khoi dong...
    "%~dp0venv\Scripts\python.exe" server_module/app.py
    pause
    exit /b
)

REM 2. Kiem tra moi truong PlatformIO Python (noi da cai dat day du ultralytics & dependencies)
if exist "%USERPROFILE%\.platformio\penv\Scripts\python.exe" (
    "%USERPROFILE%\.platformio\penv\Scripts\python.exe" -c "import ultralytics" >nul 2>nul
    if not errorlevel 1 (
        echo [THONG BAO] Su dung moi truong Python PlatformIO tai %USERPROFILE%\.platformio\penv...
        "%USERPROFILE%\.platformio\penv\Scripts\python.exe" server_module/app.py
        pause
        exit /b
    )
)

REM 3. Kiem tra Python he thong co ultralytics khong
where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    python -c "import ultralytics" >nul 2>nul
    if not errorlevel 1 (
        echo [THONG BAO] Su dung Python he thong...
        python server_module/app.py
        pause
        exit /b
    )
)

REM 4. Kiem tra trinh khoi chay py launcher
where py >nul 2>nul
if %ERRORLEVEL% equ 0 (
    py -3.11 -c "import ultralytics" >nul 2>nul
    if not errorlevel 1 (
        echo [THONG BAO] Su dung py -3.11...
        py -3.11 server_module/app.py
        pause
        exit /b
    )
    py -3 -c "import ultralytics" >nul 2>nul
    if not errorlevel 1 (
        echo [THONG BAO] Su dung py -3...
        py -3 server_module/app.py
        pause
        exit /b
    )
)

REM 5. Fallback neu chua tim duoc moi truong co ultralytics
where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [CANH BAO] Dang chay thu bang Python mac dinh (co the thieu thu vien)...
    python server_module/app.py
    pause
    exit /b
)

echo [LOI] Khong tim thay Python phu hop! Vui long kiem tra lai duong dan Python hoac chay:
echo       pip install -r requirements.txt
pause
