param(
    [Parameter(Mandatory=$true)][string]$CaptureDirectory,
    [Parameter(Mandatory=$true)][string]$MemoryDirectory,
    [string]$Port = 'COM3',
    [int]$Count = 30,
    [double]$Interval = 2,
    [ValidateSet(115200,230400,460800)][int]$Baud = 460800,
    [switch]$ConfirmPaid
)
$ErrorActionPreference = 'Stop'
if ($Count -lt 1 -or $Count -gt 1800 -or $Interval -lt .1 -or [double]::IsNaN($Interval) -or [double]::IsInfinity($Interval)) { throw 'Invalid count/interval' }
if ((Test-Path $CaptureDirectory) -or (Test-Path $MemoryDirectory)) { throw 'Require two new output directories' }
if (-not (Test-Path 'dist/current/hardware/run-camera.js')) { throw 'Run npm run build first' }
if ($ConfirmPaid -and (-not $env:QWEN_API_KEY -or -not $env:QWEN_BASE_URL)) { throw 'Missing Qwen configuration' }
$python = (Resolve-Path 'cam/.venv/Scripts/python.exe').Path
$capture = [IO.Path]::GetFullPath($CaptureDirectory)
$memory = [IO.Path]::GetFullPath($MemoryDirectory)
New-Item -ItemType Directory -Force -Path (Split-Path $capture) | Out-Null
$arguments = @('cam/stream.py', ('"' + $capture + '"'), '--port', $Port, '--count', $Count, '--interval', $Interval.ToString([Globalization.CultureInfo]::InvariantCulture), '--baud', $Baud)
$process = Start-Process -FilePath $python -ArgumentList $arguments -PassThru -NoNewWindow -RedirectStandardOutput "$capture.stdout.log" -RedirectStandardError "$capture.stderr.log"
try {
    $process.Handle | Out-Null
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while (-not (Test-Path (Join-Path $capture 'observations.jsonl'))) {
        if ($process.HasExited -or [DateTime]::UtcNow -gt $deadline) { throw 'Capture failed to start; inspect capture stderr log' }
        Start-Sleep -Milliseconds 100
    }
    $mode = if ($ConfirmPaid) { '--confirm-paid' } else { '--validate-only' }
    & node --use-env-proxy dist/current/hardware/run-camera.js $capture $memory $mode --follow
    $consumerExit = $LASTEXITCODE
    # Acquisition is independently bounded; let it finish even if inference fails.
    $process.WaitForExit()
    if ($consumerExit -ne 0 -or $process.ExitCode -ne 0) { throw 'Hardware run failed; original images and logs preserved' }
} finally {
    $process.Dispose()
}
