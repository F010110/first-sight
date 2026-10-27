#!/usr/bin/env bash
set -euo pipefail
cd /mnt/d/Projects/Projects2026/VLM
export GALLIUM_DRIVER=d3d12 MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA
set +e
research/envs/3dmem/bin/python -B research/scripts/debug_render_steps.py > research/reports/render-steps.log 2>&1
echo "EXIT=$?"
set -e
grep -aE "^(creating|simulator|navmesh|y quantiles|lower|anchor|is_navigable|candidate|frame|ok frames)" research/reports/render-steps.log || tail -20 research/reports/render-steps.log
