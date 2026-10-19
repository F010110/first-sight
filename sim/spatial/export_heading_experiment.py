"""Explicit simulation direction-only ablation; not real sensor measurements."""
import argparse
import json
import math
import random
from pathlib import Path

def main():
    p=argparse.ArgumentParser()
    p.add_argument('episode',type=Path);p.add_argument('output',type=Path)
    p.add_argument('--mode',choices=['ideal','noisy','dropout'],default='ideal')
    a=p.parse_args();rng=random.Random(20261011)
    rows=[json.loads(x) for x in (a.episode/'observations.jsonl').read_text().splitlines()]
    samples=[]
    for row in rows:
        if a.mode=='dropout' and rng.random()<.2:continue
        yaw=row['yaw']
        if a.mode=='noisy':yaw+=5*math.sin(row['tick']/10)+rng.uniform(-2,2)
        samples.append({'observationId':f'observation-{row["tick"]}','atMs':row['tick']*1000,'yawDegrees':yaw%360,'pitchDegrees':row['horizon'],'rollDegrees':0,'uncertaintyDegrees':0 if a.mode=='ideal' else 8 if a.mode=='noisy' else 1,'referenceId':'simulation-camera-yaw-session','source':'simulation-experiment','quality':'usable'})
    with a.output.open('x',encoding='utf8') as f:json.dump({'note':'Simulation direction-only ablation. No position/action/room fields exported. Ideal yaw is a privileged controlled input, not claimed real device performance.','mode':a.mode,'samples':samples},f,indent=2)

if __name__=='__main__':main()
