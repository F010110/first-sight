"""Sequential preparation and API pilot, preserving the interrupted render attempt."""
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
manifest=ROOT/'reports/direct-vlm-pilot-v1-manifest.json'
if not manifest.exists():
    subprocess.run([sys.executable,'-u','-B',str(ROOT/'scripts/prepare_direct_vlm_pilot.py'),
                    '--out',str(ROOT/'runs/direct-vlm-pilot-v1-preparation-retry1')],check=True,timeout=600)
subprocess.run([sys.executable,'-u','-B',str(ROOT/'scripts/run_direct_vlm_pilot.py')],check=True,timeout=1800)
