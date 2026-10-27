#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PIP_CACHE_DIR="$ROOT/cache/pip"
export PYTHONDONTWRITEBYTECODE=1
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
exec > "$ROOT/reports/runtime-install-$STAMP.log" 2>&1
trap 'rc=$?; echo "runtime exit=$rc at $(date -u --iso-8601=seconds)"' EXIT
PY="$ROOT/envs/findingdory/bin/python"
"$PY" -m pip install 'numpy==1.23.5' 'scipy==1.10.1' 'pandas==2.0.3' 'torch==2.5.1' 'torchvision==0.20.1' --extra-index-url https://download.pytorch.org/whl/cu124
"$PY" -m pip check
"$PY" -B -c 'import numpy,scipy,pandas,torch; print("versions",numpy.__version__,scipy.__version__,pandas.__version__,torch.__version__); print("CUDA available",torch.cuda.is_available()); assert torch.cuda.is_available(); x=torch.ones(32,device="cuda"); print("GPU",torch.cuda.get_device_name(0),"sum",x.sum().item()); import habitat; print("habitat import passed")'
"$PY" -m pip freeze > "$ROOT/reports/runtime-pip-$STAMP.txt"
