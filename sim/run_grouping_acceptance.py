"""One command for two adapters, one frozen benchmark, one verdict.

Adapters receive algorithm-input.json and must write output.json containing
snapshots/retrieval only. Reviewed relations/relevance/policy are never passed.
"""
import argparse,json,subprocess,hashlib,sys
from pathlib import Path
from grouping_benchmark import digest,compare
from temporal_classification_standard import score

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
    formal=bench['protocol']=='temporal-image-benchmark-v1'
    inputs={'observations':bench['observations'],'queries':[] if formal else [{'id':q['id'],'query':q['query'],'candidates':q['candidates']} for q in bench['queries']]}
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
        run={'protocol':'grouping-run-v1','benchmarkHash':digest(bench),'mode':'online','algorithmCommit':commit,'evidenceBudget':spec['evidenceBudget'],'snapshots':raw['snapshots'],'retrieval':raw.get('retrieval',{})}
        (directory/'run.json').write_text(json.dumps(run,ensure_ascii=False,indent=2),encoding='utf8');runs.append(run)
    if formal:
        results=[score(bench['observations'],run['snapshots'],bench['labels']) for run in runs]
        for result in results:
            if not bench['review']['independent'] or not bench['review']['heldOut']:
                result['blockers'].append('缺独立留出验收证据')
                if not result['failures']:result['verdict']='证据不足'
        result={'protocol':'formal-classification-comparison-v1','benchmarkHash':digest(bench),'baseline':results[0],'candidate':results[1],'algorithmCommits':[run['algorithmCommit'] for run in runs]}
        (a.output/'comparison.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
        percent=lambda x:'未测' if x is None else f'{100*x:.1f}%'
        lines=['# 时间图像归类正式评测',f"候选结论：**{results[1]['verdict']}**。同区域分多组只记录，不单独否决。",'','|指标|基线|候选|','|---|---:|---:|']
        for title,values in [('错合并率',[r['grouping']['crossRegionMergeRate'] for r in results]),('同区域聚合率',[r['grouping']['sameRegionAggregationRate'] for r in results]),('旧组识别率',[r['classification']['old']['accuracy'] for r in results]),('新组建立率',[r['classification']['new']['accuracy'] for r in results]),('未归类率',[r['grouping']['unassignedRate'] for r in results])]:lines.append(f'|{title}|{percent(values[0])}|{percent(values[1])}|')
        lines+=['','失败：'+('、'.join(results[1]['failures']) or '无'),'证据缺口：'+('、'.join(results[1]['blockers']) or '无')]
        (a.output/'report.md').write_text('\n'.join(lines),encoding='utf8')
        print(json.dumps({'verdict':results[1]['verdict'],'failures':results[1]['failures'],'blockers':results[1]['blockers']},ensure_ascii=True))
        return
    result=compare(bench,*runs)
    (a.output/'comparison.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    subprocess.run([sys.executable,str(Path(__file__).with_name('grouping_benchmark.py').resolve()),str(a.benchmark.resolve()),str((a.output/'baseline/run.json').resolve()),str((a.output/'candidate/run.json').resolve()),str((a.output/'review').resolve())],check=True)

if __name__=='__main__':main()
