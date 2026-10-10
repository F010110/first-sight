# Audit of the 40-observation Experience Graph trial

Audited stored node membership, observation descriptions, original triptychs and evaluation-only endpoint diagnostics. W numbers are 1-based observation indexes, not the recording's zero-based `window` field. No coordinates were used to build graph identity.

## Ten nodes

| Node | Observations | Visual context (descriptive, not physical-region identity) |
| --- | --- | --- |
| visual-1 | W8, W9, W37, W38 | Bedroom bed/window/door-frame views from two nearby observation endpoints |
| visual-2 | W19, W27, W28 | Deep bathroom toilet/sink/wall views from two endpoints |
| visual-3 | W17, W29 | Close toilet-side bathroom observation, opposite headings |
| visual-4 | W16, W30 | Slightly farther toilet/sink-side bathroom observation, opposite headings |
| visual-5 | W14, W32 | Bathroom entry-side view with fixtures and glass-panel doors |
| visual-6 | W13, W33 | Bedroom/bathroom threshold views |
| visual-7 | W12, W34 | Bedroom-side view of bed and bathroom opening |
| visual-8 | W10, W36 | Bedroom window/bed/glass-panel-door view |
| visual-9 | W7, W39 | Bed-side opening and seascape-wall transition views |
| visual-10 | W6, W40 | Opening among seascape-wall, wood floor and cyan-floor counter area |

The white ladder-like structures in cached semantic descriptions are visibly glass-panel door frames in inspected images, not reliable evidence of ladders. The same semantic error appears as shelves/windows in other descriptions. Node descriptions are therefore not verified semantic labels; object search needs its own quality evaluation.

## Missing associations and coverage

- 23/40 observations have node assignments; 17/40 remain pending. No raw observations were deleted, and pending object descriptions remain searchable.
- Pending observations: W1–W5, W11, W15, W18, W20–W26, W31, W35.
- W1–W5 (counter/cyan-floor/start segment) contribute no active visual nodes. The ten-node graph is not a complete map of the recording.
- Among 19 exact-position observation pairs, 11 share a non-null node, 8 do not. Missing pairs: W11/W35, W15/W31, W18/W28, W20/W26, W21/W25, W22/W23, W22/W24, W23/W24. This 11/19 diagnostic is not Place accuracy.
- In W18/W28, W18 remains pending while W28 is assigned to the node established from W19/W27. Later node creation does not automatically reconsider all earlier pending observations. This is a concrete missing backward-association operation.

## Duplicates and possible over-association

No exact-position pair was assigned to two different non-null nodes in this replay: all eight unresolved pairs include pending assignments. This does not establish absence of visual duplicate nodes at different positions. W28 (visual-2) and W29 (visual-3) have strong cross-node pair affinity 0.45, making them review candidates, not proven duplicates.

The current matcher can grow nodes transitively using one strongest historical observation. Minimum within-node pair affinity is 0.083 for visual-1 and 0 for visual-2, despite the 0.4 admission threshold. These nodes contain insufficiently mutually verified members: an A~B~C chain can be admitted when A does not directly support C. Low affinity means missing evidence, not demonstrated different physical region, but this violates a claim of robust node identity. Visual-2's W28 association particularly needs review. The remaining eight nodes contain two observations each with strong pair support (minimum 0.517 or 1).

## Verdict

The experiment demonstrates preservation, deferred correspondence, temporal-edge reconstruction and observation-level retrieval. It does **not** yet demonstrate a reliable complete Experience Graph. Before integrating with the product: revisit pending observations after promotions, distinguish provisional associations from verified identity, verify multiple node representatives to prevent visual drift, evaluate object descriptions, and validate new recordings with nonidentical appearance. Five of eighteen temporal edges contain gaps and no edge authorizes navigation.
