#!/usr/bin/env bash
# Isolated environment only. Does not execute upstream setup/download scripts.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAMBA="$ROOT/../run/habitat-runtime/bin/micromamba"
export MAMBA_ROOT_PREFIX="$ROOT/cache/mamba"
export PIP_CACHE_DIR="$ROOT/cache/pip"
export PYTHONDONTWRITEBYTECODE=1
mkdir -p "$ROOT/reports" "$ROOT/envs" "$ROOT/cache"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
exec > "$ROOT/reports/findingdory-bootstrap-$STAMP.log" 2>&1
trap 'rc=$?; echo "bootstrap exit=$rc at $(date -u --iso-8601=seconds)"' EXIT
"$MAMBA" create --dry-run -p "$ROOT/envs/findingdory" python=3.9 habitat-sim=0.3.1 withbullet headless pip libglvnd libegl libopengl -c conda-forge -c aihabitat --json > "$ROOT/reports/findingdory-solve-$STAMP.json"
"$MAMBA" create -y -p "$ROOT/envs/findingdory" python=3.9 habitat-sim=0.3.1 withbullet headless pip libglvnd libegl libopengl -c conda-forge -c aihabitat
"$MAMBA" list -p "$ROOT/envs/findingdory" --explicit > "$ROOT/reports/findingdory-conda-$STAMP.txt"
env GALLIUM_DRIVER=d3d12 MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA "$ROOT/envs/findingdory/bin/python" -B "$ROOT/scripts/habitat_smoke.py" --egl-default-device
"$ROOT/envs/findingdory/bin/python" -B "$ROOT/scripts/environment_probe.py"
