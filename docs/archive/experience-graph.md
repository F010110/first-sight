# Experience Graph MVP experiment

## Scope

Implements the first trial of `建议5.md`: raw observations, visual-state associations, visit sequences and directed temporal experience edges. Automatic Place/Space grouping is not required. Existing production SceneAgent, request tools and memory files remain unchanged; this is an isolated offline MVP, not yet the live app backend.

## Files and use

- `src/agent/experience-graph.ts`: graph storage, pending observations, evidence-backed node creation, reversible rebinding history, transition reconstruction, historical object substring search, atomic snapshot persistence.
- `src/sim/experience-eval.ts`: causal replay over cached image-only pair evidence from the grouping experiment. Candidate observations must precede the current observation. No motion, coordinates, room labels or semantic descriptions affect identity.

```powershell
npm.cmd run test:memory
node dist/sim/experience-eval.js run/sim/multiview-val5-clean-20261007
```

Dependencies: the recording's `grouping-experiment.json` and completed `eval-plus-independent-perception-perfect.json` replay. Pair evidence was computed offline for all images, but each replay decision selects from past observations only; no future trajectory or grouping is used. Independent current-only semantic descriptions are reused for search, with explicit source provenance, and never used to select node IDs.

## Identity and evidence

Every observation is stored pending first. An unambiguous pair correspondence (two camera bearings supported, pair score >=0.4, competing candidate margin >=0.1) can promote two stored observations into a node; a match to an existing node can bind the current observation. Strong visual correspondence is still only heuristic: this MVP does not include multi-frame geometric loop verification or full belief-based ambiguity handling. Node membership means proposed visual-state correspondence, not membership in one physical activity region. A different node does not mean the user changed location.

Pending observations preserve frames, timing and object facts and can be retrieved before identity is known. Rebinding stores previous assignments and reconstructs representative references and all affected transitions. No observation is discarded to simplify the graph. This version records revision history but does not yet expose an undo UI or automatic conflicting-node repair.

## Edge semantics

Edges represent **observed temporal transitions**. They remain directed; no inverse is assumed. Each occurrence stores visit ID, endpoint observation IDs, elapsed time and whether pending observations intervene. Consecutive repetitions of one node do not create self edges. The edge is explicitly `traversable:false`: rotating, missing observations and movement cannot be distinguished from temporal order alone. Do not use these edges to issue walking instructions or claim shortest paths are physically safe.

## Results

40 stored observations, 10 visual nodes, 17 pending observations, 18 directed temporal edges, 5 edges with at least one gap, zero mandatory Region/Place/Space groups. W6/W40, W7/W39 and W8/W38 have shared visual IDs after deferred association. These results demonstrate workflow and evidence preservation, not calibrated localization accuracy.

Historical substring search finds 18 observations containing `toilet` and 20 containing `bed`; every result includes its original timestamp, frame reference, node ID (possibly null), semantic source and `historicalOnly:true`. These counts are not object-detection precision/recall; VLM perception can hallucinate or miss objects. English string matching currently does not implement Chinese aliases, semantic retrieval, object identity tracking or physical object localization.

Outputs: `experience-graph-experiment.json` and `experience-eval.json` in the recording directory. 31 unit tests pass, including persistence/reload and explicit corrupt-store failures.

## Next product validation

1. Add multi-frame association confidence and rejection/repair for visual aliases; test repeat recordings rather than identical synthetic endpoints.
2. Add replay-resume and integration validation before adopting this as a live backend; basic persistence/reload is already tested.
3. Expose observation-level memory search to RequestAgent with latency limits and explicit historical wording.
4. Compare only compatible views for change detection; absent objects under rotation/occlusion are not confirmed removals.
5. Provide historical route playback first. Navigational directions need separately supported orientation/action and traversability evidence.
