"""DirectMe's official bounded KeyframeSelector on cached learned descriptors.
Selection sidecar only; does not overwrite topology representatives or assignments.
"""
import argparse
import importlib.util
import json
from pathlib import Path

def main():
    p=argparse.ArgumentParser();p.add_argument('--directme',required=True,type=Path);p.add_argument('--features',required=True,type=Path);p.add_argument('--dataset',required=True,type=Path);p.add_argument('--predictions',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args()
    import numpy as np
    import sys
    spec=importlib.util.spec_from_file_location('directme_keyframe_selector',a.directme/'directme'/'mapping'/'keyframe_selector.py');mod=importlib.util.module_from_spec(spec);sys.modules[spec.name]=mod;spec.loader.exec_module(mod)
    a.output.mkdir(parents=True,exist_ok=False)
    rows={r['id']:r for r in map(json.loads,(a.dataset/'observations.jsonl').read_text().splitlines())}
    descriptors={r['id']:r['features'] for r in map(json.loads,a.features.read_text().splitlines())}
    predictions=json.loads(a.predictions.read_text(encoding='utf8'))['observations'];states={};result={}
    for row in predictions:
        if not row['assignment'] or not row['assignment']['placeId']:continue
        pid=row['assignment']['placeId'];oid=row['id'];state=states.setdefault(pid,[])
        embedding=np.mean(descriptors[oid],axis=0);embedding/=max(float(np.linalg.norm(embedding)),1e-12)
        state.append({'id':oid,'embedding':embedding.tolist()});states[pid]=state[-16:]
        def select(candidates):
            selector=mod.KeyframeSelector(budget=4,pool_cap=16)
            for candidate in candidates:selector.add(candidate['id'],bbox_area=1.0,embedding=candidate['embedding'])
            return selector.selected
        chosen=select(states[pid])
        # JSON reload and reconstruct candidate pool: deterministic restart check.
        if chosen!=select(json.loads(json.dumps(states[pid]))):raise ValueError('Restart changed selection')
        result[pid]={'selectedObservationIds':chosen,'originalImages':[{v:rows[oid]['cameras'][v] for v in ['front','left','right']} for oid in chosen],'candidatePool':states[pid]}
    (a.output/'representatives.json').write_text(json.dumps(result))
    (a.output/'complete.json').write_text(json.dumps({'places':len(result),'maxPool':16,'maxObservationsPerPlace':4,'maxImagesPerPlace':12,'restartReplayChecked':True,'modelCalls':0,'note':'Official DirectMe selector; mean three-view embedding and last16 pool adapter, not object bbox selection or verified superiority. No topology mutation; revision integration still required.'},indent=2))

if __name__=='__main__':main()
