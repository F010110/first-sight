param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
# Explicit paid entry point; does not run as part of npm test/build.
if (-not (Test-Path 'dist/current/sim/evaluation/interleaved-memory-evaluation.js')) { throw 'Run npm run build first.' }
& (Join-Path $PSScriptRoot 'run_inspect_candidate_full.ps1') -OutputDirectory $OutputDirectory -CompiledDirectory 'dist/current/sim/evaluation'
