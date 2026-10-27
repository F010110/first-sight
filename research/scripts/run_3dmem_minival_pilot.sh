#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
export TORCH_HOME="$ROOT/cache/torch"
export HF_HOME="$ROOT/cache/hf"
export TMPDIR="$ROOT/cache/tmp"
export GALLIUM_DRIVER=d3d12
export MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA
export PYTHONDONTWRITEBYTECODE=1
export RESEARCH_API_MAX_CALLS=6
export RESEARCH_VLM_MODEL=qwen3.8-flash
mkdir -p "$TMPDIR"
exec > "$ROOT/reports/3dmem-minival-pilot-$STAMP.log" 2>&1
trap 'rc=$?; echo "pilot exit=$rc at $(date -u --iso-8601=seconds)"' EXIT
# Do not print endpoint or credentials, even on missing-config failure.
test -n "${QWEN_API_KEY:-}" && test -n "${QWEN_BASE_URL:-}"
cd "$ROOT/runs/3dmem-minival-runtime-v1"
"$ROOT/envs/3dmem/bin/python" -u -B run_aeqa_evaluation.py -cf cfg/minival.yaml --start_ratio 0 --end_ratio 0.038461538461538464
