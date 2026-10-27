#!/usr/bin/env bash
# Usage: run_3dmem_pose_dir.sh <pose-dir> <conditions> [tag]
set -euo pipefail
cd /mnt/d/Projects/Projects2026/VLM
POSE_DIR="$PWD/${1:?pose dir required}"
CONDITIONS="${2:-gt}"
TAG="${3:-run}"
export GALLIUM_DRIVER=d3d12 MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA
export TORCH_HOME=/mnt/d/Projects/Projects2026/VLM/research/cache/torch
export HF_HOME=/mnt/d/Projects/Projects2026/VLM/research/cache/hf
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$PWD/research/runs/3dmem-pose-$TAG-$STAMP"
mkdir -p "$OUT"
set +e
research/envs/3dmem/bin/python -B research/scripts/run_3dmem_pose_association.py \
  --frames "$PWD/research/runs/replicacad-views-v17-dense48" --output "$OUT" \
  --conditions "$CONDITIONS" --pose-dir "$POSE_DIR" > "$OUT/run.log" 2>&1
CODE=$?
set -e
echo "exit=$CODE out=$OUT"
tail -6 "$OUT/run.log"
