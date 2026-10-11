# Layered place memory (schema 2)

- Observation preserves chronological source frames, qualitative motion and raw VLM decisions.
- Visit is a continuous visit to a local Place. Existing `sceneId` names remain for client compatibility.
- Place is the observer's repeatable local position relative to stable environmental anchors, not an image, orientation or room. Similar visible content with clearly different observer positions means different Places. Rotation alone does not.
- Space groups demonstrably adjacent Places within the same spatial scope without merging route identities. It need not match a room and may span room boundaries; room labels and shared visual content alone are insufficient.
- Place and Observation retain `anchors`, `localRelations` and (for observations) `identityReason`. Older files default to missing/empty evidence; no anchor relations are invented during migration.
- TransitionExperience links visits and preserves motion evidence. Only confident, non-uncertain decisions between non-provisional places contribute to confirmed route aggregates.
- MemoryRevision records reasons, evidence references and the pre-edit snapshot for grouping, duplicate merging and visit rebinding.

`groupPlaces`, `mergePlaces` and `rebindVisits` are available on PlaceMemory and SceneAgent. Splitting currently means creating a provisional place and rebinding whole visits; splitting inside a visit is not implemented. Merged IDs remain aliases. Route aggregates are rebuilt from visit-linked experiences after corrections; self-edges disappear.

V1 files load without deleting old records. Legacy routes are retained on initial load; inferred legacy experiences are unconfirmed and therefore excluded when rebuilding confirmed routes. No historical VLM decisions are fabricated.

All SceneAgent observations still invoke VLM. Shared surfaces and motion magnitude are not identity rules. Ambiguous decisions create provisional local records instead of forcing same/new room conclusions.

SceneAgent now runs a bounded VLM memory review before the next observation after every 12 observations. Replay also runs a final review. Reviews inspect chronological images, observation decisions and topology, never GT room labels or coordinates. They propose at most one edit. Group/rebind/split require confidence >=0.85 and two observation references; merge requires >=0.95 and evidence spanning multiple visits. Rejected proposals and raw responses are persisted in `reviews`. These thresholds are conservative heuristics, not calibrated probabilities.

Space proposals must explicitly supply physical-adjacency and shared-spatial-scope evidence. Backend grouping additionally requires supporting observations for every member and connected visit experience among members. Topological connectivity is only a necessary check, not proof of physical adjacency; Space hypotheses remain provisional. Position recognition first describes current anchors/relations independently, then compares candidate position descriptions. Increased output budget accommodates these fields.

The first positional-prompt no-motion replay (`eval-local-position-none-40.json`) still produced only two Places (room purity 0.575); this does not validate local-position discrimination. Raw relations sometimes described image layout instead of observer position, and missing sensors were mistaken for no translation. The follow-up prompt explicitly labels absent motion UNKNOWN and disallows treating object layout or screen coordinates as observer-position evidence. That final follow-up has unit/build validation, not another full VLM replay yet.

`splitVisit` moves the suffix beginning at a saved observation into an existing target place, or creates a new provisional target when targetId is null. It creates a provisional boundary experience. Reviews also inspect a single over-merged Place, using historical anchors plus recent observations. Representatives and routes are rebuilt from source observations after corrections. `undoLastRevision` restores the most recent edit checkpoint, including aliases, but refuses if newer observations arrived; it never silently discards new evidence. Undo is latest-edit only, not arbitrary historical undo.

Persistence uses a temporary file and rename. Corrupt or unsupported stores now fail explicitly rather than silently becoming fresh memory. Calls on a single memory instance must be serialized; multi-process writers are not supported.

Replay creates a unique `layered-<motion>-<timestamp>` directory, leaving earlier runs intact. It saves raw per-window decisions and persistent memory after each observation, and reports both local-place and space-level metrics. Historical majority-mapped accuracy duplicates purity; room-dominant share is not true cross-visit recall, and remapped transition F1 is not a learned-graph validation. Space grouping remains provisional; no grouping claim is made without evidence.

Still not implemented: a calibrated event-driven frontend scheduler or independent confirmation of Space hypotheses. VLM identity calls remain mandatory; periodic maintenance is additional latency/cost, not a replacement for verification.

## Provisional-first identity policy

The policy below describes the earlier aggressive point-position experiment and is superseded by the activity-region rules at the end of this document.

Recognition now explicitly labels every image with its role, interleaving text and images. Historical references come first; chronological CURRENT images come last, with the last current frame identifying the target position. This removes the earlier ambiguous “image just added” wording.

Weakly justified same/known claims become provisional new-place proposals. Reuse requires at least two distinct `positionMatchEvidence` statements and no unresolved `positionalContradictions`; generic object overlap is disallowed by the prompt. These statements are VLM evidence, not independently measured facts, so they can still be wrong. Every new Place starts provisional; only a subsequent sufficiently confident supported reuse can confirm it. More nodes are not evidence of correct identity. Distinct related Places may later be grouped as Space; duplicate Places may be merged, and over-merged visits can still be split.

