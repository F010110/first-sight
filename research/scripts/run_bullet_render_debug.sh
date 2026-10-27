#!/usr/bin/env bash
cd /mnt/d/Projects/Projects2026/VLM
export GALLIUM_DRIVER=d3d12 MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA
for MODE in "stage sensors" "instance sensors" "instance plain"; do
  echo "=== $MODE"
  set +e
  # shellcheck disable=SC2086
  research/envs/3dmem/bin/python -B research/scripts/debug_bullet_render.py $MODE 2>&1 | tail -4
  echo "exit=${PIPESTATUS[0]}"
  set -e
done
