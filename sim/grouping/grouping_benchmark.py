"""Frozen paired evaluation. No algorithm code, no inferred ground truth."""
import argparse,hashlib,json
from pathlib import Path

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()

def validate(bench,run):
    if bench['protocol']!='grouping-benchmark-v1' or run['protocol']!='grouping-run-v1':raise ValueError('Wrong protocol')
    if run['benchmarkHash']!=digest(bench):raise ValueError('Benchmark/labels/policy mismatch')
    if run['mode']!='online' or not run['algorithmCommit'] or not run['evidenceBudget']:raise ValueError('Require versioned online algorithm and evidence budget')
    expected=[o['id'] for o in bench['observations']]
    if len(set(expected))!=len(expected):raise ValueError('Duplicate observations')
    if [s['observationId'] for s in run['snapshots']]!=expected:raise ValueError('Missing/reordered prefixes')
    for i,s in enumerate(run['snapshots']):
        if set(s['assignments'])!=set(expected[:i+1]) or s['atMs']!=bench['observations'][i]['atMs']:raise ValueError('Future/missing observations or different timing')
        if any(v is not None and (not isinstance(v,str) or not v) for v in s['assignments'].values()):raise ValueError('Invalid grouping output')
    pair_ids=set();relations={}
    for p in bench['pairs']:
        key=tuple(sorted([p['a'],p['b']]))
        if p['id'] in pair_ids or key in relations or p['a']==p['b'] or any(x not in expected for x in key) or p['relation'] not in ['same','different']:raise ValueError('Duplicate/invalid pair truth')
        pair_ids.add(p['id']);relations[key]=p['relation']
    roots={id:id for id in expected}
    def root(id):
        while roots[id]!=id:id=roots[id]
        return id
    for p in bench['pairs']:
        if p['relation']=='same':roots[root(p['a'])]=root(p['b'])
    if any(p['relation']=='different' and root(p['a'])==root(p['b']) for p in bench['pairs']):raise ValueError('Contradictory transitive truth')
    queries={q['id']:q for q in bench['queries']}
    if len(queries)!=len(bench['queries']) or set(run['retrieval'])!=set(queries):raise ValueError('Missing/duplicate queries')
    for q in queries.values():
        if q['query'] not in expected or not q['relevant'] or not set(q['relevant'])<=set(q['candidates']) or len(set(q['candidates']))!=len(q['candidates']):raise ValueError('Invalid query truth')
        if any(x not in expected or expected.index(x)>=expected.index(q['query']) for x in q['candidates']):raise ValueError('Self/future query candidate')
        returned=run['retrieval'][q['id']]
        if len(set(returned))!=len(returned) or not set(returned)<=set(q['candidates']):raise ValueError('Invalid retrieval output')

def relation(assignments,a,b):
    x,y=assignments[a],assignments[b]
    return 'unknown' if x is None or y is None else 'same' if x==y else 'different'

def evaluate(bench,run):
    validate(bench,run)
    final=run['snapshots'][-1]['assignments'];errors=[];counts={r:{'total':0,'correct':0,'unknown':0} for r in ['same','different']}
    repairs=regressions=comparisons=flips=retractions=0
    for p in bench['pairs']:
        actual=relation(final,p['a'],p['b']);c=counts[p['relation']];c['total']+=1;c['correct']+=actual==p['relation'];c['unknown']+=actual=='unknown'
        if actual!=p['relation']:errors.append({'kind':'grouping','case':p['id'],'expected':p['relation'],'actual':actual,'frames':p['frames']})
        previous=None
        for snapshot in run['snapshots']:
            if p['a'] not in snapshot['assignments'] or p['b'] not in snapshot['assignments']:continue
            current=relation(snapshot['assignments'],p['a'],p['b'])
            if previous not in [None,'unknown'] and current=='unknown':retractions+=1
            if previous not in [None,'unknown'] and current!='unknown':
                comparisons+=1
                if previous!=current:
                    flips+=1
                    if current==p['relation']:repairs+=1
                    else:regressions+=1;errors.append({'kind':'regression','case':p['id'],'atMs':snapshot['atMs'],'frames':p['frames']})
            previous=current
    rates={r:counts[r]['correct']/counts[r]['total'] if counts[r]['total'] else None for r in counts}
    success=wrong=unknown=0
    for q in bench['queries']:
        returned=run['retrieval'][q['id']]
        ok=bool(returned) and set(returned)<=set(q['relevant'])
        success+=ok;unknown+=not returned;wrong+=bool(set(returned)-set(q['relevant']))
        if not ok:errors.append({'kind':'retrieval','case':q['id'],'returned':returned,'expected':q['relevant'],'frames':q['frames']})
    n=len(bench['queries']);coverage=sum(v is not None for v in final.values())/len(final)
    metrics={'stability':{'persistence':1-flips/comparisons if comparisons else None,'repairs':repairs,'harmfulChanges':regressions,'retractions':retractions,'comparisons':comparisons},'grouping':{'sameRecovery':rates['same'],'differentSeparation':rates['different'],'balancedScore':sum(rates.values())/2 if all(v is not None for v in rates.values()) else None,'observationCoverage':coverage,'counts':counts},'contentRecognition':{'successRate':success/n if n else None,'correct':success,'wrong':wrong,'unknown':unknown,'total':n}}
    policy=bench['policy'];failures=[]
    for label,actual,minimum in [('同组恢复',rates['same'],policy['minSame']),('异组分离',rates['different'],policy['minDifferent']),('内容识别',metrics['contentRecognition']['successRate'],policy['minRecognition']),('归属覆盖',coverage,policy['minCoverage'])]:
        if actual is not None and actual<minimum:failures.append(label)
    if regressions>policy['maxHarmfulChanges']:failures.append('错误改绑')
    if wrong>policy.get('maxWrongRecognition',0):failures.append('错误内容识别')
    if retractions>policy.get('maxRetractions',0):failures.append('已确定关系撤回')
    falseMerges=counts['different']['total']-counts['different']['correct']-counts['different']['unknown']
    if falseMerges>policy.get('maxFalseMerges',0):failures.append('明确异区域误合并')
    blockers=[]
    if not bench['review']['independent']:blockers.append('缺独立复核')
    if not bench['review']['heldOut']:blockers.append('不是冻结留出验收集')
    if not policy['approved']:blockers.append('验收阈值未批准')
    if min(c['total'] for c in counts.values())<policy['minPairsPerClass'] or n<policy['minQueries']:blockers.append('事件样本不足')
    if comparisons==0:blockers.append('无可评估稳定性决定')
    return {'algorithmCommit':run['algorithmCommit'],'metrics':metrics,'verdict':'证据不足' if blockers else '不通过' if failures else '通过','observedFailures':failures,'blockers':blockers,'errors':errors}

