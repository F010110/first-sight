#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export MAMBA_ROOT_PREFIX="$ROOT/cache/mamba"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$ROOT/runs/openvins-smoke-$STAMP"
mkdir -p "$OUT"
exec > "$ROOT/reports/openvins-smoke-$STAMP.log" 2>&1
trap 'rc=$?; echo "smoke exit=$rc at $(date -u --iso-8601=seconds)"' EXIT
MAMBA="$ROOT/../run/habitat-runtime/bin/micromamba"
PREFIX="$ROOT/envs/openvins"
BUILD="$ROOT/runs/openvins-build"
"$MAMBA" run -p "$PREFIX" cmake -S "$ROOT/vendor/open-vins/ov_msckf" -B "$BUILD" -DCMAKE_PROJECT_INCLUDE="$ROOT/scripts/openvins_export_target.cmake"
"$MAMBA" run -p "$PREFIX" cmake --build "$BUILD" --target research_sim_export -j 2
"$MAMBA" run -p "$PREFIX" "$BUILD/research_sim_export" "$ROOT/runs/openvins-smoke-input/estimator_config.yaml" "$OUT/poses.csv"
echo "CSV=$OUT/poses.csv"
