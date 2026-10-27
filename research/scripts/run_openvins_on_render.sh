#!/usr/bin/env bash
# Usage: run_openvins_on_render.sh <config-dir>
set -euo pipefail
cd /mnt/d/Projects/Projects2026/VLM
CFG="${1:-research/runs/openvins-on-render-v1}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="research/runs/openvins-on-render-run-$STAMP"
mkdir -p "$OUT"
set +e
/mnt/d/Projects/Projects2026/VLM/run/habitat-runtime/bin/micromamba run -p /mnt/d/Projects/Projects2026/VLM/research/envs/openvins \
  /mnt/d/Projects/Projects2026/VLM/research/runs/openvins-build/research_sim_export \
  "$PWD/$CFG/estimator_config.yaml" "$PWD/$OUT/poses.csv" > "$OUT/simulation.log" 2>&1
CODE=$?
set -e
echo "exit=$CODE out=$PWD/$OUT"
grep -acE "unable to generate enough features|lost" "$OUT/simulation.log" || true
tail -3 "$OUT/simulation.log"
