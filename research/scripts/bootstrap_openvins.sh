#!/usr/bin/env bash
# Build upstream OpenVINS without ROS or system package changes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export MAMBA_ROOT_PREFIX="$ROOT/cache/mamba"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$ROOT/reports" "$ROOT/envs" "$ROOT/runs/openvins-build"
exec > "$ROOT/reports/openvins-build-$STAMP.log" 2>&1
trap 'rc=$?; echo "OpenVINS build exit=$rc at $(date -u --iso-8601=seconds)"' EXIT
git -C "$ROOT/vendor/open-vins" rev-parse HEAD > "$ROOT/reports/openvins-commit.txt"
MAMBA="$ROOT/../run/habitat-runtime/bin/micromamba"
PREFIX="$ROOT/envs/openvins"
if [ -f "$PREFIX/conda-meta/history" ]; then
  ACTION=install
else
  ACTION=create
fi
"$MAMBA" "$ACTION" -y -p "$PREFIX" -c conda-forge 'cmake<4' ninja 'eigen=3.4.0' 'opencv<4.11' boost-cpp 'ceres-solver=2.1.0=h2ea6fbf_2' 'suitesparse=5.10.1' cxx-compiler pkg-config
"$MAMBA" list -p "$PREFIX" --explicit > "$ROOT/reports/openvins-conda-$STAMP.txt"
SUITE_ARGS=()
# SuiteSparse 5 headers live directly under include; v7 split-package headers
# can coexist under include/suitesparse. Select the version Ceres actually needs.
for COMPONENT in AMD CAMD CCOLAMD CHOLMOD COLAMD SPQR Config CXSparse; do
  SUITE_ARGS+=("-DSuiteSparse_${COMPONENT}_INCLUDE_DIR=$PREFIX/include")
done
"$MAMBA" run -p "$PREFIX" cmake -S "$ROOT/vendor/open-vins/ov_msckf" -B "$ROOT/runs/openvins-build" -G Ninja -DENABLE_ROS=OFF -DENABLE_ARUCO_TAGS=OFF -DCMAKE_PREFIX_PATH="$PREFIX" -DCMAKE_BUILD_TYPE=Release "${SUITE_ARGS[@]}"
"$MAMBA" run -p "$PREFIX" cmake --build "$ROOT/runs/openvins-build" -j 2
