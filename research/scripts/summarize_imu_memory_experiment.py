"""Plot recorded native fusion and IMU propagation; no new model/API calls."""
import collections
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT/'runs/imu-memory-v1-pilot'
OUT = ROOT/'reports/imu-memory-v1-process'


def load(path):
    if not path.exists():
        return []
    return [json.loads(x) for x in path.read_text(encoding='utf-8').splitlines()]


def main():
    OUT.mkdir(exist_ok=True)
    summaries=[]
    for episode in sorted(RUNS.iterdir()):
        if not episode.is_dir():
            continue
        fig,ax=plt.subplots(2,3,figsize=(15,8))
        gt_images={x['frame']:x for x in load(episode/'gt/trace/observations.jsonl')}
        gt_memory={x['frame']:x for x in load(episode/'gt/trace/memory.jsonl') if x['stage']=='after_snapshots'}
        for profile in ('gt','bmi_like','mpu_like'):
            folder=episode/profile
            status=folder/'execution.json'
            if not status.exists():
                continue  # Completed runs only; never read partially written traces.
            execution=json.loads(status.read_text(encoding='utf-8'))
            poses=load(folder/'trace/poses.jsonl')
            memory=[x for x in load(folder/'trace/memory.jsonl') if x['stage']=='after_snapshots']
            images=load(folder/'trace/observations.jsonl')
            decisions=load(folder/'trace/decisions.jsonl')
            row=dict(questionId=episode.name,profile=profile,process=execution['process'],
                     prediction=execution['prediction'],judge=execution['judge'])
            equal=[x['frame'] for x in images if x['frame'] in gt_images and
                   x['rgbSha256']==gt_images[x['frame']]['rgbSha256'] and
                   x['depthSha256']==gt_images[x['frame']]['depthSha256']]
            row['sameImageFramesAsGt']=equal
            row['firstDifferentImageFrame']=next((x['frame'] for x in images if x['frame'] in gt_images and
                x['frame'] not in equal),None)
            row['sameImageStepMemoryComparisons']=[]
            for m in memory:
                g=gt_memory.get(m['frame'])
                if g is None or m['frame'] not in equal:
                    continue
                # Counts are observable diagnostics, NOT semantic split/merge ground truth.
                cats=collections.Counter(o['category'] for o in m['objects'])
                gt_cats=collections.Counter(o['category'] for o in g['objects'])
                row['sameImageStepMemoryComparisons'].append(dict(step=m['step'],
                    objectCount=len(m['objects']),gtObjectCount=len(g['objects']),
                    snapshots=len(m['snapshots']),gtSnapshots=len(g['snapshots']),
                    categoryCountDelta={c:cats[c]-gt_cats[c] for c in cats.keys()|gt_cats.keys() if cats[c]!=gt_cats[c]},
                    medianObjectExtentM=float(np.median([max(o['extent']) for o in m['objects']])) if m['objects'] else None))
            row['decisions']=decisions
            summaries.append(row)
            if poses:
                times=[p['time'] for p in poses]
                ax[0,0].plot(times,[p['positionErrorM'] for p in poses],label=profile)
                ax[0,1].plot(times,[p['rotationErrorDeg'] for p in poses],label=profile)
                ax[0,2].plot(times,[np.linalg.norm(p['velocity']) for p in poses],label=profile)
                xyz=np.array([p['estimatedCameraPose'] for p in poses])[:,:3,3]
                ax[1,2].plot(xyz[:,0],xyz[:,2],label=profile)
            ax[1,0].plot([m['step'] for m in memory],[len(m['objects']) for m in memory],label=profile)
            ax[1,1].plot([m['step'] for m in memory],[len(m['snapshots']) for m in memory],label=profile)
        titles=['Position error (m)','Rotation error (deg)','Estimated speed (m/s)',
                'Map object count','Memory snapshot count','Estimated XZ trajectory (m)']
        for a,title in zip(ax.flat,titles):
            a.set_title(title)
            a.grid(alpha=.3)
            a.legend()
        fig.suptitle(episode.name+' / pure IMU memory-side intervention, not VIO')
        fig.tight_layout()
        fig.savefig(OUT/(episode.name+'.png'),dpi=130)
        plt.close(fig)
    result=dict(scope='Pilot diagnostic, seed 0. Native fusion counts are not instance accuracy. Trajectories may diverge.',rows=summaries)
    (OUT/'comparisons.json').write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf-8')
    print('Completed runs analyzed:',len(summaries))


if __name__=='__main__':
    main()