def compare(bench,a,b):
    if a['evidenceBudget']!=b['evidenceBudget']:raise ValueError('Different evidence budgets: comparison forbidden')
    x,y=evaluate(bench,a),evaluate(bench,b)
    def flatten(r):
        m=r['metrics'];return [m['grouping']['sameRecovery'],m['grouping']['differentSeparation'],m['contentRecognition']['successRate'],m['grouping']['observationCoverage']]
    old,new=flatten(x),flatten(y)
    deltas=[n-o if n is not None and o is not None else None for o,n in zip(old,new)]
    worse=any(d is not None and d<0 for d in deltas) or y['metrics']['stability']['harmfulChanges']>x['metrics']['stability']['harmfulChanges'] or y['metrics']['stability']['retractions']>x['metrics']['stability']['retractions'] or y['metrics']['contentRecognition']['wrong']>x['metrics']['contentRecognition']['wrong']
    better=any(d is not None and d>0 for d in deltas)
    return {'protocol':'grouping-comparison-v1','benchmarkHash':digest(bench),'baseline':x,'candidate':y,'comparison':'不可作为验收结论' if x['blockers'] or y['blockers'] else '存在退化' if worse else '改善' if better else '持平','diagnosticComparison':'存在退化' if worse else '改善' if better else '持平','deltas':dict(zip(['sameRecovery','differentSeparation','contentRecognition','coverage'],deltas))}

def main():
    import sys
    if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8')
    p=argparse.ArgumentParser();p.add_argument('benchmark',type=Path);p.add_argument('baseline',type=Path);p.add_argument('candidate',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    read=lambda path:json.loads(path.read_text(encoding='utf8'))
    result=compare(read(a.benchmark),read(a.baseline),read(a.candidate));a.output.mkdir(exist_ok=False,parents=True)
    (a.output/'report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    lines=['# 分组算法验收',f"结论：**{result['candidate']['verdict']}**；版本比较：**{result['comparison']}**。",'','|能力|旧版|新版|','|---|---:|---:|']
    percent=lambda x:'未测' if x is None else f'{100*x:.1f}%'
    for label,key in [('同组恢复','sameRecovery'),('异组分离','differentSeparation')]:lines.append(f"|分组正确性：{label}|{percent(result['baseline']['metrics']['grouping'][key])}|{percent(result['candidate']['metrics']['grouping'][key])}|")
    for name,r in [('旧版',result['baseline']),('新版',result['candidate'])]:lines += ['',f"{name}：稳定性错误改绑{r['metrics']['stability']['harmfulChanges']}次；内容识别{percent(r['metrics']['contentRecognition']['successRate'])}；归属覆盖{percent(r['metrics']['grouping']['observationCoverage'])}。",'观察到的未达标项：'+('、'.join(r['observedFailures']) or '无'),'验收阻塞：'+('、'.join(r['blockers']) or '无')]
    (a.output/'report.md').write_text('\n'.join(lines),encoding='utf8');print('\n'.join(lines))

if __name__=='__main__':main()
