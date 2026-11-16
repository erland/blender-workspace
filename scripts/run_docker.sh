#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p out
docker build -t blender-workspace:dev001 .
docker run --rm --cpus 2 --memory 8g --user "$(id -u):$(id -g)" -v "$(pwd)/out:/workspace/out" blender-workspace:dev001
