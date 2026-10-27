#!/usr/bin/env bash
# Native 3D-Mem simulator base only; model and asset installs are separate.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export MAMBA_ROOT_PREFIX="$ROOT/cache/mamba"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
exec > "$ROOT/reports/3dmem-base-$STAMP.log" 2>&1
trap 'rc=$?; echo "3dmem base exit=$rc at $(date -u --iso-8601=seconds)"' EXIT
MAMBA="$ROOT/../run/habitat-runtime/bin/micromamba"
PREFIX="$ROOT/envs/3dmem"
"$MAMBA" create --dry-run -p "$PREFIX" -c conda-forge -c aihabitat python=3.9 habitat-sim=0.2.5 headless faiss-cpu=1.7.4 libglvnd libegl libopengl pip --json > "$ROOT/reports/3dmem-base-solve-$STAMP.json"
"$MAMBA" create -y -p "$PREFIX" -c conda-forge -c aihabitat python=3.9 habitat-sim=0.2.5 headless faiss-cpu=1.7.4 libglvnd libegl libopengl pip
"$MAMBA" list -p "$PREFIX" --explicit > "$ROOT/reports/3dmem-base-explicit-$STAMP.txt"
env GALLIUM_DRIVER=d3d12 MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA "$PREFIX/bin/python" -B "$ROOT/scripts/habitat_smoke.py" --egl-default-device
