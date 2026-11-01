$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$stagingDir = Join-Path ([System.IO.Path]::GetTempPath()) "devlens-backup-$([guid]::NewGuid().ToString('N'))"
$backupDir = Join-Path $projectRoot "backups"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$archivePath = Join-Path $backupDir "devlens-backup-$timestamp.zip"
$excludedItems = @(".git", "node_modules", "backups")

Push-Location $projectRoot
try {
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "The project build failed; no backup was created."
    }
}
finally {
    Pop-Location
}

New-Item -ItemType Directory -Path $stagingDir | Out-Null
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

try {
    Get-ChildItem -LiteralPath $projectRoot -Force |
        Where-Object { $_.Name -notin $excludedItems } |
        ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination $stagingDir -Recurse -Force
        }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $stagingDir,
        $archivePath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )

    Write-Output "Backup created: $archivePath"
}
finally {
    Remove-Item -LiteralPath $stagingDir -Recurse -Force
}
