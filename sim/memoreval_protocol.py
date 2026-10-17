"""Public task protocol adapter; not the unreleased official simulator/grader.

Experience skill calls are simulator-controller inputs, never memory observations.
Each request is exported independently: no previous QA context or reference plan.
"""
import argparse
import json
import subprocess
from pathlib import Path
from salad_features import sha

def export(source: Path, output: Path):
    files=sorted((source/'tasks').rglob('*.json'))
    if not files or len(files)>2000: raise ValueError('Task file budget exceeded or no tasks')
    requests=[];truth=[];controllers=[];seen=set()
    for path in files:
        if path.stat().st_size>2_000_000: raise ValueError('Task size budget exceeded')
        task=json.loads(path.read_text(encoding='utf8'))
        for request in task['requests']:
            key=f"{task['scene']}/{task['task']}/{request['id']}"
            if key in seen: raise ValueError('Duplicate request')
            seen.add(key)
            # Allowlist, not a blacklist: nested reference fields cannot leak.
            public={k:request[k] for k in ('instruction','question','allowed_skills','max_steps') if k in request}
            requests.append({'id':key,'freshContext':True,'memoryKey':f"{task['scene']}/{task['task']}",**public})
            truth.append({'id':key,'sourceSha256':sha(path),'request':request,'category':task.get('category')})
        controllers.append({'memoryKey':f"{task['scene']}/{task['task']}",'experience':task['experience'],'note':'Controller-only. Memory writer receives captured observations, not these targets or actions.'})
    output.mkdir(parents=True,exist_ok=False)
    private=output/'evaluation-only';private.mkdir()
    for path,rows in [(output/'requests.jsonl',requests),(private/'truth.jsonl',truth),(private/'experience-controller.jsonl',controllers)]:
        path.write_text('\n'.join(map(json.dumps,rows))+'\n',encoding='utf8')
    report={'tasks':len(files),'requests':len(requests),'revision':subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip(),'modelCalls':0,'officialReproduction':False,'note':'Schema/protocol only; no simulator execution, predicted graph, grading accuracy or memory quality established.'}
    (output/'complete.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);a=p.parse_args();print(json.dumps(export(a.source,a.output)))
