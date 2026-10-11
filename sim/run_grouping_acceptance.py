"""One command for two adapters, one frozen benchmark, one verdict.

Adapters receive algorithm-input.json and must write output.json containing
snapshots/retrieval only. Reviewed relations/relevance/policy are never passed.
"""
import argparse,json,subprocess,hashlib,sys
from pathlib import Path
from grouping_benchmark import digest,compare

def main():
    p=argparse.ArgumentParser();p.add_argument('benchmark',type=Path);p.add_argument('baselineAdapter',type=Path);p.add_argument('candidateAdapter',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    read=lambda path:json.loads(path.read_text(encoding='utf8'))
    bench=read(a.benchmark);specs=[read(a.baselineAdapter),read(a.candidateAdapter)]
    if specs[0]['evidenceBudget']!=specs[1]['evidenceBudget']:raise ValueError('Different evidence budgets')
    for obs in bench['observations']:
        for frame in obs['frames']:
            if hashlib.sha256(Path(frame['path']).read_bytes()).hexdigest()!=frame['sha256']:raise ValueError('Raw image changed: '+frame['path'])
    a.output.mkdir(parents=True,exist_ok=False)
    # Only image inventory/timestamps and retrieval candidate task are visible.
    inputs={'observations':bench['observations'],'queries':[{'id':q['id'],'query':q['query'],'candidates':q['candidates']} for q in bench['queries']]}
    inputPath=(a.output/'algorithm-input.json').resolve();inputPath.write_text(json.dumps(inputs),encoding='utf8');runs=[]
    for name,spec in zip(['baseline','candidate'],specs):
        directory=a.output/name;directory.mkdir();output=(directory/'output.json').resolve()
        workdir=Path(spec['workdir']).resolve()
        commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=workdir,text=True).strip()
        if commit!=spec['algorithmCommit']:raise ValueError('Adapter checkout does not match frozen commit')
        dirty=subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=workdir,text=True)
        if dirty.strip():raise ValueError('Adapter checkout contains uncommitted tracked changes')
        command=[part.replace('{input}',str(inputPath)).replace('{output}',str(output)) for part in spec['command']]
        if not any('{input}' in part for part in spec['command']) or not any('{output}' in part for part in spec['command']):raise ValueError('Adapter must use input/output placeholders')
        with (directory/'stdout.log').open('w',encoding='utf8') as log:
            subprocess.run(command,cwd=workdir,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=spec.get('timeoutSeconds',1800))
        raw=read(output)
        run={'protocol':'grouping-run-v1','benchmarkHash':digest(bench),'mode':'online','algorithmCommit':commit,'evidenceBudget':spec['evidenceBudget'],'snapshots':raw['snapshots'],'retrieval':raw['retrieval']}
        (directory/'run.json').write_text(json.dumps(run,ensure_ascii=False,indent=2),encoding='utf8');runs.append(run)
    result=compare(bench,*runs)
    (a.output/'comparison.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    subprocess.run([sys.executable,str(Path(__file__).with_name('grouping_benchmark.py').resolve()),str(a.benchmark.resolve()),str((a.output/'baseline/run.json').resolve()),str((a.output/'candidate/run.json').resolve()),str((a.output/'review').resolve())],check=True)

if __name__=='__main__':main()
