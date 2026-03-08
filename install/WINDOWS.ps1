#Requires -Version 5.1

#Requires -Version 5.1

# Self-elevate to Administrator if not already elevated
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "Requesting Administrator privileges..." -ForegroundColor Yellow

    if (-not $PSCommandPath) {
        throw "Cannot self-elevate because PSCommandPath is empty. Save and run this as a .ps1 file."
    }

    Start-Process `
        -FilePath "powershell.exe" `
        -Verb RunAs `
        -WorkingDirectory (Get-Location) `
        -ArgumentList @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", $PSCommandPath
        )

    exit
}

$ErrorActionPreference = "Stop"

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-IsAdmin {
    $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Ensure-Command {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommandName,

        [Parameter(Mandatory = $true)]
        [string]$InstallCommand
    )

    if (Get-Command $CommandName -ErrorAction SilentlyContinue) {
        Write-Host "$CommandName is already installed." -ForegroundColor Green
        return
    }

    Write-Host "$CommandName was not found. Installing..." -ForegroundColor Yellow

    $proc = Start-Process -FilePath "powershell.exe" `
        -ArgumentList @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-Command", $InstallCommand
        ) `
        -PassThru `
        -Wait

    if ($proc.ExitCode -ne 0) {
        throw "Installation for '$CommandName' failed with exit code $($proc.ExitCode)."
    }

    # Refresh PATH from machine + user after installer completes.
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")

    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        throw "'$CommandName' still was not found after installation."
    }

    Write-Host "$CommandName installed successfully." -ForegroundColor Green
}

function Download-File {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,

        [Parameter(Mandatory = $true)]
        [string]$OutFile
    )

    Write-Host "Downloading: $Url"
    Invoke-WebRequest -Uri $Url -OutFile $OutFile
}

function Remove-PathIfExists {
    param([string]$PathToRemove)

    if (Test-Path $PathToRemove) {
        Remove-Item -LiteralPath $PathToRemove -Recurse -Force
    }
}

function Copy-DirectoryContents {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceDir,

        [Parameter(Mandatory = $true)]
        [string]$DestinationDir
    )

    if (-not (Test-Path $DestinationDir)) {
        New-Item -ItemType Directory -Path $DestinationDir -Force | Out-Null
    }

    Get-ChildItem -LiteralPath $SourceDir -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $DestinationDir -Recurse -Force
    }
}

function New-DesktopShortcut {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetPath,

        [Parameter(Mandatory = $true)]
        [string]$ShortcutPath,

        [string]$WorkingDirectory = ""
    )

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $TargetPath

    if ($WorkingDirectory) {
        $shortcut.WorkingDirectory = $WorkingDirectory
    }

    $shortcut.IconLocation = $TargetPath
    $shortcut.Save()
}

try {
    Write-Step "Checking for administrator privileges"
    if (-not (Test-IsAdmin)) {
        throw "This script must be run as Administrator because it writes to C:\Program Files."
    }

    Write-Step "Checking/installing Bun"
    Ensure-Command -CommandName "bun" -InstallCommand 'irm bun.sh/install.ps1 | iex'

    Write-Step "Checking/installing Ollama"
    Ensure-Command -CommandName "ollama" -InstallCommand 'irm https://ollama.com/install.ps1 | iex'

    Write-Step "Launching Ollama model in a separate window"
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList @(
            "-NoExit",
            "-Command",
            'ollama pull huihui_ai/qwen3-abliterated:8b-v2'
        ) | Out-Null

    $programFiles = ${env:ProgramFiles}
    $installRoot = Join-Path $programFiles "Note-Ify"
    $whisperDir = Join-Path $installRoot "whisper.cpp"
    $modelsDir = Join-Path $whisperDir "models"

    $whisperZip = Join-Path $installRoot "whisper-blas-bin-x64.zip"
    $botZip = Join-Path $installRoot "note-ify-main.zip"

    $whisperExtractTemp = Join-Path $env:TEMP "note-ify-whisper-extract"
    $botExtractTemp = Join-Path $env:TEMP "note-ify-bot-extract"

    Write-Step "Creating install folder"
    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
    Set-Location $installRoot

    Write-Step "Downloading whisper.cpp release zip"
    Download-File `
        -Url "https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-blas-bin-x64.zip" `
        -OutFile $whisperZip

    Write-Step "Extracting whisper.cpp"
    Remove-PathIfExists $whisperExtractTemp
    New-Item -ItemType Directory -Path $whisperExtractTemp -Force | Out-Null
    Expand-Archive -LiteralPath $whisperZip -DestinationPath $whisperExtractTemp -Force

    New-Item -ItemType Directory -Path $whisperDir -Force | Out-Null

    $releasesDir = Get-ChildItem -Path $whisperExtractTemp -Directory -Recurse |
        Where-Object { $_.Name -eq "Releases" } |
        Select-Object -First 1

    if (-not $releasesDir) {
        throw "Could not find inner 'Releases' directory in the whisper.cpp archive."
    }

    Copy-DirectoryContents -SourceDir $releasesDir.FullName -DestinationDir $whisperDir

    Write-Step "Downloading Note-Ify source zip"
    Download-File `
        -Url "https://github.com/Spar3Chang3/Note-Ify/archive/refs/heads/main.zip" `
        -OutFile $botZip

    Write-Step "Extracting Note-Ify source"
    Remove-PathIfExists $botExtractTemp
    New-Item -ItemType Directory -Path $botExtractTemp -Force | Out-Null
    Expand-Archive -LiteralPath $botZip -DestinationPath $botExtractTemp -Force

    $botRoot = Get-ChildItem -Path $botExtractTemp -Directory | Select-Object -First 1
    if (-not $botRoot) {
        throw "Could not find extracted Note-Ify source folder."
    }

    Copy-DirectoryContents -SourceDir $botRoot.FullName -DestinationDir $installRoot

    Write-Step "Cleaning up zip files"
    Remove-PathIfExists $whisperZip
    Remove-PathIfExists $botZip

    Write-Step "Creating whisper.cpp\models and downloading ggml-base.en.bin"
    New-Item -ItemType Directory -Path $modelsDir -Force | Out-Null

    # Uses the direct downloadable file URL instead of the webpage /blob/ URL.
    $modelFile = Join-Path $modelsDir "ggml-base.en.bin"
    Download-File `
        -Url "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin?download=true" `
        -OutFile $modelFile

    Write-Step "Building Note-Ify executable with Bun"
    Set-Location $installRoot
    & bun build --compile index.js --outfile note-ify.exe

    if ($LASTEXITCODE -ne 0) {
        throw "bun build failed with exit code $LASTEXITCODE."
    }

    $exePath = Join-Path $installRoot "note-ify.exe"
    if (-not (Test-Path $exePath)) {
        throw "Build appeared to finish, but note-ify.exe was not found."
    }

    Write-Step "Creating desktop shortcut"
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktopPath "Note-Ify.lnk"

    New-DesktopShortcut `
        -TargetPath $exePath `
        -ShortcutPath $shortcutPath `
        -WorkingDirectory $installRoot

    Write-Step "Final instructions"
    Write-Host "Installation complete." -ForegroundColor Green
    Write-Host ""
    Write-Host "Please open this file and paste your Discord key into the setting named 'discord_key':" -ForegroundColor Yellow
    Write-Host "C:\Program Files\Note-Ify\conf\conf.toml" -ForegroundColor White
    Write-Host ""
    Read-Host "Press Enter to exit"
}
catch {
    Write-Host ""
    Write-Host "INSTALL FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}
