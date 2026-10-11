"""One command: original triples -> VO -> inferred tracks -> TS memory replay.

Requires built dist and cached historical image correspondences/baseline bundle.
Those are explicit old-memory inputs, not simulator labels. Does not install or
replace production memory; all outputs go to a NEW directory.
"""
import argparse
import json
import subprocess
import sys
import time
import os
from pathlib import Path

def main():
    p=argparse.ArgumentParser();p.add_argument('dataset',type=Path);p.add_argument('output',type=Path);p.add_argument('--calibration',type=Path);p.add_argument('--experimental-boundaries',action='store_true');a=p.parse_args()
    if not Path('dist/sim/visual-experience-replay.js').exists():raise ValueError('Run npm.cmd run build first')
    for file in ['windows.jsonl']:
        if not (a.dataset/file).exists():raise ValueError(f'Missing explicit old-memory replay input: {file}')
    a.output.mkdir(parents=True,exist_ok=False);started=time.perf_counter()
    vo=a.output/'vo.json';tracks=a.output/'boundary-tracks.json'
    command=[sys.executable,'sim/three_view_vo.py',str(a.dataset),str(vo)]
    if a.calibration:command+=['--calibration',str(a.calibration)]
    subprocess.run(command,check=True)
    if a.experimental_boundaries:
        subprocess.run([sys.executable,'sim/automatic_boundary_tracks.py',str(a.dataset/'frames'),str(vo),str(tracks)],check=True)
    else:
        with tracks.open('x') as f:json.dump({'protocol':'automatic-boundary-tracks-v1','quality':'experimental-inferred-not-certified','events':[],'trace':[],'disabled':True,'reason':'Failed real replay acceptance; explicit experimental opt-in required'},f)
    revisit=a.output/'revisit-geometry.json'
    subprocess.run([sys.executable,'sim/revisit_geometry.py',str(a.dataset),str(revisit)],check=True)
    baseline=a.dataset
    if not all((baseline/name).exists() for name in ['experience-sequence-bundle.json','experience-directional-evidence.json','local-rotation-evidence.json']):
        baseline=a.output/'baseline'
        subprocess.run(['node','dist/sim/build-visual-memory-inputs.js',str(a.dataset),str(baseline)],check=True,env={**os.environ,'VLM_PYTHON':sys.executable})
        if not a.calibration and not (a.dataset/'local-rotation-evidence.json').exists():
            subprocess.run([sys.executable,'sim/local_rotation_evidence.py',str(a.dataset),str(a.output/'fresh-geometry.json')],check=True)
            (baseline/'local-rotation-evidence.json').write_bytes((a.output/'fresh-geometry.json').read_bytes())
    subprocess.run(['node','dist/sim/visual-experience-replay.js',str(a.dataset),str(a.output/'memory'),str(vo),str(tracks),str(baseline),str(revisit)],check=True)
    with (a.output/'run.json').open('x') as f:json.dump({'protocol':'visual-memory-full-replay-v1','elapsedMs':(time.perf_counter()-started)*1000,'dataset':str(a.dataset),'oldMemoryInputs':'association bundle + cached image correspondences; no oracle labels used','boundaryQuality':'automatic inferred proposals, not certified physical truth','realDeviceLatency':False},f,indent=2)

if __name__=='__main__':main()