The first 40-window aggressive triptych replay (`multiview-val5-clean-20261007/eval-triple-aggressive.json`) produced 20 final Places, room purity 0.975, four maintenance reviews and two edits, no Spaces and no confirmed route edges. All 19 transition experiences remain provisional. Majority-remapped transition F1=1 is NOT a correct learned graph: the confirmed graph is empty.

## Activity-region rules and independent Space phase

Place now means a repeatable local ACTIVITY REGION around stable anchors, compatible aisle/boundary relations, multiple nearby positions and all viewing directions. New requires positive regional change evidence; missing old-identity evidence alone does not create another confirmed region. Supported reuse needs a concrete compatible region relation without contradictions, not two exact point-position matches. Screen left/right and apparent scale alone are not invariant position relations.

Unresolved observations may remain temporarily assigned to the previous region with `identityStatus: unresolved`; this is not same-place verification (`sameAsPrevious` and `revisited` are false). They remain uncertain evidence, do not overwrite confirmed descriptions and are not added to representative images when temporarily held. Metrics that count these assignments as labels are not verified identity accuracy; unresolved counts must be examined separately.

Each scheduled maintenance cycle now runs identity repair followed by a separate Space grouping pass. The latter permits only group/none, requires physical-adjacency and shared-scope evidence and retains distinct Place identities. Lack of evidence can legitimately leave Places ungrouped; no forced grouping to reach a target number. Both passes remain heuristic VLM proposals.

The configured endpoint advertises `qwen3.8-flash`; a current-image-only probe successfully accepted a triptych and described visible bathroom fixtures. A model catalog entry and one probe do not establish general spatial reasoning quality. Compare with qwen3-vl-plus using process-local QWEN_MODEL overrides, not a global default change.

Initial activity-region replay with qwen3-vl-plus: 40 windows, seven final Places, six unresolved decisions, same-position/different-heading diagnostic 4/19, eight review calls, no Space. This preceded the final phase-contract tightening and explicit adjacency metadata. Some Space calls incorrectly emitted merge and were rejected.

The qwen3.8-flash 40-window replay timed out at 15 minutes after completing 12 windows; no full model-quality comparison is justified. A separate copy-based offline review of the seven-place memory did apply one provisional Space joining scene-6 and scene-7 (bed/window and console/painting zones) with observation-35/37/40 as evidence. Unsupported bathroom grouping lacked connected visit evidence and was rejected. That review job also exceeded its 15-minute budget before the final report, but each review/edit was persisted in `review-1791374604075/memory.json`. This is a demonstrated tentative grouping, not independent validation of room or local-region truth.

Subsequent code bounds each recognition/review request with `SCENE_VLM_TIMEOUT_MS` (default 120000), aborts stalled calls, and interleaves labels with review images as well. A timed-out identity call throws rather than inventing an identity; a timed-out review is recorded as rejected. No global model default was changed.

## Multiview candidate-screen repair

### Independent current-perception stage

Recognition now first inspects only the final current image (including its simultaneous triptych panels). This call receives no stored identity, candidate description, reference image, motion or simulator GT. Its output contains visible anchors, supported observer relations and uncertainties, but no accepted identity. A second call compares historical evidence with the current sequence and the independent perception. Current observation anchors/relations and newly established identity descriptions use the independent perception, not the verifier's potentially memory-contaminated description. Both calls remain VLM-based; image matching still cannot confirm identity. Per-window results retain `currentPerception`, raw responses and phase-tagged request diagnostics; VLM counts include perception and retries.

This is an intervention against historical-anchor leakage, not yet proof that bedroom/bathroom boundaries are recognized correctly. It adds at least one VLM request per window and can itself make perception errors. The separate 40-window replay `eval-plus-independent-perception-perfect.json` tests this new pipeline; previously launched diagnostic comparisons use the older pipeline and must not be treated as matched tests of this intervention.

### Timeout and output diagnostics

The 30-minute interruption of the Omni comparison was the shell's whole-run deadline, not proof of a crashed recognition request. Long model comparisons now run without that aggregate deadline while preserving the per-request `SCENE_VLM_TIMEOUT_MS` guard. Replay writes `progress.json` before each window and records completed decisions incrementally. Recognition failures preserve model ID, raw responses, validation errors, per-attempt elapsed milliseconds and stop reason in `failures.jsonl`; successful windows carry these in `requestDiagnostics`. Invalid/missing perception fields still fail explicitly rather than fabricate an observation. A repeated identity-only contradiction can retain valid perception as unresolved, excluding it from representative evidence.

