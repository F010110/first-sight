"""Freeze model-only replay and public tasks; evaluator answers stay separate."""
import argparse
import json
from pathlib import Path
from salad_features import sha

def prepare(sample, bank, output):
    observations=[json.loads(l) for l in (sample/'observations.jsonl').read_text().splitlines()]
    public=json.loads((bank/'model-questions.json').read_text(encoding='utf8'));private=json.loads((bank/'evaluation-only'/'tasks.json').read_text(encoding='utf8'))
    if len(public)!=90 or len(private)!=90:raise ValueError('Expected frozen 90-task bank')
    if {t['id'] for t in public}!={t['id'] for t in private}:raise ValueError('Question bank mismatch')
    output.mkdir(parents=True,exist_ok=False);replay=output/'model-replay';replay.mkdir();windows=0;episode_count=0;in_window=0
    for i,o in enumerate(observations):
        if i==0 or o['episodeId']!=observations[i-1]['episodeId']:episode_count+=1;in_window=0
        in_window+=1
        o['episodeNumber']=episode_count
        o['cameras']={view:str((sample/path).resolve()) for view,path in o['cameras'].items()}
        o['flushAfter']=in_window==4 or i==len(observations)-1 or observations[i+1]['episodeId']!=o['episodeId']
        if o['flushAfter']:windows+=1;in_window=0;o['closedAtMs']=o['atMs']
    # Availability watermark prevents reasons produced by joint windows from
    # appearing as if available at an earlier observation inside that window.
    pending=[]
    for o in observations:
        pending.append(o)
        if o['flushAfter']:
            for p in pending:p['judgmentAvailableAtMs']=o['atMs']
            pending=[]
    (replay/'observations.jsonl').write_text('\n'.join(map(json.dumps,observations))+'\n')
    (output/'model-questions.json').write_text(json.dumps(public,ensure_ascii=False,indent=2),encoding='utf8')
    selected=[]
    for tier in ('current','short','long'):
        rows=[t for t in private if t['memoryTier']==tier and t['answerable']]
        selected.extend([rows[0]['id'],rows[-1]['id']])
    (output/'smoke-ids.json').write_text(json.dumps(selected,indent=2))
    config={'maxWindows':windows,'maxObservations':len(observations),'plannedScheduling':True,'identityReview':True,'reviewReuse':True,'temporalOverlap':False,'inputPerMillion':.1356,'outputPerMillion':.4584,'currency':'USD','maxCost':4,'maxInputTokens':20000000,'maxOutputTokens':1000000,'maxProviderCalls':windows*4,'priceSource':'https://www.alibabacloud.com/help/en/pai/product-overview/billing-of-pai-token-service','priceBasis':'Published PAI Token Service qwen3.8-flash China Beijing rate; estimate, not account invoice. Cache discounts ignored.','visualRecall':{'command':'wsl','args':['-d','Ubuntu','--cd','/mnt/d/Projects/Projects2026/VLM','--','/mnt/d/Projects/Projects2026/EAM/.venv-thor/bin/python','sim/spatial_visual_features.py']}}
    (output/'memory-config.json').write_text(json.dumps(config,indent=2))
    frozen={'observations':len(observations),'episodes':episode_count,'windows':windows,'tasks':len(public),'smokeTasks':6,'smokeQuestionExecutions':18,'fullQuestionExecutions':270,'sourceObservationsSha256':sha(sample/'observations.jsonl'),'replaySha256':sha(replay/'observations.jsonl'),'publicTasksSha256':sha(output/'model-questions.json'),'privateTasksSha256':sha(bank/'evaluation-only'/'tasks.json'),'bankManifestSha256':sha(bank/'manifest.json'),'smokeSelection':'First and last answerable question per tier, before predictions; no failure filtering','model':'qwen3.8-flash','enableThinking':False,'evaluationStatus':'prepared-not-scored','annotationReview':'assistant-source-assisted; no independent human review'}
    (output/'frozen.json').write_text(json.dumps(frozen,indent=2));print(json.dumps(frozen));return frozen

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('sample',type=Path);p.add_argument('bank',type=Path);p.add_argument('output',type=Path);a=p.parse_args();prepare(a.sample,a.bank,a.output)
