param(
    [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$compiled = 'dist/interleaved-memory-budget16-v4/sim'
if (Test-Path $OutputDirectory) { throw 'Require a NEW replay directory; never overwrite previous attempts.' }
$lifecycle = "$OutputDirectory-lifecycle"
New-Item -ItemType Directory -Path $lifecycle -ErrorAction Stop | Out-Null
Start-Transcript -Path (Join-Path $lifecycle 'console.log') -ErrorAction Stop | Out-Null
try {
@{at=[DateTime]::UtcNow.ToString('o');phase='replay-starting';supervisorPid=$PID} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $lifecycle 'state.json')
& node --use-env-proxy "$compiled/interleaved-memory-evaluation.js" run/school-spatial-oracle-v1/spatial-memory-runtime-fixed-v4 run/school-calendar-v1 $OutputDirectory full --confirm-paid
if ($LASTEXITCODE -ne 0) { throw "Replay failed with exit code $LASTEXITCODE; preserve output and do not grade incomplete answers." }
@{at=[DateTime]::UtcNow.ToString('o');phase='grading';supervisorPid=$PID} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $lifecycle 'state.json')
& node --use-env-proxy "$compiled/memory-evaluation-grade.js" $OutputDirectory D:/Datasets/activity-benchmark-v1/school-memory-tasks-v2 full --confirm-paid
if ($LASTEXITCODE -ne 0) { throw "Grading failed with exit code $LASTEXITCODE; preserve all receipts." }
@{at=[DateTime]::UtcNow.ToString('o');phase='completed';supervisorPid=$PID} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $lifecycle 'state.json')
} catch {
@{at=[DateTime]::UtcNow.ToString('o');phase='failed';error=$_.ToString();supervisorPid=$PID} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $lifecycle 'state.json')
throw
} finally { Stop-Transcript | Out-Null }
