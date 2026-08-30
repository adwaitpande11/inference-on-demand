#!/usr/bin/env bash
# Builds the Lambda deployment package into .build/lambda-packages/.
# Run this before every `terraform apply` when api/ source has changed.
#
# Why this exists outside Terraform:
#   archive_file is evaluated at plan time. If the build step ran inside
#   Terraform (via null_resource), the zip hash would be stale at plan time
#   and Lambda updates would never be detected. Running the build first
#   ensures the correct hash is computed when `terraform plan` reads the dir.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_DIR="$REPO_ROOT/.build/lambda-packages"

echo "==> Cleaning previous build..."
rm -rf "$REPO_ROOT/.build"
mkdir -p "$PACKAGE_DIR"

echo "==> Installing dependencies..."
pip3 install --quiet --target "$PACKAGE_DIR" \
  -r "$REPO_ROOT/api/requirements.txt"

echo "==> Copying source files..."
cp -r "$REPO_ROOT/api/." "$PACKAGE_DIR/"

echo "==> Done. Package is at .build/lambda-packages/"
echo "    Now run: cd deploy/aws && terraform apply"

