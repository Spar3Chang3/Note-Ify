#TODO
@echo off
setlocal enabledelayedexpansion

echo =====================================
echo   Note-Ify Windows Setup (Step Mode)
echo =====================================

:: Ask for Discord Auth ID
echo Step 1: Enter Discord Auth ID
set /p DISCORD_AUTH=Enter your Discord Auth ID: 

if "%DISCORD_AUTH%"=="" (
    echo Discord Auth ID cannot be empty.
    pause
    exit /b 1
)

echo will save to .env

:: Check for Git
echo Step 2: Checking for Git
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo Git is not installed. Install Git for Windows first.
    pause
    exit /b 1
)
echo Git found.

:: Clone Note-Ify (skip if already exists)
echo Step 3: Cloning Note-Ify
if not exist "Note-Ify" (
    git clone https://github.com/Spar3Chang3/Note-Ify.git
    cd Note-Ify
    if %errorlevel% neq 0 (
        echo Git clone failed.
        pause
        exit /b 1
    )
) else (
    cd Note-Ify
    git pull
)

echo DISCORD_AUTH=%DISCORD_AUTH% > .env

:: Check for Bun
echo Step 4: Checking for Bun
where bun >nul 2>nul
if %errorlevel% neq 0 (
    echo Bun not found. Installing Bun...
    pause
    powershell -Command "irm https://bun.sh/install.ps1 | iex"
    set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
) else (
    echo Bun already installed.
)

:: Install dependencies and build Note-Ify
echo Step 5: Installing dependencies and building Note-Ify

if not exist "package.json" (
    echo package.json not found. Cannot install dependencies.
    pause
    exit /b 1
)

echo Running bun install...
echo ah, it's probably not a problem. Probably. But I'm showing a small discrepany in... well, no. It's well within acceptable bounds again. Sustaining sequence.
bun install
bun install
echo just ignore it like nothing happened. If something fails next, we worry.
if %errorlevel% neq 0 (
    echo bun install failed.
    pause
    exit /b 1
)

echo Building Note-Ify...
bun build index.js --compile --outfile noteify.exe
if %errorlevel% neq 0 (
    echo Ok, now we worry for sure. Binary Compilation failed.
    pause
    exit /b 1
)

cd ..


:: Install Ollama
echo Step 6: Installing Ollama. If anything past here fails it isn't our fault... probably.
powershell -Command "irm https://ollama.com/install.ps1 | iex"

:: Clone whisper.cpp
echo Step 7: Cloning whisper.cpp
if not exist "whisper.cpp" (
    git clone https://github.com/ggml-org/whisper.cpp.git
    if %errorlevel% neq 0 (
        echo whisper.cpp clone failed.
        pause
        exit /b 1
    )
) else (
    git pull
)

:: Download model
echo Step 8: Downloading ggml-base.bin
if not exist "whisper.cpp\ggml-base.en.bin" (
    .\models\download-ggml-model.cmd base.en
    if %errorlevel% neq 0 (
        echo Model download failed.
        pause
        exit /b 1
    )
) else (
    echo Model already exists. Skipping download.
)


:: Build whisper.cpp
echo Step 9: Building whisper.cpp
cd whisper.cpp

cmake -B build -S . -DCMAKE_BUILD_TYPE=Release -DGGML_VULKAN=1 -DGGML_BLAS=ON -DGGML_BLAS_VENDOR=OpenBLAS
if %errorlevel% neq 0 (
    echo CMake generation failed.
    pause
    exit /b 1
)

cmake --build build --config Release
if %errorlevel% neq 0 (
    echo Build failed.
    pause
    exit /b 1
)

cd ..

echo =====================================
echo            Setup Complete
echo =====================================
pause
