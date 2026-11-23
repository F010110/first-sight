"""Run one already-frozen paid attempt, then score and audit; never loop or expand."""
import subprocess
from pathlib import Path

freeze = 'run/unioncity-organized-pilot-v3-freeze'
run = 'run/unioncity-organized-pilot-v3-run1'
score = 'run/unioncity-organized-pilot-v3-score1'
if Path(run).exists() or Path(score).exists():
    raise RuntimeError('Never overwrite or silently retry a previous attempt')
subprocess.run(['node', 'dist/current/sim/evaluation/run-unioncity-repair-pilot.js', freeze, run, '--confirm-paid'], check=True)
subprocess.run(['node', 'dist/current/sim/evaluation/score-unioncity-repair-pilot.js', freeze, run, score, '--confirm-paid'], check=True)
subprocess.run([str(Path('.venv/Scripts/python.exe').resolve()), 'scripts/evaluation/audit-unioncity-organized-pilot.py', 'v3'], check=True)
