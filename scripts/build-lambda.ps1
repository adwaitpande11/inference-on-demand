# Builds the Lambda deployment package into .build/lambda-packages/ (PowerShell)
# Run this before every `terraform apply` when api/ source has changed.

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$PackageDir = Join-Path $RepoRoot ".build\lambda-packages"

Write-Host "==> Cleaning previous build..."
if (Test-Path "$RepoRoot\.build") {
    Remove-Item -Recurse -Force "$RepoRoot\.build"
}
New-Item -ItemType Directory -Force -Path $PackageDir | Out-Null

Write-Host "==> Installing dependencies..."
python -m pip install --quiet --target $PackageDir -r "$RepoRoot\api\requirements.txt"

Write-Host "==> Copying source files..."
Copy-Item -Path "$RepoRoot\api\*" -Destination $PackageDir -Recurse -Force

Write-Host "==> Done. Package is at .build\lambda-packages\"
Write-Host "    Now run: cd deploy/aws && terraform apply"
