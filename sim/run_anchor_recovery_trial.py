"""New-directory algorithm trial on five HSSD captures AND both old home cases.

Same original query inventory; denser evidence uses existing raw frames only.
Ground truth is loaded exclusively after unchanged VLM inference.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from download_hssd import SCENES
from fixed_region_queries import score_queries


def main():
    root=Path('run/updating-context-v2'); root.mkdir(parents=True,exist_ok=True)
    cases=[]
    for name,dataset in [('home-val4','region-val4-multiview'),('home-val5','multiview-val5-clean-20261007')]:
        directory=Path('run/sim')/dataset
        cases.append({'name':name,'dataset':directory,'baseline':directory,'vo':Path('run/sim')/f'visual-functional-v2-val{name[-1]}'/'vo.json','tickMs':1000,'queries':Path('docs/experiments')/('fixed-region-queries-open-living-val4-v1.json' if name.endswith('4') else 'fixed-region-queries-val5-v1.json')})
    for scene in SCENES:
        work=Path('run/hssd-six-v1')/scene
        captures=sorted(p.parent for p in work.glob('attempt-*/capture/manifest.json'))
        if not captures: continue
        capture=captures[-1]; attempt=capture.parent
        cases.append({'name':'hssd-'+scene,'dataset':capture,'baseline':attempt/'pipeline/baseline','vo':attempt/'pipeline/vo.json','tickMs':500,'queries':None})
    summary={'protocol':'anchor-recovery-dense-evidence-trial-v1','plannedHssdScenes':6,'availableHssdScenes':5,'homeRegressionRequired':['home-val4','home-val5'],'cases':{},'status':'running','scope':'Weak-anchor recovery + original native-frame evidence, no relighting or new captures. Existing predictions unchanged.'}
    previous_path=root/'summary.json'
    if previous_path.exists():
        previous=json.loads(previous_path.read_text(encoding='utf8'))
        summary['cases']=previous.get('cases',{})
    def save(): (root/'summary.json').write_text(json.dumps(summary,indent=2))
    def run(command,log):
        with log.open('w',encoding='utf8') as output: subprocess.run(command,stdout=output,stderr=subprocess.STDOUT,check=True,env={**os.environ,'VLM_PYTHON':sys.executable})
    save()
    for case in cases:
        previous=summary['cases'].get(case['name'],{})
        if previous.get('status')=='completed':
            print(f"{case['name']}: reuse completed result",flush=True);continue
        out=root/case['name']
        if out.exists():
            previous_record={**previous,'status':'interrupted-or-failed','note':'Resume after process stopped; original inputs/logs retained, no completed prediction replaced.'}
            (out/f'interruption-{time.time_ns()}.json').write_text(json.dumps(previous_record,indent=2))
            out=out/f'retry-{time.time_ns()}'
        out.mkdir(parents=True); row={'status':'running','stage':'dense-evidence','outputDirectory':str(out)}; summary['cases'][case['name']]=row; save()
        try:
            run([sys.executable,'sim/dense_context_evidence.py',str(case['dataset']),str(out/'dense.json'),'--tick-ms',str(case['tickMs'])],out/'dense.log')
            row['stage']='online-replay';save()
            command=['node','dist/sim/hssd-memory-replay.js',str(case['dataset']),str(case['baseline']),str(case['vo']),str(out/'online'),'-',str(out/'dense.json')]
            if case['name'].startswith('home'): command+=['1000']
            run(command,out/'replay.log')
            row['stage']='vlm-atlases';save()
            run([sys.executable,'sim/vlm_group_aggregation_trial.py',str(out/'online/replay.json'),str(case['dataset']),'unused',str(out/'atlases'),'--prepare-only'],out/'atlas.log')
            row['stage']='identity-inference';save()
            run([sys.executable,'sim/vlm_group_identity_annotations_trial.py',str(out/'atlases'),str(out/'online/replay.json'),'unused','unused',str(out/'inference'),'--unscored'],out/'inference.log')
            read=lambda p:json.loads(p.read_text(encoding='utf8'))
            replay=read(out/'online/replay.json'); report=read(out/'inference/report.json'); dense=read(out/'dense.json')
            row.update(status='completed',stage='done',localGroups=len(replay['grouping']['groups']),denseContextProposals=len(dense['events']),unknownObservations=sum(v is None for v in report['finalAssignments'].values()),observations=len(report['finalAssignments']),restartPassed=replay['restartRoundtripPassed'],elapsedSeconds=report['elapsedMs']/1000)
            if case['queries']:
                contract=read(case['queries']); snapshots=replay['online']['snapshots']
                score=score_queries(contract,[*snapshots[:-1],{**snapshots[-1],'assignments':report['finalAssignments']}])
                (out/'home-regression-score.json').write_text(json.dumps(score,indent=2))
                row['homeCoreScore']=score['overall']; row['frozenBaselineCoreCorrect']=44 if case['name'].endswith('4') else 28
                row['homeCoreNonRegressionPassed']=score['overall']['correct']>=row['frozenBaselineCoreCorrect']
        except Exception as error:
            row.update(status='failed',exceptionType=type(error).__name__)
            (out/'failure.json').write_text(json.dumps(row,indent=2))
        save();print(json.dumps({case['name']:row}),flush=True)
    summary['status']='finished';summary['homeNonRegressionPassed']=all(summary['cases'].get(name,{}).get('homeCoreNonRegressionPassed',False) for name in summary['homeRegressionRequired']);save()
    print(json.dumps(summary,indent=2))


if __name__=='__main__':main()
