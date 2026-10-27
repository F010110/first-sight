"""Freeze unannotated observations for a no-3D, all-history QA pilot.

Uses only the two completed GT trajectories, cut at the final actual QA query.
Does not expose observations captured after that query, poses, classes, or GT answers.
"""
import hashlib
import argparse
import json
import os
from pathlib import Path
import sys
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'runs/3dmem-minival-runtime-v1'))
os.environ.setdefault('HABITAT_SIM_LOG','quiet')
os.environ.setdefault('MAGNUM_LOG','quiet')
import habitat_sim
import quaternion
from src.habitat import make_simple_cfg
from src.utils import rgba2rgb


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--out',type=Path,default=ROOT/'runs/direct-vlm-pilot-v1')
    args=parser.parse_args()
    out=args.out.resolve()
    out.mkdir(exist_ok=False)
    manifest=json.loads((ROOT/'reports/minival26-baseline-v1-manifest.json').read_text())
    questions={q['question_id']:q for q in json.loads((ROOT/'data/hm3d-minival-eqa-subset/questions.json').read_text())}
    report=dict(scope='Offline all-history QA on two GT exploration trajectories; not independent exploration or full26 score',
        answerModels=['qwen3.8-flash','qwen3.8-max-0902'],judgeModel='qwen3.7-plus-2026-05-26',
        maxOutputTokens=4096,temperature=.7,sdkRetries=0,questions=[])
    for qid in manifest['questions'][:2]:
        q=questions[qid]
        source=ROOT/'runs/imu-memory-v1-pilot'/qid/'gt'
        decisions=[json.loads(x) for x in (source/'trace/decisions.jsonl').read_text().splitlines()]
        cutoff=max(d['step'] for d in decisions)
        poses=[json.loads(x) for x in (source/'trace/poses.jsonl').read_text().splitlines() if json.loads(x)['step']<=cutoff]
        hashes={x['frame']:x for x in [json.loads(y) for y in (source/'trace/observations.jsonl').read_text().splitlines()]}
        scene=q['episode_history']
        settings=dict(scene=str(ROOT/'data/hm3d-minival-glb-v0.2'/scene/(scene.split('-')[1]+'.glb')),
            default_agent=0,sensor_height=0.,width=1280,height=1280,hfov=120.,scene_dataset_config_file='default',camera_tilt=0.)
        sim=habitat_sim.Simulator(make_simple_cfg(settings)); agent=sim.initialize_agent(0)
        folder=out/qid; folder.mkdir()
        row=dict(questionId=qid,question=q['question'],cutoffStep=cutoff,images=[],
                 baseline3DMemFlash=json.loads((source/'execution.json').read_text()))
        for p in poses:
            pose=np.array(p['gtCameraPose'])
            state=habitat_sim.AgentState();state.position=pose[:3,3]
            state.rotation=quaternion.from_rotation_matrix(pose[:3,:3]);agent.set_state(state)
            rgb=rgba2rgb(sim.get_sensor_observations()['color_sensor'])
            raw_hash=hashlib.sha256(rgb.tobytes()).hexdigest()
            path=folder/p['frame']
            Image.fromarray(rgb).resize((360,360)).save(path)
            row['images'].append(dict(frame=p['frame'],path=str(path),
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                rawRgbMatchesSource=raw_hash==hashes[p['frame']]['rgbSha256']))
        sim.close()
        row['allRawRgbMatchSource']=all(x['rawRgbMatchesSource'] for x in row['images'])
        report['questions'].append(row)
        print(qid,'images',len(row['images']),'rawExact',row['allRawRgbMatchSource'],flush=True)
    (ROOT/'reports/direct-vlm-pilot-v1-manifest.json').write_text(json.dumps(report,indent=2),encoding='utf-8')


if __name__=='__main__':
    main()
