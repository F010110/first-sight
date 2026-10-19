# 16-round interleaved experiment status

- Original 4-round full replay: `run/interleaved-memory-90-v2`; 90 executions, 43 unanswered budget exhaustions; frozen model-graded cards 50.56 / 38.24 / 99.44. These are not the 16-round results.
- `run/interleaved-memory-90-budget16-v1`: rejected before paid requests by constructor's previous 8-round guard.
- `run/interleaved-memory-90-budget16-v2`: stopped at independent retrieval search cap (12); originals retained.
- `run/interleaved-memory-90-budget16-v3`: process absent when checked on user request; latest durable progress 217/278 events, 63/90 questions, 686/851 observations, pending=0. Last request directory has input and reservation but no response. Ledger 713 calls, estimated USD0.795727266 with one unknown-call reservation. No complete/stopped record; cause of process termination unknown, not established as API or budget failure.
- `run/interleaved-memory-90-budget16-v4`: fresh empty-memory replay launched via `sim/run_interleaved_budget16.ps1`, which grades only after successful full replay. No restored ephemeral Context, no answer splicing. Uses frozen compiled `dist/interleaved-memory-budget16-v4` (do not overwrite).

Budget-only experimental intent: 16 inference rounds, 16 retrieval searches, USD20 safety cap; same model/prompt/images/grader as preceding 16-round attempt. Old default retrieval callers retain 12-search cap. Repeated searches may remain a genuine algorithm failure; greater allowance is not proof of recovery.
