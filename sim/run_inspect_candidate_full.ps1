param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$compiled = 'dist/inspect-probe-grading-v1/sim'
if (Test-Path $OutputDirectory) { throw 'Require new output directory' }
$lifecycle = "$OutputDirectory-lifecycle"
New-Item -ItemType Directory -Path $lifecycle -ErrorAction Stop | Out-Null
function Save-State($value) {
    $target = Join-Path $lifecycle 'state.json'
    $value | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 "$target.tmp"
    Move-Item -Force "$target.tmp" $target
}
function Invoke-Phase($phase, $arguments) {
    $process = Start-Process -FilePath (Get-Command node).Source -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $lifecycle "$phase.stdout.log") -RedirectStandardError (Join-Path $lifecycle "$phase.stderr.log")
    # Retain a native handle while the child is alive. Otherwise Windows
    # PowerShell may observe HasExited but lose access to the exit code.
    $retainedHandle = $process.Handle
    while (-not $process.HasExited) {
        Save-State @{phase=$phase;at=[DateTime]::UtcNow.ToString('o');processId=$process.Id;alive=$true;supervisorPid=$PID}
        Start-Sleep -Seconds 15
        $process.Refresh()
    }
    $process.WaitForExit()
    @{phase=$phase;at=[DateTime]::UtcNow.ToString('o');processId=$process.Id;exitCode=$process.ExitCode} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $lifecycle "$phase.exit.json")
    if ($null -eq $process.ExitCode) { throw "$phase exit code unavailable; verify completion artifacts before recovery. Preserve run and logs." }
    if ($process.ExitCode -ne 0) { throw "$phase failed, exit code $($process.ExitCode). Preserve run and logs." }
}
try {
    Invoke-Phase 'replay' "--use-env-proxy $compiled/interleaved-memory-evaluation.js run/school-spatial-oracle-v1/spatial-memory-runtime-fixed-v4 run/school-calendar-v1 $OutputDirectory full --confirm-paid"
    if (-not (Test-Path (Join-Path $OutputDirectory 'full/complete.json'))) { throw 'Replay completion record missing' }
    Invoke-Phase 'grading' "--use-env-proxy $compiled/memory-evaluation-grade.js $OutputDirectory D:/Datasets/activity-benchmark-v1/school-memory-tasks-v2 full --confirm-paid"
    if (-not (Test-Path (Join-Path $OutputDirectory 'full-grading/complete.json'))) { throw 'Grading completion record missing' }
    Save-State @{phase='completed-awaiting-release-audit';at=[DateTime]::UtcNow.ToString('o');supervisorPid=$PID}
} catch {
    Save-State @{phase='failed';at=[DateTime]::UtcNow.ToString('o');error=$_.ToString();supervisorPid=$PID}
    throw
}
