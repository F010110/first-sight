#!/usr/bin/env bash
set -euo pipefail
cd /mnt/d/Projects/Projects2026/VLM
export GALLIUM_DRIVER=d3d12 MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA
OUT="${1:-research/runs/replicacad-views-v8}"
FRAMES="${2:-16}"
research/envs/3dmem/bin/python -B research/scripts/render_replicacad_views.py \
  --scene apt_1_static --output "$OUT" --frames "$FRAMES" 2>&1 | tail -6
