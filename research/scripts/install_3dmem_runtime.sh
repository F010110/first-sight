#!/usr/bin/env bash
# Upstream README versions, separate from FindingDory runtime.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PIP_CACHE_DIR="$ROOT/cache/pip"
export TMPDIR="$ROOT/cache/tmp"
export PIP_PROGRESS_BAR=off
export PIP_DEFAULT_TIMEOUT=120
mkdir -p "$TMPDIR"
export PYTHONDONTWRITEBYTECODE=1
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
exec > "$ROOT/reports/3dmem-runtime-$STAMP.log" 2>&1
trap 'rc=$?; echo "3dmem runtime exit=$rc at $(date -u --iso-8601=seconds)"' EXIT
PY="$ROOT/envs/3dmem/bin/python"
"$PY" -m pip install 'numpy==1.23.5' 'scipy==1.10.1'
"$PY" -m pip install 'torch==2.0.1+cu118' 'torchvision==0.15.2+cu118' --extra-index-url https://download.pytorch.org/whl/cu118
"$PY" -m pip install 'numpy==1.23.5' 'scipy==1.10.1' 'omegaconf==2.3.0' 'open-clip-torch==2.26.1' 'ultralytics==8.2.31' 'supervision==0.21.0' 'opencv-python-headless==4.10.0.84' 'opencv-python==4.10.0.84' 'scikit-learn==1.4.0' 'scikit-image==0.22.0' 'open3d==0.18.0' 'hipart==1.0.4' 'openai==1.35.3' 'httpx==0.27.2' fvcore iopath
"$PY" -m pip check
"$PY" -B "$ROOT/scripts/environment_probe.py"
"$PY" -B -c 'import torch,open3d,open_clip,ultralytics; print("torch",torch.__version__,"CUDA",torch.cuda.is_available()); assert torch.cuda.is_available(); print(torch.ones(1,device="cuda").item())'
"$PY" -m pip freeze > "$ROOT/reports/3dmem-runtime-pip-$STAMP.txt"
# PyTorch3D is a separate native dependency gate, not claimed installed here.
