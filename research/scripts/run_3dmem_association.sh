#!/usr/bin/env bash
set -euo pipefail
cd /mnt/d/Projects/Projects2026/VLM
export GALLIUM_DRIVER=d3d12 MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA
export TORCH_HOME=/mnt/d/Projects/Projects2026/VLM/research/cache/torch
export HF_HOME=/mnt/d/Projects/Projects2026/VLM/research/cache/hf
FRAMES="$PWD/${1:-research/runs/replicacad-views-v15}"
CONDITIONS="${2:-gt,yaw0.5,yaw1,yaw2,pitch1,pitch2,yawdrift1,yawdrift2,tdrift10cm,yaw1_tdrift10cm}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$PWD/research/runs/3dmem-pose-association-$STAMP"
mkdir -p "$OUT"
set +e
research/envs/3dmem/bin/python -B research/scripts/run_3dmem_pose_association.py \
  --frames "$FRAMES" --output "$OUT" --conditions "$CONDITIONS" > "$OUT/run.log" 2>&1
CODE=$?
set -e
echo "exit=$CODE out=$OUT"
tail -30 "$OUT/run.log"
