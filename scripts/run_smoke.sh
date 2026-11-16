#!/usr/bin/env bash
set -euo pipefail
cd /workspace
OUT="${BW_OUTPUT:-/workspace/out}"
mkdir -p "$OUT"
export BW_OUTPUT="$OUT"
start=$(date +%s)
blender -b -t 2 --factory-startup --python blender_workspace_poc/create_monster.py
blender -b -t 2 --factory-startup --python blender_workspace_poc/revise_monster.py
python3 tests/verify_manifest.py "$OUT"
python3 tests/verify_glb.py "$OUT/monster_v1.glb" "$OUT/monster_v2.glb"
blender -b -t 2 --factory-startup --python blender_workspace_poc/inspect_blend.py -- "$OUT/monster_v1.blend" | grep '^BW_INSPECTION='
blender -b -t 2 --factory-startup --python blender_workspace_poc/inspect_blend.py -- "$OUT/monster_v2.blend" | grep '^BW_INSPECTION='
echo "BW_METRIC stage=total duration_seconds=$(($(date +%s)-start))"
echo 'BW_SMOKE PASS'
