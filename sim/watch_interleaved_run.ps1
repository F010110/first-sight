param(
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [Parameter(Mandatory=$true)][int]$ReplayProcessId
)
$ErrorActionPreference = 'Stop'
# Sibling directory: never interfere with the runner's new-directory guard.
$monitor = "$OutputDirectory-monitor"
New-Item -ItemType Directory -Path $monitor -Force | Out-Null
function Save-Record($Name, $Value) {
    $target = Join-Path $monitor $Name
    $temporary = "$target.tmp"
    $Value | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 $temporary
    Move-Item -Force $temporary $target
}
$process = Get-Process -Id $ReplayProcessId -ErrorAction Stop
$started = $process.StartTime.ToUniversalTime().ToString('o')
Save-Record 'started.json' @{observedAt=[DateTime]::UtcNow.ToString('o');processId=$ReplayProcessId;processStartedAt=$started;output=$OutputDirectory;policy='External observer, no resume or answer modification. Stale heartbeat means observer itself may have stopped.'}
try {
    while ($true) {
        $process.Refresh()
        $alive = -not $process.HasExited
        $progress = $null
        $progressPath = Join-Path $OutputDirectory 'progress.json'
        if (Test-Path $progressPath) {
            try { $progress = Get-Content -Raw $progressPath | ConvertFrom-Json } catch { }
        }
        Save-Record 'heartbeat.json' @{at=[DateTime]::UtcNow.ToString('o');processId=$ReplayProcessId;alive=$alive;progress=$progress}
        if (-not $alive) {
            $complete = Test-Path (Join-Path $OutputDirectory 'full/complete.json')
            $stopped = Test-Path (Join-Path $OutputDirectory 'stopped.json')
            $exitCode = $null
            try { $exitCode = $process.ExitCode } catch { }
            Save-Record 'replay-exit.json' @{at=[DateTime]::UtcNow.ToString('o');processId=$ReplayProcessId;exitCode=$exitCode;complete=$complete;applicationStoppedRecord=$stopped;abnormalWithoutApplicationRecord=(-not $complete -and -not $stopped);progress=$progress;note='An absent application record does not establish cause. External observer cannot survive guaranteed whole-host termination; check heartbeat freshness.'}
            break
        }
        Start-Sleep -Seconds 15
    }
} catch {
    Save-Record 'observer-error.json' @{at=[DateTime]::UtcNow.ToString('o');error=$_.ToString()}
    throw
}
