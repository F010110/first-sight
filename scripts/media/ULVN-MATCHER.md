# ULVN-related visual matcher adapter

This is an **ULVN-inspired matching frontend**, not a full RAVEL/BPL/BASS
reproduction. First-Sight's spatial Agent, facts, original-image permissions,
transactions, sessions, revision history and QA remain unchanged.

## Frozen baseline

`run/spatial-tuning-frozen-20261110-v9/manifest.json` binds the previous tuning
sources and saved reports. Existing runs and evaluation definitions are retained.

## Isolated environment

Use Python 3.11 (the project's current Python 3.14 environment is not changed).
On this machine the initial environment is:
`C:\Users\helele\AppData\Local\Temp\opencode\ulvn-venv`.

```powershell
# In a dedicated venv, not the project's .venv:
python -m pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124
python -m pip install -r scripts/media/requirements-ulvn.txt
python scripts/media/ulvn_match.py --check
$env:ULVN_PYTHON = 'C:\Users\helele\AppData\Local\Temp\opencode\ulvn-venv\Scripts\python.exe'
```

The dependency check does not download model weights. The first match downloads
pinned MegaLoc source/weights and official SuperPoint/LightGlue weights. Preserve
package `pip freeze`, model revisions, actual weight hashes and measured cold-load
latency in an experiment. A missing dependency is explicit `unavailable`, **not**
a silent legacy fallback. `ULVN_DEVICE=cpu|cuda|auto` controls inference device.

## Integration

`ulvnPlaceMatcher()` implements the existing `PlaceMatcher` interface. The memory
runner accepts `--matcher=legacy|ulvn` (default remains legacy until validated).
`matcher-policy.json` and the manifest identify the chosen backend; resume cannot
switch backend. Existing paid-run confirmation remains required by that runner.

Local-only paired frontend diagnostic (no VLM charge):

```powershell
node dist/current/sim/evaluation/probe-visual-revisit-backends.js `
  run/unioncity-batch40-realtime813-v1-grounded-review-v1/bundle.json `
  run/ulvn-visual-prefix-probe-v1
```

## Bounded matching and provenance

- MegaLoc embeddings at 320x320 with ImageNet normalization; L2-normalized vectors.
- Exact dot-product retrieval for this bounded image set instead of adding FAISS
  as a mandatory dependency. This is recorded, not called full ULVN reproduction.
- Every current camera participates; up to 60 query images / 256 candidate places.
- Same `select_diverse` history sampler as the legacy backend, 1..24 images/place.
- Round-robin current-view top-4 retrieval, at most 96 local verification pairs.
- SuperPoint (1024 keypoints), LightGlue, then fundamental-matrix RANSAC.
- Global-only alternatives are explicitly marked not geometrically verified.
- Global descriptor cache 4096 entries and CPU local-feature cache 128 entries;
  content hashes bind cache entries, exact paths retain image-direction provenance.
- Geometry inliers and similarity refer to the **same** current/historical pair.
- Reports preserve actual paths, query paths, geometry pair count, raw matches,
  inliers, ratio, cosine similarity, model identity, device and elapsed time.

This implementation does not add topology, calibrate semantic probabilities,
certify traversability or accept a persistent place identity. The first startup
may take substantially longer than warm matching: do not claim realtime from a
warm-only measurement.

## Metrics must stay separate

Keep existing actual revisit-event precision, independently confirmed return
recall, wrong identity reuse/new creation, complete coverage, original images,
bounded turns, delivery/processing latency and costs. Candidate Recall@K and local
geometric pair quality are **additional frontend metrics**, not replacements.
Never reuse the old strict reference-ID pair score as actual revisit precision.
No full-813 or paid Agent run is needed until frontend availability is verified.

Upstream references:
- https://github.com/hren20/ulvn (ULVN, MIT)
- https://github.com/gmberton/MegaLoc (MegaLoc, MIT)
- https://github.com/cvg/LightGlue (LightGlue; check upstream component licences)

The adapter is implemented locally against these interfaces; no ULVN graph or
navigation source is vendored into production.
