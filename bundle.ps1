# PowerShell 7: both archives use the same Node packaging implementation.
#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Player build failed.' }
    $releaseVersion = (Get-Content -LiteralPath 'manifest.json' -Raw | ConvertFrom-Json).version
    foreach ($releaseBrowser in @('chrome', 'firefox')) {
        if ($releaseBrowser -eq 'firefox') { & node scripts/package-chrome.mjs --firefox }
        else { & node scripts/package-chrome.mjs }
        if ($LASTEXITCODE -ne 0) { throw "Packaging failed: $releaseBrowser" }
        $releaseFolder = Join-Path $PSScriptRoot "dist/youlyplus-amll-$releaseBrowser"
        $releaseZip = Join-Path $PSScriptRoot "dist/youlyplus-v$releaseVersion-$releaseBrowser.zip"
        Compress-Archive -Path (Join-Path $releaseFolder '*') -DestinationPath $releaseZip -Force
        Write-Host $releaseZip
    }
} finally { Pop-Location }
