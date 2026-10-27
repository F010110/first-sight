#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PIP_CACHE_DIR="$ROOT/cache/pip"
export PYTHONDONTWRITEBYTECODE=1
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
exec > "$ROOT/reports/habitat-lab-install-$STAMP.log" 2>&1
trap 'rc=$?; echo "install exit=$rc at $(date -u --iso-8601=seconds)"' EXIT
PY="$ROOT/envs/findingdory/bin/python"
"$PY" -m pip install 'numpy==1.23.5' 'scipy==1.10.1' 'numpy-quaternion==2023.0.4' 'opencv-python<4.12' -e "$ROOT/vendor/findingdory/third_party/habitat-lab/habitat-lab"
"$PY" -m pip check
"$PY" -B "$ROOT/scripts/environment_probe.py"
"$PY" -m pip freeze > "$ROOT/reports/habitat-lab-pip-$STAMP.txt"
