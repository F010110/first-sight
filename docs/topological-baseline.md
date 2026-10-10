# No-VLM topological localization baseline

Implements the initial Bayes/HMM experiment from `建议4.md`, without replacing the production SceneAgent or editing existing memory.

## Implementation

- `src/agent/topological-filter.ts`: belief over historical visual anchors plus an explicit unknown state; row-normalized graph prediction followed by visual-potential multiplication and normalization.
- `src/sim/topological-eval.ts`: freeze the first 20 endpoint observations as reference anchors; localize windows 21–40 using all front/left/right directions. Reference edges come only from recording order, with reverse connectivity but unknown reverse motion. No coordinates or room IDs create anchors, edges, motion tokens or beliefs.
- Visual evidence uses the existing SIFT/RANSAC matcher and weak global similarity, **not** AnyLoc/SALAD or a trained VPR descriptor. Emission weights and confirmation thresholds are experimental heuristics, not calibrated probabilities.
- Motion uses ordered MOVE/TURN_LEFT/TURN_RIGHT/STILL tokens, ignoring metric distance, compass and duration magnitude.
- Four variants: visual only; visual plus graph/path prediction from previous MAP state; recursive posterior accumulation plus graph; recursive posterior plus qualitative path. Recursive HMM updates are not full SeqSLAM subsequence alignment.
- Unknown evidence stays unresolved; no automatic new-Place discovery, merges or Space grouping are claimed by this experiment.

## Run

```powershell
npm.cmd run test:memory
node dist/sim/topological-eval.js run/sim/multiview-val5-clean-20261007
```

Results: `run/sim/multiview-val5-clean-20261007/topological-baseline.json`, including raw visual evidence, beliefs, selected IDs and diagnostic expected anchor IDs. The test suite currently passes 22 tests.

## First results

Among 20 held-out windows, 15 have an exact-position reference endpoint (evaluation-only threshold <=0.05m). For all three motion conditions:

| Variant | Correct reference | Wrong reference | Unresolved |
| --- | ---: | ---: | ---: |
| Visual | 10 | 0 | 5 |
| Visual + graph/path, previous MAP | 14 | 0 | 1 |
| Recursive belief + graph | 14 | 0 | 1 |
| Recursive belief + graph/path | 14 | 0 | 1 |

The remaining five held-out endpoints all stay unresolved and have no exact-position reference. This does not prove they belong to distinct activity regions.

Targeted reverse returns recover W38 -> anchor-8, W39 -> anchor-7, W40 -> anchor-6; W33 -> anchor-13 also recovers. W26 remains ambiguous between anchors 19/20.

There is no measured extra benefit from qualitative motion or retaining the full posterior rather than the previous MAP state on this small chain-graph dataset. Improvement over visual-only is evidence for temporal/topological constraints, not independent proof of a sophisticated sequence model.

## Limits and next experiments

This static synthetic scene has repeated exact endpoint poses and sometimes identical surfaces across opposite side views, making these returns favorable for SIFT. The graph is a known recorded chain, not a discovered multi-route topology. Reference anchors are observations, **not** ground-truth local activity-region Places. Do not compare the 14/15 reference-localization result directly with full-route VLM Place metrics, or call zero wrong reference selections a validated false-merge rate.

Next: held-out repeat recordings with viewpoint/lighting differences; branching routes and look-alike regions; annotate same/different activity-region pairs; train/calibrate visual potentials on separate data; add dedicated VPR representations and explicit multi-frame alignment; then test provisional track creation and evidence-preserving Place/Visit integration. The probability filter cannot compensate for indistinguishable visual evidence or define semantic activity regions by itself.

## Motion disabled and stress tests

Qualitative motion is now disabled by default **in this experimental locator**, not globally removed from existing agent memory. Explicit `--test-motion` runs the earlier three-condition comparison. `--front` compares front-only matching and writes a separate report.

```powershell
node dist/sim/topological-eval.js run/sim/multiview-val5-clean-20261007 --front
node dist/sim/topological-stress.js run/sim/multiview-val5-clean-20261007
```

Stress tests reuse the multiview evidence matrix but perturb observation availability and graph assumptions. They are sensitivity tests, not an independently recorded complex house. Missing images cannot confirm identity from prediction alone; posterior prediction is retained but the public decision stays unresolved. 23 unit tests pass.

| Condition | Return windows | Correct | Wrong | Unresolved |
| --- | ---: | ---: | ---: | ---: |
| Original multiview/graph | 15 | 14 | 0 | 1 |
| Every other observation only | 7 | 1 | 0 | 6 |
| Three consecutive sensor dropouts | 15 | 11 | 0 | 4 |
| Local inlier counts scaled to 20% | 15 | 2 | 0 | 13 |
| No graph edges, same filter | 15 | 3 | 2 | 10 |
| Deliberately incorrect graph endpoints | 15 | 3 | 1 | 11 |
| Real front-only matching | 15 | 0 | 0 | 15 |

No-graph is not the visual-only baseline: this stress condition retains the filter's self-transition and accumulated belief, which can lock onto incorrect anchors. Frame skipping currently takes one transition step between retained observations, exposing sensitivity to sampling rate and the need for multi-step propagation/sequence alignment. Downscaled inliers are a score perturbation, not a rendering of darkness or occlusion. These results invalidate treating 14/15 as robust general Place recognition.

## Place and Space are not yet evaluated

Reference-anchor retrieval is only layer one. Place assignment requires evidence that multiple observations occupy one local activity region, not just that surfaces match. Space grouping requires adjacency and a common spatial scope among distinct Places; connected components of a route do not define Space. Neither grouping can be scored from exact-position pairs or simulator room labels alone.

Suggested next layer: preserve unknown observation tracks; propose bounded, evidence-backed Place groups with cross-member checks (avoid transitive similarity chaining), stable-boundary constraints and reversible merges/splits. Build Place-level transition records only from adequately supported assignments. Propose Space groups separately from repeated adjacency and scope evidence, keeping uncertain membership explicit and constituent IDs intact. Without supported boundary/scope evidence, leave groups provisional rather than produce authoritative classifications. A human-reviewed same/different-Place and same/different-Space annotation set is needed before reporting grouping accuracy, false merges or false splits.
