param(
    [string]$Profile = "axotube",
    [string]$OutDir = "release"
)

$ErrorActionPreference = "Stop"
$tizen = "C:\tizen-studio\tools\ide\bin\tizen.bat"
$root = Split-Path -Parent $PSScriptRoot
$standalone = Join-Path $root "standalone"

Push-Location $root
try {
    Write-Host "==> npm test"
    npm run test
    if ($LASTEXITCODE -ne 0) { throw "tests failed" }

    Write-Host "==> npm run build:standalone"
    npm run build:standalone
    if ($LASTEXITCODE -ne 0) { throw "standalone build failed" }
} finally {
    Pop-Location
}

if (-not (Test-Path (Join-Path $standalone "service\dist\index.js"))) {
    throw "standalone/service/dist/index.js missing after fresh build"
}
if (-not (Test-Path (Join-Path $standalone "userscript\userScript.js"))) {
    throw "standalone/userscript/userScript.js missing after fresh build"
}

Push-Location $standalone
try {
    Write-Host "==> tizen build-web"
    & $tizen build-web -e ".*" -e "node_modules/*" -e "package*.json" -- $standalone
    if ($LASTEXITCODE -ne 0) { throw "build-web failed" }

    # The widget output lives inside the project, so build-web also stages old
    # packages from release/ and the stale standalone service files.
    $stagedRelease = Join-Path $standalone ".buildResult\release"
    if (Test-Path $stagedRelease) { Remove-Item -Recurse -Force $stagedRelease }
    $stagedService = Join-Path $standalone ".buildResult\service"
    if (Test-Path $stagedService) {
        Get-ChildItem $stagedService -Force | Where-Object { $_.Name -ne "dist" } |
            Remove-Item -Recurse -Force
        Get-ChildItem (Join-Path $stagedService "dist") -Force | Where-Object { $_.Name -ne "index.js" } |
            Remove-Item -Recurse -Force
    }

    $outPath = Join-Path $standalone $OutDir
    New-Item -ItemType Directory -Force -Path $outPath | Out-Null

    Write-Host "==> tizen package (-s $Profile)"
    & $tizen package -t wgt -o $outPath -s $Profile -- (Join-Path $standalone ".buildResult")
    if ($LASTEXITCODE -ne 0) { throw "package failed" }

    Get-ChildItem $outPath -Filter *.wgt | Select-Object FullName, Length, LastWriteTime
} finally {
    Pop-Location
}
