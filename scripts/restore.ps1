$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$distPath = Join-Path $projectRoot "dist"

if (-not (Test-Path -LiteralPath (Join-Path $distPath "manifest.json"))) {
    throw "The backup does not contain a built extension in its dist folder."
}

$ollamaCommand = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollamaCommand) {
    $wingetCommand = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $wingetCommand) {
        throw "Ollama is not installed and winget is unavailable. Install Ollama from https://ollama.com/download, then run this script again."
    }

    Write-Host "Installing Ollama..."
    & $wingetCommand.Source install --id Ollama.Ollama --exact --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "Ollama installation failed with exit code $LASTEXITCODE."
    }

    $ollamaInstallPath = Join-Path $env:LOCALAPPDATA "Programs\Ollama"
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath;$ollamaInstallPath"
    $ollamaCommand = Get-Command ollama -ErrorAction SilentlyContinue
    if (-not $ollamaCommand) {
        throw "Ollama was installed, but its command was not found. Open a new PowerShell window and run this script again."
    }
}

$ollamaPath = $ollamaCommand.Source

function Test-OllamaServer {
    try {
        $null = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 2
        return $true
    }
    catch {
        return $false
    }
}

if (-not (Test-OllamaServer)) {
    Write-Host "Starting the local Ollama service..."
    Start-Process -FilePath $ollamaPath -ArgumentList "serve" -WindowStyle Hidden

    $serverStarted = $false
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        if (Test-OllamaServer) {
            $serverStarted = $true
            break
        }
        Start-Sleep -Seconds 2
    }

    if (-not $serverStarted) {
        throw "Ollama did not start at localhost:11434. Start Ollama and run this script again."
    }
}

Write-Host "Downloading the qwen2.5:3b model. This may take a while..."
& $ollamaPath pull "qwen2.5:3b"
if ($LASTEXITCODE -ne 0) {
    throw "Ollama could not download qwen2.5:3b (exit code $LASTEXITCODE)."
}

Write-Host ""
Write-Host "Ollama and qwen2.5:3b are ready."
Write-Host "To restore DevLens, open chrome://extensions, enable Developer mode, select Load unpacked, and choose:"
Write-Host $distPath
Write-Host "If AI access returns HTTP 403, follow the OLLAMA_ORIGINS instructions in README.md."
