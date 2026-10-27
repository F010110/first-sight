#!/usr/bin/env bash
set -euo pipefail
cd /mnt/d/Projects/Projects2026/VLM
export GALLIUM_DRIVER=d3d12 MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA HABITAT_SIM_LOG=verbose
research/envs/3dmem/bin/python -B research/scripts/debug_dataset_handles.py > research/reports/replicacad-debug.log 2>&1 || true
grep -iE "scene_instance|Scene Instance|lighting|registered|apt_1|error|warn" research/reports/replicacad-debug.log | tail -25
