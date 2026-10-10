# Algorithmic Place/Space grouping trial

## Implemented and run

`src/agent/topological-grouping.ts` proposes reversible groups; `src/sim/grouping-eval.ts` builds evidence from all 40 endpoint triptychs. No VLM, motion description, coordinate, or room label enters grouping. Production memory is unchanged. All groups are provisional.

```powershell
npm.cmd run test:memory
node dist/sim/grouping-eval.js run/sim/multiview-val5-clean-20261007
# Re-run grouping thresholds on the same recording's existing pair matrix:
node dist/sim/grouping-eval.js run/sim/multiview-val5-clean-20261007 --reuse
```

Outputs: `grouping-experiment.json` and `grouping-inspection.html` in the recording directory. The HTML shows every group's original member images for manual inspection. 27 unit tests passed before the threshold ablation; the subsequent build also passed.

## Place rule

1. Compare every current direction against every reference direction using SIFT/RANSAC.
2. For each query bearing, retain maximum inlier support against the other observation's views.
3. Pair affinity is the weaker of the second-strongest query-bearing support in both comparison directions, divided by 60 and saturated at 1. This is a heuristic, not calibrated region membership.
4. Require support from two bearings in the conservative setting; also test one-bearing support with a lower affinity threshold.
5. Complete-link agglomeration requires **every cross-member pair** to satisfy the criterion. This prevents a chain A~B~C from merging when A does not match C.
6. Keep original member IDs and minimum affinity. Unmatched observations remain singleton proposals, not confirmed distinct regions.

## Space rule

Build a Place-level adjacency graph from consecutive observations, preserving the observation endpoints of each crossing. Only edges seen at least twice participate in greedy modularity grouping. This avoids taking one connected route as one Space and preserves Place identities. However, two crossings on one out-and-back route are not independent route validation; modularity detects route communities, not actual boundaries. Every Space explicitly has `scopeVerified:false`.

## Results

| Minimum bearings | Affinity threshold | Place candidates | Space candidates | Same-position pairs grouped (19) |
| ---: | ---: | ---: | ---: | ---: |
| 2 | 0.25 | 26 | 3 | 13 |
| 2 | 0.40 | 28 | 3 | 12 |
| 2 | 0.60 | 30 | 4 | 10 |
| 1 | 0.15 | 22 | 3 | 14 |
| 1 | 0.25 | 26 | 3 | 13 |

All tested configurations had zero grouped pairs with different simulator room IDs. This is **not** zero false merges: different Places may occupy the same room, and legitimate Space may cross room boundaries.

Strict grouping recovers W6/W40, W7/W39, W8/W38, but otherwise mostly groups exact returning observations; it does not solve activity-region grouping. In the relaxed setting, W16/W17 and their returns W30/W29 form one four-observation group. Visual inspection of original frames 48/51 shows consistent toilet/sink/wall relationships with approach/reframing, compatible with one local toilet-side region. This is a useful beyond-exact-return proposal, not a completed annotation set. Other neighboring observations remain fragmented.

## Failure diagnosis

- Blank walls give little repeatable feature support. W16/W17 has second-bearing affinity only 0.183 and only one bearing above 15 inliers; strict grouping separates it despite compatible regional evidence.
- Complete-link prevents runaway chaining but treats missing/weak feature evidence as failed compatibility, fragmenting otherwise plausible regions. A principled next version needs separate compatible/incompatible/unknown evidence, not a binary threshold.
- Surface overlap still does not identify which side of a boundary the observer occupies. Lower thresholds may improve continuity but cannot prove safe merging.
- Space communities on this near-chain route have no independently verified boundary/scope evidence. Group count is sensitive to route sampling and graph resolution. Do not promote these proposals to authoritative Space IDs.

Next priorities: annotate concrete same/different local-region pairs; add observer-to-boundary evidence or local geometry without global coordinate dependence; distinguish missing evidence from positive contradictions; test multiple branching traversals; then integrate proposals with existing evidence-preserving memory merge/split/group operations. Neither the 22 candidates nor three Space communities should be advertised as correct semantic partitions.
