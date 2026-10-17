# Activity benchmark local results

## School development sample, 2026-10-17

- Source revision: `388faf9c800568cfc6828fa47e063f8369397eb3`.
- Materialized: `D:\Datasets\activity-benchmark-v1\school-offline-v1\school-rounds`.
- 10 original unique source trajectories; 1,669.7 seconds (27 minutes 49.7 seconds) of source visual time; 851 synchronized observations / 2,553 original PNG images at approximately two-second cadence.
- Synthetic activity schedule spans 12,469.7 seconds (3 hours 27 minutes 49.7 seconds), including nine explicit 20-minute unobserved gaps. **Not 3.5 hours of visual input, and not a real person's recorded day.**
- Archive hashes, metadata clocks/frame counts and three-view verification records checked during packaging. Ground-truth poses/provenance are evaluation-only. Attribution and modification notice retained.
- Review: `D:\Datasets\activity-benchmark-v1\school-review-v1\index.html`; 15 sheets / 98 sparse three-view cards. Generated with stride 10, so this is not exhaustive annotation.
- Actually inspected sheets `sheet-0000.jpg` and `sheet-0001.jpg`: first episode shows exterior brick building / fenced paved courtyard; entrance steps and doorway at source 120s; interior tiled corridor at 140s and 160s; wooden court with painted lines / basketball equipment at 177.5s. Thus an indoor–outdoor process is visibly present in this episode, not inferred from the environment name. Exact doorway crossing time remains unlabelled.
- Remaining sheets not yet visually reviewed. Physical-place/floor boundaries, revisit correspondences and question evidence not fully annotated. `scoreEligible=false`, annotation status remains unannotated. No final score.

## Unfinished sources

Hospital/community/shopping and auxiliary OldTownSummer downloads are incomplete after repeated TLS EOF failures. Both Python urllib and system curl failed TLS handshake; a direct curl connection timed out. Existing verified archives and partial downloads are retained; no TLS verification bypass, fabricated completion or repeated background retry loop.

## Engineering verification

15 activity tests passed: source duration validation, anonymous public records, truth separation, review draft generation, selected complete sample offline build, bounded metadata retries/cache and three-card question-outcome scoring. These tests are not real model performance measurements. No paid model calls in this dataset/scoring implementation round.
