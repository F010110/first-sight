#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export MAMBA_ROOT_PREFIX="$ROOT/cache/mamba"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SUITE="${1:-openvins-noise-sweep-v1}"
case "$SUITE" in openvins-noise-sweep-v1|openvins-noise-fixed-calib-v1) ;; *) echo "Unknown suite"; exit 2;; esac
exec > "$ROOT/reports/openvins-sweep-$STAMP.log" 2>&1
MAMBA="$ROOT/../run/habitat-runtime/bin/micromamba"
PY="$ROOT/envs/findingdory/bin/python"
FAILED=0
for DIR in "$ROOT"/runs/"$SUITE"/scale-*; do
  if [ -f "$DIR/poses.analysis.json" ]; then
    echo "Already analyzed: $DIR; preserving existing run"
    continue
  fi
  if [ -e "$DIR/poses.csv" ]; then
    echo "Refusing to overwrite incomplete run: $DIR"
    FAILED=1
    continue
  fi
  echo "START $DIR $(date -u --iso-8601=seconds)"
  if "$MAMBA" run -p "$ROOT/envs/openvins" "$ROOT/runs/openvins-build/research_sim_export" "$DIR/estimator_config.yaml" "$DIR/poses.csv" > "$DIR/simulation.log" 2>&1; then
    if ! "$PY" -B "$ROOT/scripts/analyze_openvins_poses.py" "$DIR/poses.csv"; then FAILED=1; fi
  else
    echo "FAILED $DIR"
    FAILED=1
  fi
  echo "END $DIR $(date -u --iso-8601=seconds)"
done
echo "sweep exit=$FAILED"
exit "$FAILED"
