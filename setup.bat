::TODO
@echo off
setlocal enabledelayedexpansion
set "needsrestart=false"

echo TODO dynamic location
mkdir C:\Users\%USERNAME%\Note-ify
cd C:\Users\%USERNAME%\Note-ify

echo TODO: preserve directory path when running as admin, check this works
:: Check for admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Elevating privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs -WorkingDirectory '%CD%'"
    exit /b
)

echo =====================================
echo   Note-Ify Windows Setup (Step Mode)
echo =====================================

:: Ask for Discord Token
echo Step 1: Enter Discord Token
set /p DISCORD_AUTH=Enter your Discord Bot Token (leave blank to skip): 

echo will save to .env if changed

:: Check for Git
echo Step 2: Checking for Git
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo Git is not installed. Installing via winget.
    winget install --id Git.Git -e --source winget --silent --accept-package-agreements --accept-source-agreements
    set "needsrestart=true"
) else (
echo Git found.)

"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" ^
 -latest ^
 -products * ^
 -requires Microsoft.VisualStudio.Workload.NativeDesktop ^
 -property installationPath >nul

if %errorlevel% neq 0 (
    echo Desktop development with C++ not found.
    echo Press any key to install Visual Studio C++. This can take up several GB and take a while.
    curl -L -o vs_buildtools.exe https://aka.ms/vs/17/release/vs_BuildTools.exe

    vs_buildtools.exe ^
    --quiet ^
    --wait ^
    --norestart ^
    --nocache ^
    --add Microsoft.VisualStudio.Workload.VCTools ^
    --includeRecommended
    set "needsrestart=true"
) else (
    echo Desktop development with C++ workload already installed.
)

cmake --version >nul 2>nul

if %errorlevel% neq 0 (
    echo CMake not found. Installing...
    curl -L -o cmake.msi https://github.com/Kitware/CMake/releases/latest/download/cmake-latest-windows-x86_64.msi
    msiexec /i cmake.msi /quiet /norestart ADD_CMAKE_TO_PATH=System
    set "needsrestart=true"
) else (
    echo CMake already installed.
)
if defined VULKAN_SDK (
    echo Vulkan SDK detected at %VULKAN_SDK%
) else (
    curl -L -o vulkan_sdk_latest.exe https://sdk.lunarg.com/sdk/download/latest/windows/vulkan_sdk.exe
    vulkan_sdk_latest.exe --accept-licenses --default-answer --confirm-command install
    set "needsrestart=true"
)

if %needsrestart%==true (
    set 
    echo TODO: MAKE better. Auto restarts, auto refreshes path.
    ::powershell -Command "Start-Process cmd -ArgumentList '/k \"%~f0\" restarted'"
    echo RE-RUN INSTALL .BAT PLEASE. PREREQUISITES INSTALLED.
    pause
    exit /b 1
)

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
where ollama >nul 2>nul
if %errorlevel% neq 0 (
    echo Ollama not found. Installing...
    powershell -Command "irm https://ollama.com/install.ps1 | iex"
) else (
    echo Ollama found:
    ollama --version
)

:: Clone whisper.cpp
echo Step 7: Cloning whisper.cpp
if not exist "whisper.cpp" (
    git clone https://github.com/ggml-org/whisper.cpp.git
    cd whisper.cpp
    if %errorlevel% neq 0 (
        echo whisper.cpp clone failed.
        pause
        exit /b 1
    )
) else (
    cd whisper.cpp
    git pull
)

:: Build whisper.cpp
echo Step 9: Building whisper.cpp

vulkaninfo >nul 2>nul

if %errorlevel% neq 0 (
    echo no vulkan support?
    cmake -B build -S . -DCMAKE_BUILD_TYPE=Release
) else (
    cmake -B build -S . -DCMAKE_BUILD_TYPE=Release -DGGML_VULKAN=1
)

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

:: Download model
echo Step 8: Downloading ggml-base.bin
mkdir .\build\bin\Release\models
if not exist ".\build\bin\Release\models\ggml-base.en.bin" (
    call .\models\download-ggml-model.cmd base.en
    move ggml-base.en.bin .\build\bin\Release\models
    if %errorlevel% neq 0 (
        echo Model download failed.
    )
) else (
    echo Model already exists. Skipping download.
)

cd ..

:: -------------------------
:: Create start_noteify.bat
:: -------------------------
if not exist start_noteify.bat (
(
echo @echo off
echo tasklist ^| find /i "noteify.exe" ^>nul
echo if %%errorlevel%%==0 (
echo     echo Noteify already running.
echo     pause
echo     exit /b
echo ^)
echo cd /d "Note-ify"
echo start noteify.exe
) > start_noteify.bat
)

:: -------------------------
:: Create start_ollama.bat
:: -------------------------
if not exist start_ollama.bat (
(
echo @echo off
echo tasklist ^| find /i "ollama.exe" ^>nul
echo if %%errorlevel%%==0 (
echo     echo Ollama already running.
echo     pause
echo     exit /b
echo ^)
echo echo Starting Ollama server...
echo start "" ollama serve
) > start_ollama.bat
)

:: -------------------------
:: Create start_whisper.bat
:: -------------------------
if not exist start_whisper.bat (
(
echo @echo off
echo tasklist ^| find /i "whisper-server.exe" ^>nul
echo if %%errorlevel%%==0 (
echo     echo Whisper server already running.
echo     pause
echo     exit /b
echo ^)
echo cd /d "whisper.cpp\build\bin\release"
echo start whisper-server.exe
) > start_whisper.bat
)

if not exist start_all.bat (
(
echo @echo off
echo start "Noteify" cmd /k start_noteify.bat
echo start "Ollama"  cmd /k start_ollama.bat
echo start "Whisper" cmd /k start_whisper.bat
) > start_all.bat
)

echo =====================================
echo            Setup Complete
echo =====================================
echo Run "start_all.bat" to start all services after you modify Note-ify's config.toml
pause
