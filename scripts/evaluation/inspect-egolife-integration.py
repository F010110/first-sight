"""Audit official EgoLifeQA + local footage and exercise the PINNED official scorer.

Zero model calls. Generated gold self-tests are protocol tests, never accuracy.
"""
import argparse
import ast
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT=Path(__file__).resolve().parents[2]
COMMIT='3c023dfec301bb2f9624f82cee76007ac3ac0646'
QA=ROOT/'datasets/realism-source-survey-20261024-v2/EgoLife/EgoLifeQA/EgoLifeQA_A1_JAKE.json'

def sha(raw):return hashlib.sha256(raw).hexdigest()
def save(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8')

def clock(date,time):
    if not re.fullmatch(r'DAY[1-7]',str(date)):raise ValueError('Expected DAY1..DAY7')
    digits=str(time).zfill(8)
    if not re.fullmatch(r'\d{8}',digits):raise ValueError('Invalid HHMMSSff')
    h,m,s,f=[int(digits[i:i+2]) for i in [0,2,4,6]]
    if h>=24 or m>=60 or s>=60:raise ValueError('Invalid source clock')
    return {'untilTime':int(str(date)[3:]+digits),'cutoffMs':((int(str(date)[3:])-1)*86400+h*3600+m*60+s)*1000+f*10}

def public_task(row):
    choices={k:row['choice_'+k.lower()] for k in 'ABCD'}
    if not all(isinstance(v,str) and v.strip() for v in choices.values()):raise ValueError('Incomplete choices')
    return {'ID':str(row['ID']),'type':row['type'],'question':row['question'],'choices':choices,'queryTime':row['query_time'],**clock(row['query_time']['date'],row['query_time']['time'])}

def target_ranges(row):
    target=row.get('target_time') or {};date=str(target.get('date','')).upper();value=target.get('time')
    if value:
        text=str(value)
        match=re.fullmatch(r'(\d{8})DAY([1-7])_(\d{8})',text)
        if match:return [(clock(date,match[1])['cutoffMs'],clock('DAY'+match[2],match[3])['cutoffMs'])]
        if text.isdigit():
            t=clock(date,text)['cutoffMs'];return [(t,t)]
        return None
    if target.get('time_list'):
        return [(clock(date,t)['cutoffMs'],clock(date,t)['cutoffMs']) for t in target['time_list']]
    return None

def covers(intervals,start,end):
    if end<start:return False
    if start==end:return any(a<=start<b for a,b in intervals)
    cursor=start
    for a,b in sorted(intervals):
        if a>cursor:continue
        if b>=end and a<=cursor:return True
        if b>cursor:cursor=b
    return False

def run(output,repo):
    if output.exists():raise FileExistsError('Use a new output directory')
    rows=json.loads(QA.read_text(encoding='utf8'))
    tasks=[public_task(row) for row in rows]
    if len({t['ID'] for t in tasks})!=len(tasks):raise ValueError('Duplicate official IDs')
    if any(row['answer'] not in 'ABCD' or len(row['answer'])!=1 for row in rows):raise ValueError('Invalid pre-existing gold')
    intervals=[];manifests=[]
    for path in sorted((ROOT/'datasets/long-real-videos-v1').glob('egolife*/manifest.json')):
        raw=path.read_bytes();manifest=json.loads(raw)
        for clip in manifest['clips']:
            source=clip['sourcePath'];match=re.fullmatch(r'A1_JAKE/(DAY[1-7])/DAY[1-7]_A1_JAKE_(\d{8})\.mp4',source)
            if not match:raise ValueError('Unknown source filename clock')
            original=path.parent/clip['file']
            if not original.is_file() or original.stat().st_size!=clip['bytes']:raise ValueError('Missing/truncated local clip')
            start=clock(match[1],match[2])['cutoffMs'];intervals.append((start,start+clip['durationMs']))
        manifests.append({'path':str(path.relative_to(ROOT)),'sha256':sha(raw),'license':manifest.get('license'),'clips':len(manifest['clips']),'sourceStart':manifest['clips'][0]['sourcePath'],'sourceLast':manifest['clips'][-1]['sourcePath']})
    coverage=[]
    for row,task in zip(rows,tasks):
        try:ranges=target_ranges(row)
        except ValueError:ranges=None
        q=task['cutoffMs'];inside=covers(intervals,q,q)
        evidence=bool(ranges) and all(b<=q and covers(intervals,a,b) for a,b in ranges)
        audio=bool(row.get('need_audio'));names=bool(row.get('need_name'))
        coverage.append({'ID':task['ID'],'type':task['type'],'queryInsideStoredFootage':inside,'annotatedTargetCovered':evidence,'targetParsingSupported':ranges is not None,'requiresAudio':audio,'requiresNames':names,'rgbPilotCandidate':inside and evidence and not audio and not names,'completeHistoryCertified':False,'note':'Target coverage is not a proof of sufficient full history; no model inference authorized by this row.'})
    # Load only three reviewed pure scoring helpers, never heavyweight imports.
    evaluator=subprocess.check_output(['git','show',COMMIT+':research/em2mem/eval/eval.py'],cwd=repo,timeout=15)
    tree=ast.parse(evaluator.decode('utf8'));names={'normalize','extract_choice_letter','evaluate_prediction'}
    functions=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in names]
    if {f.name for f in functions}!=names:raise ValueError('Official scorer helpers changed')
    module=ast.Module(body=functions,type_ignores=[]);namespace={'re':re,'Optional':__import__('typing').Optional,'Dict':__import__('typing').Dict}
    exec(compile(module,'pinned-upstream-scorer-helpers','exec'),namespace)
    score=namespace['evaluate_prediction']
    positive=sum(score(row['answer'],row['answer'],task['choices']) for row,task in zip(rows,tasks))
    errors=sum(score('Error',row['answer'],task['choices']) for row,task in zip(rows,tasks))
    abstain_bug=score('Abstained','A',{'A':'desk','B':'shelf','C':'drawer','D':'unknown'})
    if positive!=len(rows) or errors!=0:raise ValueError('Official scorer contract mismatch')
    output.mkdir(parents=True,exist_ok=False)
    save(output/'public-tasks.json',{'schema':'egolife-official-task-adapter-v1','tasks':tasks})
    save(output/'gold.json',{'schema':'egolife-official-gold-adapter-v1','sourceSha256':sha(QA.read_bytes()),'answers':[{'ID':str(row['ID']),'answer':row['answer'],'target_time':row.get('target_time')} for row in rows]})
    save(output/'coverage.json',{'manifests':manifests,'questions':coverage})
    summary={'schema':'egolife-integration-audit-v1','officialQuestions':len(rows),'typeCounts':dict(Counter(row['type'] for row in rows)),'queryDayCounts':dict(Counter(row['query_time']['date'] for row in rows)),'localClips':len(intervals),'queryTimesCovered':sum(c['queryInsideStoredFootage'] for c in coverage),'queriesWithTargetsCovered':sum(c['queryInsideStoredFootage'] and c['annotatedTargetCovered'] for c in coverage),'rgbPilotCandidates':sum(c['rgbPilotCandidate'] for c in coverage),'allVisualNoNamesQuestions':sum(not row.get('need_audio') and not row.get('need_name') for row in rows),'nativeScorerProtocolSelfTest':{'goldLetterAccepted':positive,'errorSentinelCountedCorrect':errors,'literalAbstainedCanBeMisreadAsA':abstain_bug,'isTaskAccuracy':False},'scorerCommit':COMMIT,'scorerSha256':sha(evaluator),'qaSha256':sha(QA.read_bytes()),'paidCalls':0,'taskAccuracy':None,'reproductionStatus':'task-interface-and-official-scorer-only-not-memory-inference'}
    save(output/'summary.json',summary)
    save(output/'frozen.json',{'publicSha256':sha((output/'public-tasks.json').read_bytes()),'goldSha256':sha((output/'gold.json').read_bytes()),'sourceQA':str(QA.relative_to(ROOT)),'sourceQASha256':sha(QA.read_bytes()),'upstreamScorerSha256':sha(evaluator),'upstreamCommit':COMMIT,'scriptSha256':sha(Path(__file__).read_bytes()),'purpose':'pre-inference protocol and coverage freeze; no accuracy claimed'})
    return summary

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--upstream-repo',type=Path,default=Path(r'C:\Users\helele\AppData\Local\Temp\opencode\lightmem-ego-audit'));a=p.parse_args();print(json.dumps(run(a.output,a.upstream_repo),ensure_ascii=False))
