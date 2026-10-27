"""Bounded sequential GPU pilot with process traces and independent Plus judge."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
from omegaconf import OmegaConf

ROOT = Path(__file__).resolve().parents[1]


def dump(path, data):
    path.write_text(json.dumps(data,indent=2,ensure_ascii=False),encoding='utf-8')


def judge(question, prediction):
    if not prediction:
        return dict(score=0,normalizedMatch=0.,reason='No answer; retained in denominator')
    prompt = (ROOT/'vendor/3dmem-aeqa-eval/prompts/mmbench.txt').read_text()
    payload = dict(model='qwen3.7-plus-2026-05-26',temperature=.2,max_tokens=1024,
        messages=[dict(role='user',content=prompt.format(question=question['question'],
            answer=question['answer'],prediction=prediction))])
    request = urllib.request.Request(os.environ['QWEN_BASE_URL'].rstrip('/')+'/chat/completions',
        data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+os.environ['QWEN_API_KEY'],
        'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(request,timeout=120) as response:
            result=json.load(response)
        text=result['choices'][0]['message']['content'].strip()
        match=re.fullmatch(r'(?:Your mark:\s*)?([1-5])\s*',text)
        score=int(match.group(1)) if match else None
        return dict(score=score,normalizedMatch=None if score is None else 25.*(score-1),
            output=text,returnedModel=result.get('model'),usage=result.get('usage'))
    except Exception as e:
        return dict(score=None,normalizedMatch=None,errorType=type(e).__name__)


def process_summary(folder):
    def rows(name):
        path=folder/'trace'/name
        return [json.loads(x) for x in path.read_text().splitlines()] if path.exists() else []
    poses=rows('poses.jsonl')
    mem=rows('memory.jsonl')
    assoc=rows('associations.jsonl')
    decisions=rows('decisions.jsonl')
    out=dict(observations=len(poses),associationFrames=len(assoc),decisionCount=len(decisions),
        snapshotHistory=[dict(step=x['step'],objects=len(x['objects']),snapshots=len(x['snapshots']))
                         for x in mem if x['stage']=='after_snapshots'],
        matchedDetections=sum(b is not None for x in assoc for a,b in x['matches']),
        unmatchedDetections=sum(b is None for x in assoc for a,b in x['matches']))
    if poses:
        out.update(simulatedSeconds=poses[-1]['time'],
            finalPositionErrorM=poses[-1]['positionErrorM'],maxPositionErrorM=max(x['positionErrorM'] for x in poses),
            finalRotationErrorDeg=poses[-1]['rotationErrorDeg'],maxRotationErrorDeg=max(x['rotationErrorDeg'] for x in poses))
    return out


def main():
    assert os.environ.get('QWEN_API_KEY') and os.environ.get('QWEN_BASE_URL')
    protocol=json.loads((ROOT/'reports/imu-memory-v1-protocol.json').read_text())
    runtime=Path(protocol['runtime'])
    for rel,digest in protocol['runtimeHashes'].items():
        assert hashlib.sha256((runtime/rel).read_bytes()).hexdigest()==digest,rel
    manifest=json.loads((ROOT/'reports/minival26-baseline-v1-manifest.json').read_text())
    questions={q['question_id']:q for q in json.loads((ROOT/'data/hm3d-minival-eqa-subset/questions.json').read_text())}
    runroot=ROOT/'runs/imu-memory-v1-pilot'
    report=ROOT/'reports/imu-memory-v1-pilot-progress.json'
    runs=[]
    # Interleave conditions per question so paired diagnostics arrive early.
    for qid in manifest['questions'][:3]:
        for profile in ('gt','bmi_like','mpu_like'):
            folder=runroot/qid/profile
            folder.mkdir(parents=True,exist_ok=True)
            status=folder/'execution.json'
            if status.exists():
                runs.append(json.loads(status.read_text()))
                continue
            if (folder/'run.log').exists():
                raise RuntimeError('Unfinished prior run requires review, refusing overwrite')
            cfg=OmegaConf.load(ROOT/'runs/minival26-baseline-v1'/qid/'config.yaml')
            cfg.output_parent_dir=str(folder/'output')
            cfg.noise_profile=profile
            cfg.noise_seed=0
            cfg.noise_trace_dir=str(folder/'trace')
            OmegaConf.save(cfg,folder/'config.yaml')
            env=dict(os.environ)
            env.update(TORCH_HOME=str(ROOT/'cache/torch'),HF_HOME=str(ROOT/'cache/hf'),
                TMPDIR=str(ROOT/'cache/tmp'),GALLIUM_DRIVER='d3d12',MESA_D3D12_DEFAULT_ADAPTER_NAME='NVIDIA',
                PYTHONDONTWRITEBYTECODE='1',RESEARCH_API_MAX_CALLS='110',RESEARCH_VLM_MODEL='qwen3.8-flash',
                RESEARCH_API_USAGE_FILE=str(folder/'api-usage.jsonl'),RESEARCH_API_AUDIT_FILE=str(folder/'api-input-hashes.jsonl'))
            row=dict(questionId=qid,profile=profile,seed=0)
            print('START',qid,profile,flush=True)
            start=time.monotonic()
            with (folder/'run.log').open('w') as log:
                try:
                    process=subprocess.run([sys.executable,'-u','-B','run_aeqa_evaluation.py','-cf',str(folder/'config.yaml')],
                        cwd=runtime,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=3600)
                    row.update(exitCode=process.returncode,status='process_completed' if process.returncode==0 else 'process_failed')
                except subprocess.TimeoutExpired:
                    row.update(exitCode=None,status='timeout')
            row['seconds']=time.monotonic()-start
            answers=folder/'output/baseline/gpt_answer.json'
            row['answers']=json.loads(answers.read_text()) if answers.exists() else []
            row['prediction']=next((a.get('answer') for a in row['answers'] if a.get('question_id')==qid),None)
            row['process']=process_summary(folder)
            row['judge']=judge(questions[qid],row['prediction'])
            dump(status,row)
            runs.append(row)
            dump(report,dict(expectedRuns=9,finished=len(runs),scope=protocol['scope'],executions=runs))
            print('END',qid,profile,row['status'],'pose=',row['process'].get('finalPositionErrorM'),
                  'score=',row['judge']['score'],flush=True)
            if row['status']!='process_completed':
                raise RuntimeError('Pilot pipeline failure: inspect before more paid calls')


if __name__=='__main__':
    main()
