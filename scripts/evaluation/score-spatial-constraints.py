#!/usr/bin/env python3
"""Constraint-based evaluation of a spatial-memory run.

The reference is a human-accepted place annotation, not a unique grouping.
This scorer therefore does not compare place IDs directly. It checks:

1. place association pairs (same place must keep one ID, different places
   must stay separate; boundary-uncertain observations are excluded);
2. major place boundaries (coarse place-group changes, +/- one window);
3. online availability at committed checkpoints;
4. key facts present in the committed state (diagnostic weight only).

Coarse groups are the explicitly allowed coarse grainings for this route:
same station / same shop / same building / outdoor street area. Different
coarse groups are treated as different places. See COARSE below.
"""
import argparse, collections, hashlib, itertools, json, sys
from pathlib import Path

COARSE = {
 'subway-platform':'subway','subway-concourse':'subway','subway-exit':'subway',
 'hardware-front':'hardware','hardware-interior':'hardware',
 'union-street':'street','park-corner':'street','fire-corner':'street','fire-entrance':'street',
 'south-street':'street','theatre-crossing':'street','stone-entrance':'street','deli-front':'street',
 'service-alley':'street','alley-stairs':'street','laundromat-alley':'street',
 'pawn-front':'pawn','pawn-interior':'pawn',
 'diner-front':'diner','diner-interior':'diner',
 'brick-shop-interior':'brick-shop','brick-shop-backroom':'brick-shop',
 'bar-porch':'bar','bar-interior':'bar',
 'gas-street':'gas','gas-forecourt':'gas',
 'laundromat-front':'laundromat','laundromat-interior':'laundromat','laundromat-backroom':'laundromat',
 'residential-lobby':'apartment','elevator-lobby':'apartment','apartment-elevator-cab':'apartment',
 'upper-vestibule':'apartment','upper-room':'apartment','rooftop':'apartment',
}
# Critical facts are intentionally few and product-relevant. Auxiliary facts are reported but not scored.
FACTS = [
 ('stairs', ['楼梯','台阶','阶梯'], ['subway-platform','subway-concourse','subway-exit'], True),
 ('ticket gate', ['闸机','检票','闸口'], ['subway-concourse'], True),
 ('hardware front', ['五金','HARDWARE','I&W'], ['hardware-front'], True),
 ('hardware shelves', ['货架','柜台'], ['hardware-interior'], True),
 ('union sign', ['Union','INTELLIE','路牌'], ['union-street'], True),
 ('pawn front', ['当铺','Pawn'], ['pawn-front'], True),
 ('pawn counter', ['柜台','当铺'], ['pawn-interior'], True),
 ('diner front', ['Choke','餐厅'], ['diner-front'], True),
 ('diner floor', ['黑白','格','地砖'], ['diner-interior'], True),
 ('brick shop shelves', ['砖墙','货架'], ['brick-shop-interior'], True),
 ('brick backroom sink', ['水槽','洗手池','后间'], ['brick-shop-backroom'], True),
 ('laundromat backroom sink', ['洗手池','水槽','储藏'], ['laundromat-backroom'], True),
 ('fire entrance', ['消防','红门','消防站'], ['fire-corner','fire-entrance'], True),
 ('bar porch', ['木','外廊','台球'], ['bar-porch'], True),
 ('bar interior', ['台球','酒吧'], ['bar-interior'], True),
 ('gas forecourt', ['加油','USA GAS','加油站'], ['gas-forecourt'], True),
 ('laundromat washers', ['洗衣机','洗衣'], ['laundromat-interior'], True),
 ('stone entrance', ['古典','石','拱门'], ['stone-entrance'], True),
 ('elevator', ['电梯'], ['elevator-lobby','apartment-elevator-cab'], True),
 ('rooftop', ['屋顶','露台'], ['rooftop'], True),
 ('park corner', ['公园','长椅','街角'], ['park-corner'], False),
 ('south street', ['南街','车道','马路','道路'], ['south-street'], False),
 ('theatre crossing', ['剧院','洗衣'], ['theatre-crossing'], False),
 ('deli front', ['熟食','deli','招牌'], ['deli-front'], False),
 ('upper room', ['房间','走廊'], ['upper-vestibule','upper-room'], False),
 ('graffiti alley', ['涂鸦','小巷'], ['laundromat-alley'], False),
]
WEIGHTS = {'association':0.45,'sequence':0.25,'online':0.20,'facts':0.10}

