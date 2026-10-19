param(
    [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$compiled = 'dist/interleaved-memory-budget16-v4/sim'
& node --use-env-proxy "$compiled/interleaved-memory-evaluation.js" run/school-spatial-oracle-v1/spatial-memory-runtime-fixed-v4 run/school-calendar-v1 $OutputDirectory full --confirm-paid
if ($LASTEXITCODE -ne 0) { throw "Replay failed with exit code $LASTEXITCODE; preserve output and do not grade incomplete answers." }
& node --use-env-proxy "$compiled/memory-evaluation-grade.js" $OutputDirectory D:/Datasets/activity-benchmark-v1/school-memory-tasks-v2 full --confirm-paid
if ($LASTEXITCODE -ne 0) { throw "Grading failed with exit code $LASTEXITCODE; preserve all receipts." }