Retries use fresh conversation context containing one copy of each image plus the previous response and correction. The former repeated `agent.prompt` flow accumulated the original images and re-sent them alongside the retry images. Initial region establishment now accepts visible anchors and observer relations without pretending a boundary crossing happened before the first observation. Subsequent new regions still require region-change evidence. These changes improve protocol reliability and diagnostics, not demonstrated identity accuracy.

FrameRef can now supply separate front/left/right `visualMatchViews`; representatives persist corresponding owned `matchViews` files. All supplied current endpoint directions match all historical directions without assuming front-to-front correspondence. Legacy single/front-only data remains readable. The target is the window's FINAL observation: passing earlier window regions through the matcher or storing a feature-rich earlier frame as the target representative caused mixed-region evidence and is no longer done.

Candidate selection takes the union of local/global visual candidates, path candidates and the previous region. Strong SIFT/RANSAC overlap is retained even if global appearance is low; matcher failure retains recent fallback candidates as uncertain, not rejected identities. Matching reference images, inliers, independent path scores, supported query directions and qualitative motion class are surfaced to VLM. No algorithm accepts place identity; all observations still invoke VLM. RANSAC shared-surface matches are not occupancy or calibrated pose estimates.

Representatives keep the initial anchor plus recent snapshots within a five-image budget, rather than freezing at the first five views. Duplicate source IDs are not stored twice. Image comparisons use the initial and two latest representatives. Recognition images are copied with their component views; source observation evidence remains available for repair. Rebuilds use endpoint views and exclude explicitly unresolved associations from representatives.

Identity output now has a single authoritative same/known/new/unresolved decision and positive regionChangeEvidence for new. Contradictory explicit decisions trigger one re-verification, with retry responses saved in per-window results. An explicit new-region decision does not become a previous-place hold merely because it lists contradictions against OLD regions. Reported identity VLM-call counts include retries. Replay persists a partial report and failure metadata if recognition fails; partial runs must not be scored as complete tests.

Independent candidate-only test on four targeted endpoint returns (no VLM, poses used only after matching): correct historical window ranks changed from 18/29/32/33 using front views to 1/1/1/1 using all directions. Result file: `multiview-val5-clean-20261007/retrieval-comparison.json`; script: `src/sim/retrieval-eval.ts`. Raw window history, not production Place representatives, was used, so this is a retrieval diagnostic rather than Place-recognition accuracy.

Position diagnostics reveal over-fragmentation: same-position/different-heading pairs reuse a final Place in 0/19 cases (prior triptych run 15/19); separated-position pairs differ in 590/602 cases. These are endpoint diagnostics, not true local-place annotations. High purity is largely attributable to fragmentation. Window 19 no longer imports the kitchen-island anchors and instead retains toilet/sink/plunger/doorway relations, but still mislabels the area as a bedroom and compares view-relative layouts. This addresses that particular kitchen-anchor contamination, not general identity reliability. Rotation-invariant comparison and controlled confirmation of provisional associations remain necessary.

Run tests: `npm run build`, then `node --test dist/agent/place-memory.test.js`.

## Recorded-sample validation (2026-10-07)

Episode: `run/sim/episode-20261007T034358026536Z` (418 frames, 139 windows).

| Run | Windows | Places | Room purity | Remapped transition F1 |
| --- | ---: | ---: | ---: | ---: |
| Initial maintenance, noisy motion | 139 | 2 | 0.396 | 0 |
| Initial maintenance, perfect qualitative motion | 40 | 2 | 0.575 | 0 |
| Single-place review enabled, no motion | 40 | 1 | 0.475 | 0 |

The initial reviewer made no corrections; identity recognition still over-merged. The revised single-place reviewer detected distinct areas but initially proposed the first observation as a suffix split boundary, which was safely rejected. After explicitly supplying valid suffix boundaries and explaining split semantics, offline re-review of the saved no-motion run applied three splits: 1 -> 4 local Places, room purity 0.475 -> 0.700. No Spaces were established. A fourth malformed JSON proposal was rejected and recorded.

This demonstrates evidence-preserving correction, NOT correct four-room recognition. The four local Places include duplicate bedroom-area hypotheses and inaccurate boundaries; purity can improve merely by fragmentation. No correct room grouping or repeated-route recall has been established. The full noisy run used the initial reviewer, not the final single-place/suffix-boundary changes.

Reports: `eval-layered-noisy.json`, `eval-layered-perfect-40.json`, `eval-layered-v2-none-40.json`; post-review report: `review-1791355515898/report.json`, all under the episode directory. Each report links an isolated memory directory with decisions and review provenance.

Offline maintenance test: `node dist/sim/review-eval.js <saved-replay-report.json>`. It copies memory to a new directory, reviews without feeding GT to the agent, then scores against the saved report afterward.
