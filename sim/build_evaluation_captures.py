"""Capture six episodes across three pinned houses, record failures separately.

Capture count is NOT label count. Existing val4/5 are development houses;
val3 is reserved evaluation housing and must not be used to choose thresholds.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--houses',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=False)
    jobs=[]
    for house in [3,4,5]:
        for interval in [8,13]:
            name=f'val{house}-probe{interval}'
            target=args.output/name
            command=[sys.executable,'sim/record_episode.py','--house',str(args.houses/f'val-{house}.json'),'--fixed-route','--repeats','2','--rotation-probe-every',str(interval),'--max-frames','1600','--output',str(target)]
            with (args.output/f'{name}.log').open('w') as log:
                code=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT).returncode
            row={'id':name,'split':'held-out-scene' if house==3 else 'development','captureExitCode':code,'status':'failed','labelsStatus':'not-reviewed'}
            if code==0:
                rows=[json.loads(x) for x in (target/'observations.jsonl').read_text().splitlines()]
                manifest=json.loads((target/'manifest.json').read_text())
                rotation_pairs=sum(a['x']==b['x'] and a['z']==b['z'] and a['yaw']!=b['yaw'] for a,b in zip(rows,rows[1:]))
                row.update(frames=len(rows),adjacentSamePositionTurnPairs=rotation_pairs,truncated=manifest['route_truncated'],status='recorded')
                subprocess.run([sys.executable,'sim/derive_motion.py',str(target),'--observe-every','1'],check=True)
                subprocess.run([sys.executable,'sim/audit_episode.py',str(target)],check=True,stdout=subprocess.DEVNULL)
            jobs.append(row)
            (args.output/'capture-index.json').write_text(json.dumps({'note':'Raw capture inventory, not activity-region ground truth or independent sample count. Rotations/repeats correlated. Simulator annotations for evaluation only.','jobs':jobs},indent=2))
            print(json.dumps(row),flush=True)
    if any(row['captureExitCode'] for row in jobs):sys.exit(1)

if __name__=='__main__':main()