def sha(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1<<20),b''):h.update(chunk)
    return h.hexdigest()
def rate(n,d):return round(100.0*n/d,1) if d else None

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--bundle',required=True)
    ap.add_argument('--reference',required=True)
    ap.add_argument('--out',required=True)
    ap.add_argument('--session',help='optional Pi session JSONL; records revisit-candidate availability')
    a=ap.parse_args()
    bundle_path=Path(a.bundle);ref_path=Path(a.reference)
    b=json.loads(bundle_path.read_text(encoding='utf-8'))
    s=json.loads(ref_path.read_text(encoding='utf-8'))
    obs=[o['id'] for o in b['observations']];idx={x:i for i,x in enumerate(obs)}
    ref={r['id']:r['annotation'] for r in b['reference']}
    states={x['version']:x for x in b['states']}

    agent={}
    for v,st in states.items():
        loc=st['assessment']['location']
        for o in st['memberIds']:
            agent[o]={'placeId':loc.get('placeId'),'name':loc.get('name'),'status':loc.get('status'),'version':v}
    skipped=[o for o in obs if o not in agent]
    session={}
    if a.session:
        for line in open(a.session,encoding='utf-8'):
            try:events=json.loads(line)
            except:continue
            for ev in events if isinstance(events,list) else [events]:
                if ev.get('type')!='message':continue
                msg=ev.get('message',{})
                if msg.get('role')!='user':continue
                for part in msg.get('content',[]):
                    text=part.get('text','') if isinstance(part,dict) else ''
                    if '"revisit"' not in text:continue
                    try:d=json.loads(text)
                    except:continue
                    w=d.get('window') or {};r=d.get('revisit') or {}
                    session[w.get('startMs')]={'status':r.get('status'),'candidates':r.get('candidates') or []}
    def matcher_ok(o):
        if not a.session:return None
        v=agent.get(o,{}).get('version')
        if v is None:return False
        start=states[v].get('window',{}).get('startMs')
        return session.get(start,{}).get('status')=='ok'

    def coarse_of(o):
        x=ref.get(o);return COARSE.get(x['placeId']) if x else None
    def name_coarse(name):
        if not name:return None
        if '涂鸦' in name or '小巷' in name or '后巷' in name:return 'street'
        if 'USA GAS' in name or '加油' in name or '隧道' in name:return 'gas'
        if '台球' in name or '外廊' in name:return 'bar'
        if '砖墙' in name:return 'brick-shop'
        if '洗衣' in name:return 'laundromat'
        if '当铺' in name or 'Pawn' in name:return 'pawn'
        if '五金' in name or 'HARDWARE' in name:return 'hardware'
        if 'Choke' in name or '餐厅' in name:return 'diner'
        if '电梯' in name or '走廊' in name or '房间' in name or '公寓' in name or '屋顶' in name or '露台' in name:return 'apartment'
        if '地铁' in name or '站台' in name or '站内' in name or '闸机' in name:return 'subway'
        if any(k in name for k in ['Union','街','路口','人行道','车道','消防','公园','剧院','熟食','古典','楼梯']):return 'street'
        return None
    def runs_by(keyfun):
        out=[];prev=object()
        for o in obs:
            k=keyfun(o)
            if k!=prev:out.append([k,[o]]);prev=k
            else:out[-1][1].append(o)
        return out
    place_runs=runs_by(lambda o:ref[o]['placeId'] if o in ref else None)
    coarse_runs=runs_by(coarse_of)
    def clear(o):
        x=ref.get(o);return x and x['visibility']=='clear' and not x['boundaryUncertain']
    def center(ids):
        c=[o for o in ids if clear(o)]
        if not c:return None
        m=idx[ids[len(ids)//2]]
        return min(c,key=lambda o:abs(idx[o]-m))
    def same_id(x,y):
        p,q=agent.get(x),agent.get(y)
        if not p or not q or not p['placeId'] or not q['placeId']:return None
        return p['placeId']==q['placeId']

    # ---- association: revisits ----
    by_place=collections.defaultdict(list)
    for p,ids in place_runs:by_place[p].append(ids)
    revisits=[]
    for p,rs in by_place.items():
        if len(rs)<2:continue
        reps=[center(r) for r in rs];reps=[r for r in reps if r]
        for x,y in itertools.combinations(reps,2):
            revisits.append({'place':p,'a':x,'b':y,'sameId':same_id(x,y),
                             'aName':agent.get(x,{}).get('name'),'bName':agent.get(y,{}).get('name'),
                             'matcherAvailable':(matcher_ok(x) and matcher_ok(y)) if a.session else None})
    scored_revisits=[x for x in revisits if x['sameId'] is not None]
    same_recall=rate(sum(1 for x in scored_revisits if x['sameId']),len(scored_revisits))
    tested_revisits=[x for x in scored_revisits if x.get('matcherAvailable') is True]
    same_recall_tested=rate(sum(1 for x in tested_revisits if x['sameId']),len(tested_revisits)) if tested_revisits else None

    # ---- association: continuity inside a reference visit ----
    continuity=[]
    for p,ids in place_runs:
        c=[o for o in ids if clear(o)]
        if len(c)>=2:continuity.append({'place':p,'a':c[0],'b':c[-1],'sameId':same_id(c[0],c[-1])})
    scored_cont=[x for x in continuity if x['sameId'] is not None]
    continuity_score=rate(sum(1 for x in scored_cont if x['sameId']),len(scored_cont))

    # ---- association: different places (all coarse-run centres) ----
    centers=[(g,center(ids)) for g,ids in coarse_runs]
    centers=[(g,o) for g,o in centers if o]
    different=[];allowed=[]
    for i in range(len(centers)):
        for j in range(i+1,len(centers)):
            gi,oi=centers[i];gj,oj=centers[j]
            item={'ga':gi,'gb':gj,'a':oi,'b':oj,'sameId':same_id(oi,oj),
                  'aName':agent.get(oi,{}).get('name'),'bName':agent.get(oj,{}).get('name')}
            (allowed if gi==gj else different).append(item)
    scored_diff=[x for x in different if x['sameId'] is not None]
    diff_spec=rate(sum(1 for x in scored_diff if x['sameId'] is False),len(scored_diff))
    false_merges=[x for x in scored_diff if x['sameId'] is True]
    association=round(same_recall*0.30+diff_spec*0.50+continuity_score*0.20,1)
    association_tested=round((diff_spec*0.50+continuity_score*0.20)/0.70,1) if same_recall_tested is None else round(same_recall_tested*0.30+diff_spec*0.50+continuity_score*0.20,1)

    # ---- sequence: major coarse-group boundaries, +/- one window ----
    ref_bounds=[{'at':idx[coarse_runs[i][1][0]],'old':coarse_runs[i-1][0],'new':coarse_runs[i][0]} for i in range(1,len(coarse_runs))]
    agent_changes=[];prev=None
    for v in sorted(states):
        st=states[v];g=name_coarse(st['assessment']['location'].get('name'))
        if g is None:continue
        at=idx[st['memberIds'][0]]
        if prev is not None and g!=prev:agent_changes.append({'at':at,'new':g,'version':v})
        prev=g
    used=set();matches=[]
    for r in ref_bounds:
        best=None
        for k,change in enumerate(agent_changes):
            if k in used:continue
            if abs(change['at']-r['at'])<=8 and change['new']==r['new']:
                if best is None or abs(change['at']-r['at'])<abs(agent_changes[best]['at']-r['at']):best=k
        if best is not None:
            used.add(best);matches.append({'ref':r,'agent':agent_changes[best],'lagSec':(agent_changes[best]['at']-r['at'])*2})
    tp=len(matches);fp=len(agent_changes)-len(used);fn=len(ref_bounds)-tp
    precision=rate(tp,tp+fp);recall=rate(tp,tp+fn)
    sequence=round(2*precision*recall/(precision+recall),1) if precision and recall else 0.0
    delays=sorted(m['lagSec'] for m in matches)

    # ---- online checkpoints: coarse group of the committed window claim ----
    online=[]
    for v in range(5,96,5):
        st=states[v];dist=collections.Counter(coarse_of(o) for o in st['memberIds'])
        refg=dist.most_common(1)[0][0]
        agentg=name_coarse(st['assessment']['location'].get('name'))
        if agentg is None:continue
        online.append({'version':v,'reference':refg,'agent':agentg,'correct':refg==agentg})
    online_score=rate(sum(1 for x in online if x['correct']),len(online))

    # ---- facts: text presence in committed state/window facts ----
    facts_text=collections.defaultdict(list)
    for st in states.values():
        f=st.get('facts') or {}
        text=' '.join([str(f.get('summary',''))]+[str(x) for x in (f.get('details') or [])]).strip()
        if text:facts_text[st['observationId']].append(text)
        for o in st.get('window',{}).get('observations',[]):
            of=o.get('facts') or {}
            t=' '.join([str(of.get('summary',''))]+[str(x) for x in (of.get('details') or [])]).strip()
            if t:facts_text[o['id']].append(t)
    fact_rows=[]
    for name,terms,places,critical in FACTS:
        hit=None
        for o in obs:
            if o not in ref or ref[o]['placeId'] not in places:continue
            text=' '.join(facts_text.get(o,[]))
            if text and any(t in text for t in terms):hit=o;break
        fact_rows.append({'name':name,'critical':critical,'recalled':bool(hit),'source':hit})
    crit=[x for x in fact_rows if x['critical']]
    facts_score=rate(sum(1 for x in crit if x['recalled']),len(crit))

    overall=round(association*WEIGHTS['association']+sequence*WEIGHTS['sequence']+online_score*WEIGHTS['online']+facts_score*WEIGHTS['facts'],1)
    overall_tested=round(association_tested*WEIGHTS['association']+sequence*WEIGHTS['sequence']+online_score*WEIGHTS['online']+facts_score*WEIGHTS['facts'],1)
    matcher_windows=len(session)
    matcher_unavailable=sum(1 for v in session.values() if v.get('status')!='ok') if session else None
    boundary_uncertain=sum(1 for o in obs if ref.get(o,{}).get('boundaryUncertain'))
    scorecard={
      'schema':'spatial-constraint-scorecard-v1',
      'run':b.get('run'),
      'inputs':{'bundle':str(bundle_path.resolve()),'bundleSHA256':sha(bundle_path),'reference':str(ref_path.resolve()),'referenceSHA256':sha(ref_path),'databaseSHA256':b.get('hashes',{}).get('database')},
      'coverage':{'plannedObservations':len(obs),'judgedObservations':len(agent),'skippedObservations':len(skipped),'judgedWindows':len(states),'skippedWindows':b.get('scope',{}).get('coverage',{}).get('skippedWindows'),'placeRuns':len(place_runs),'coarseRuns':len(coarse_runs),'boundaryUncertainObservations':boundary_uncertain},
      'weights':WEIGHTS,
      'dimensions':{
        'association':{'score':association,'samePlaceRecall':same_recall,'revisitPairs':len(scored_revisits),'revisitHits':sum(1 for x in scored_revisits if x['sameId']),'samePlaceRecallTested':same_recall_tested,'testedRevisitPairs':len(tested_revisits),'untestedRevisitPairs':len(scored_revisits)-len(tested_revisits),'matcherUnavailableWindows':matcher_unavailable,'matcherWindows':matcher_windows,'differentPlaceSpecificity':diff_spec,'differentPairs':len(scored_diff),'falseMerges':len(false_merges),'continuity':continuity_score,'continuityPairs':len(scored_cont),'continuityHits':sum(1 for x in scored_cont if x['sameId'])},
        'sequence':{'score':sequence,'majorBoundaries':len(ref_bounds),'agentChanges':len(agent_changes),'truePositives':tp,'falsePositives':fp,'falseNegatives':fn,'precision':precision,'recall':recall,'delaysSec':delays},
        'online':{'score':online_score,'checkpoints':len(online),'correct':sum(1 for x in online if x['correct']),'misses':[x for x in online if not x['correct']]},
        'facts':{'score':facts_score,'criticalFacts':len(crit),'criticalRecalled':sum(1 for x in crit if x['recalled']),'diagnosticOnly':True},
      },
      'overall':overall,
      'overallTested':overall_tested,
      'revisitValidity':{'testedPairs':len(tested_revisits),'untestedPairs':len(scored_revisits)-len(tested_revisits),'matcherUnavailableWindows':matcher_unavailable,'matcherWindows':matcher_windows,'note':'Untested revisit pairs had no available revisit candidate (matcher timeout); they are not evidence that the agent cannot reuse a place.'},
      'findings':{
        'revisits':revisits,
        'falseMerges':false_merges,
        'allowedCoarsePairs':len(allowed),
        'missedBoundaries':[r for r in ref_bounds if not any(m['ref']==r for m in matches)],
        'falseBoundaries':[c for k,c in enumerate(agent_changes) if k not in used],
        'onlineMisses':[x for x in online if not x['correct']],
        'facts':fact_rows,
      },
      'caveats':[
        'Reference is user-accepted, not independently verified gold; uniqueGroundTruth=false and reasonable merge/split is allowed.',
        'Boundary-uncertain observations are excluded from definite association pairs; the reference transition labels are descriptive, not per-frame truth.',
        'Revisit pairs are untested when the SIFT/RANSAC matcher was unavailable; the as-run score counts them as failures, the tested-dimension score excludes the invalid revisit dimension.',
        'Facts are text presence in committed state/window facts, not question-agent retrieval; fact dimension is diagnostic and weighted 10%.',
        'Skipped observations are coverage gaps, not failures; the score is constraint-based, not navigation-safety or product acceptance.',
      ],
    }
    out=Path(a.out);out.mkdir(parents=True,exist_ok=False)
    (out/'scorecard.json').write_text(json.dumps(scorecard,ensure_ascii=False,indent=2),encoding='utf-8')
    lines=[
      '# 空间记忆约束评测（constraint v1）','',
      f"- 运行：`{scorecard['run']}`",
      f"- 覆盖：{len(agent)}/{len(obs)} 观察，{len(states)} 判断窗 + {b.get('scope',{}).get('coverage',{}).get('skippedWindows')} 跳过窗；{len(place_runs)} 个参考地点段 / {len(coarse_runs)} 个粗粒度区域段",
      f"- 参考：`{scorecard['inputs']['reference']}`（{scorecard['inputs']['referenceSHA256'][:16]}…）",
      '',
      f"## 总分：**{overall} / 100**（系统 as-run；测试维度 {overall_tested}）",'',
      f"- 回访 matcher 超时 {matcher_unavailable if matcher_unavailable is not None else '未提供 session'}/{matcher_windows if matcher_windows else '—'} 窗；9 个回访对中已测 {len(tested_revisits)} 个。未测回访不是 Agent 复用能力的证据。",'',
      '| 维度 | 权重 | 得分 | 说明 |','|---|---:|---:|---|',
      f"| 地点关联 | 45% | {association} | 同地点回访 {same_recall}%（{sum(1 for x in scored_revisits if x['sameId'])}/{len(scored_revisits)}，已测 {len(tested_revisits)}）、不同地点特异度 {diff_spec}%（{len(scored_diff)-len(false_merges)}/{len(scored_diff)}）、段内连续 {continuity_score}%（{sum(1 for x in scored_cont if x['sameId'])}/{len(scored_cont)}） |",
      f"| 地点序列 | 25% | {sequence} | 重大区域边界 F1 {sequence}（TP {tp}/FP {fp}/FN {fn}），±1 窗匹配 |",
      f"| 在线可用 | 20% | {online_score} | {sum(1 for x in online if x['correct'])}/{len(online)} 个检查点粗粒度区域正确 |",
      f"| 关键事实 | 10% | {facts_score} | 关键事实 {sum(1 for x in crit if x['recalled'])}/{len(crit)} 出现在已提交状态（诊断项） |",
      '',
      '## 错误清单','',
      '### 重访未复用同一地点 ID','',
      *[f"- `{x['place']}`：{x['a'][-3:]}（{x['aName']}）↔ {x['b'][-3:]}（{x['bName']}）" for x in revisits if x['sameId'] is False],
      '',
      '### 不同地点被合并','',
      *[f"- `{x['ga']}` ↔ `{x['gb']}`：{x['a'][-3:]} / {x['b'][-3:]}（{x['aName']} / {x['bName']}）" for x in false_merges],
      '',
      '### 漏掉的重大边界','',
      *[f"- {r['old']} → {r['new']}（观察 {r['at']}）" for r in ref_bounds if not any(m['ref']==r for m in matches)],
      '',
      '### 在线检查点错误','',
      *[f"- 窗 v{x['version']}：参考 `{x['reference']}`，Agent `{x['agent']}`" for x in online if not x['correct']],
      '',
      '## 说明','',
      *[f'- {c}' for c in scorecard['caveats']],
      '',
    ]
    (out/'scorecard.md').write_text('\n'.join(lines),encoding='utf-8')
    print(json.dumps({'overall':overall,'overallTested':overall_tested,'association':association,'sequence':sequence,'online':online_score,'facts':facts_score,'revisits':len(scored_revisits),'falseMerges':len(false_merges),'out':str(out)},ensure_ascii=False))
if __name__=='__main__':main()
