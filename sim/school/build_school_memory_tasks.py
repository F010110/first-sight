"""90 traceable current/short/cross-episode tasks; evaluation-only ground truth.
Task construction reads source-assisted annotations, never model predictions.
"""
import argparse
import hashlib
import html
import json
from collections import Counter
from pathlib import Path
from sim.school.annotate_school_activity import loadlines
from sim.spatial.salad_features import sha

REGIONS={'exterior':'室外建筑或球场周边','hall':'室内走廊','gym':'室内体育馆','classroom':'有课桌椅的教室','library':'有书架的阅览房间'}
FEATURE_FILE=Path(__file__).with_name('school_activity_task_features_v1.json')
FEATURE_SPEC=json.loads(FEATURE_FILE.read_text(encoding='utf8'))
FLOORS={(trajectory,round(t*1000)):value for name,value in [('woodFloor','木地板'),('patternedTileFloor','拼花瓷砖')] for trajectory,times in FEATURE_SPEC[name].items() for t in times}

def inside(row):return row['regionLabel']!='exterior'

def reference(row):return f"第{int(row['trajectory'][1:])+1}段{row['sourceAtMs']/1000:g}秒"

def fact(row, variant):
    region=row['regionLabel']
    if variant%3==0:
        return '大致是什么场所？',REGIONS[region],'regionKind'
    if variant%3==1:
        return '处在室内还是室外？','室内' if inside(row) else '室外','indoorOutdoor'
    if region in ('gym','hall'):
        material=FLOORS.get((row['trajectory'],row['sourceAtMs']))
        if material:return '地面主要是木地板还是拼花瓷砖？',material,'floorMaterial'
        return '大致是什么场所？',REGIONS[region],'regionKind'
    if region=='library':return '能看到什么典型的图书收纳设施？','书架','visibleLandmark'
    if region=='classroom':return '能看到什么典型的学习用家具？','课桌椅','visibleLandmark'
    return '主要空间是露天还是被室内天花板覆盖？','露天','indoorOutdoor'

def ordered(rows, salt):
    return sorted(rows,key=lambda r:hashlib.sha256((salt+r['observationId']).encode()).hexdigest())

def select_inputs(task, observations, mode):
    """Input selection contract; a runner must also restrict retrieval/inspect."""
    if mode not in ('current-only','recent-5min','full-history'):raise ValueError('Unknown input mode')
    matches=[o for o in observations if o['id']==task['currentObservationId']]
    if len(matches)!=1 or matches[0]['atMs']>=task['queryAtMs']:raise ValueError('Invalid current observation/cutoff')
    current=matches[0]
    if mode=='current-only':return [current]
    return [o for o in observations if o['atMs']<=current['atMs'] and (mode=='full-history' or o['atMs']>=current['atMs']-300000)]

def compile_tasks(rows, observations, episodes):
    lookup={(r['trajectory'],r['sourceAtMs']):r for r in rows};byid={r['observationId']:r for r in rows}
    obs={o['id']:o for o in observations};index={o['id']:i for i,o in enumerate(observations)}
    anchors=[r for r in rows if r['status']=='assistant-visual-anchor' and r['regionLabel'] in REGIONS]
    active_start={};elapsed=0
    for e in episodes:
        active_start[e['id']]=elapsed;elapsed+=e['endMs']-e['startMs']
    active=lambda r:active_start[obs[r['observationId']]['episodeId']]+r['sourceAtMs']
    tasks=[];facts_used=set();labels={}
    def current_for(target,tier):
        choices=[q for q in anchors if q['regionLabel']!=target['regionLabel'] and q['atMs']>target['atMs']]
        if tier=='short':
            choices=[q for q in choices if q['trajectory']==target['trajectory'] and 20000<=q['atMs']-target['atMs']<=300000]
        else:
            choices=[q for q in choices if q['trajectory']!=target['trajectory'] and q['atMs']-target['atMs']>=1200000 and index[q['observationId']]-index[target['observationId']]>=50]
        return min(choices,key=lambda q:q['atMs']) if choices else None
    def add(tier,question,answer,evidence,current,kind,feature,basis,required=True,answerable=True):
        ordinal=sum(t['memoryTier']==tier for t in tasks)
        task_id='memq-'+hashlib.sha256(f'{tier}:{ordinal}:{question}'.encode()).hexdigest()[:20]
        ids=[r['observationId'] for r in evidence];past=[r for r in evidence if r['observationId']!=current['observationId']]
        lag=current['atMs']-min(r['atMs'] for r in evidence) if evidence else None
        active_lag=active(current)-min(active(r) for r in evidence) if evidence else None
        for row in evidence:
            lid='observation:'+row['observationId']
            labels[lid]={'id':lid,'observationId':row['observationId'],'sourceTrajectory':row['trajectory'],'sourceFrameIndex':row['sourceFrameIndex'],'sourceXYZ':row['sourceXYZ'],'sourceAtMs':row['sourceAtMs'],'activityAtMs':row['atMs'],'regionKind':row['regionLabel'],'robotHeightM':row['robotHeightM'],'annotationStatus':row['status'],'labelSources':['native pose/metadata and collection_config','packaging generator clocks/index/ID','assistant-reviewed three-camera anchor'] if row['regionLabel'] else ['native pose/metadata','additional known-case image inspection'],'physicalPlaceId':None,'floorId':None}
        label_ids=['observation:'+r['observationId'] for r in evidence]
        if answerable:
            lid='feature:'+task_id
            labels[lid]={'id':lid,'kind':'task-supporting-fact','feature':feature,'value':answer,'observationIds':ids,'basis':basis,'annotationStatus':'source-derived-relative-geometry' if feature=='differentPhysicalLevel' else 'assistant-reviewed-visible-surface' if feature=='floorMaterial' else 'assistant-reviewed-semantic-derived','featureSpecSha256':sha(FEATURE_FILE) if feature=='floorMaterial' else None,'independentHumanReview':False}
            label_ids.append(lid)
        if not answerable:
            lid='protocol:'+task_id;labels[lid]={'id':lid,'kind':'unanswerability','basis':basis,'source':'recording/generation protocol; requested information not established by observed evidence'};label_ids.append(lid)
        tasks.append({'id':task_id,'question':question,'expectedAnswer':answer,'answerable':answerable,'family':kind,'memoryTier':tier,'memoryRequired':bool(required and answerable and tier!='current'),'queryAtMs':current['atMs']+1,'currentObservationId':current['observationId'],'validEvidenceSets':[ids] if ids else [],'supportLabelIds':label_ids,'testedFeature':feature,'labelBasis':basis,'historicalLagMs':lag,'activeVisualLagMs':active_lag,'interveningObservations':index[current['observationId']]-min(index[r['observationId']] for r in evidence) if evidence else None,'crossEpisode':any(obs[r['observationId']]['episodeId']!=obs[current['observationId']]['episodeId'] for r in evidence),'currentOnlyAnswerability':'no-history control' if tier=='current' else 'refusal-control' if not answerable else 'history required for cited verification; semantic shortcut ablation pending','currentSemanticDistractor':current['regionLabel'],'annotationStatus':'assistant-source-assisted','independentHumanReview':False,'historyMustContainIds':[r['observationId'] for r in past],'evaluationOnlyPose':True})
    # Disjoint target facts across tiers: not 30 facts copied with three delays.
    for tier,count in [('short',22),('long',22),('current',26)]:
        candidates=[r for r in anchors if r['observationId'] not in facts_used and (tier=='current' or current_for(r,tier))]
        candidates=ordered(candidates,tier)
        if len(candidates)<count:raise ValueError('Insufficient distinct reviewed evidence')
        for n,target in enumerate(candidates[:count]):
            current=target if tier=='current' else current_for(target,tier)
            tail,answer,feature=fact(target,n)
            question=('当前画面' if tier=='current' else reference(target)+'那次记录中')+tail
            add(tier,question,answer,[target],current,'recall',feature,'reviewed semantic anchor; native source pose/frame/clock binding',tier!='current')
            facts_used.add(target['observationId'])
    # Contrast questions need both moments, with chronology/level supplied by
    # source clocks/geometry rather than by recognition summaries.
    pairs={'short':[('P0000',0,'P0000',140),('P0006',20,'P0006',80),('P0009',0,'P0009',60),('P0007',26,'P0007',80)],'long':[('P0000',0,'P0003',160),('P0000',177.5,'P0008',0),('P0001',0,'P0006',80),('P0002',20,'P0009',60)]}
    for tier,pair_rows in pairs.items():
        for trajectory,a,other,b in pair_rows:
            left,right=lookup[trajectory,round(a*1000)],lookup[other,round(b*1000)]
            if (trajectory,a,b)==('P0007',26,80):
                if abs(left['sourceXYZ'][2]-right['sourceXYZ'][2])<3:raise ValueError('Different-level constraint unsupported')
                question=f'{reference(left)}与当前这次记录是否位于同一物理层？';answer='不是同一物理层';feature='differentPhysicalLevel';basis='same native trajectory Z separation exceeds 5m in actual source, plus observed stair traversal; not absolute floor numbering'
            else:
                if left['regionLabel'] not in REGIONS or right['regionLabel'] not in REGIONS:raise ValueError('Unreviewed comparison')
                question=f'{reference(left)}与当前这次记录，各自在室内还是室外？'
                answer=('前一次室内' if inside(left) else '前一次室外')+'；'+('当前室内' if inside(right) else '当前室外');feature='historicalIndoorOutdoorComparison';basis='two reviewed semantic anchors plus native order/episode clocks; no transit asserted between episodes'
            add(tier,question,answer,[left,right],right,'compare',feature,basis)
    refusals={
      'current':['当前这所学校的WiFi密码是什么？','当前画面这栋建筑的精确街道地址是什么？','当前画面能确定学校此刻在现实世界正常营业吗？','只凭当前画面，能确定画面外有没有人在移动书架吗？'],
      'short':['刚才没有拍到的相邻房间里，现在有几个人？','刚才没有显示的抽屉里，放着什么东西？','刚才镜头外有没有人移动过桌椅？','仅凭刚才这些模拟画面，能确定这所学校真实负责人姓名吗？'],
      'long':['第一段到第二段之间关机20分钟，我具体走过了哪条路？','第六段结束到第七段开始前，有人移动过书架吗？','整个日程关机期间，我有没有进入未记录的建筑？','这些旧录像能证明这所学校今天仍然开放吗？']}
    for tier,questions in refusals.items():
        current=anchors[0] if tier=='current' else next(r for r in anchors if r['trajectory']=='P0000' and r['sourceAtMs']>=140000) if tier=='short' else anchors[-1]
        for question in questions:add(tier,question,'记录未提供充分证据，无法确定',[],current,'unknown','unobservedInformation','No evidence for off-camera states/private credentials/real-world identity or current status; gaps explicitly unobserved',False,False)
    for t in tasks:
        if t['memoryTier']=='short' and t['memoryRequired'] and (t['crossEpisode'] or not 20000<=t['historicalLagMs']<=300000):raise ValueError('Bad short-memory horizon')
        if t['memoryTier']=='long' and t['memoryRequired'] and (not t['crossEpisode'] or t['historicalLagMs']<1200000 or t['interveningObservations']<50):raise ValueError('Bad long-memory horizon')
        if t['memoryRequired'] and t['currentObservationId'] in t['historyMustContainIds']:raise ValueError('Current-only evidence masquerades as memory')
        if any(byid[c]['atMs']>=t['queryAtMs'] for group in t['validEvidenceSets'] for c in group):raise ValueError('Future evidence')
    return sorted(tasks,key=lambda t:('current','short','long').index(t['memoryTier'])),labels

def trajectory_map(rows):
    xs=[r['sourceXYZ'][0] for r in rows];ys=[r['sourceXYZ'][1] for r in rows]
    project=lambda r:(30+700*(r['sourceXYZ'][0]-min(xs))/(max(xs)-min(xs) or 1),30+500*(r['sourceXYZ'][1]-min(ys))/(max(ys)-min(ys) or 1))
    parts=['<svg xmlns="http://www.w3.org/2000/svg" width="760" height="610" viewBox="0 0 760 610"><rect width="760" height="610" fill="white"/><text x="20" y="570">Native XY trajectory projection, NOT a room/floor map.</text><text x="20" y="595">Overlapping XY may be different physical levels. Gaps are not connected.</text>']
    palette=['#144','#a22','#228','#a60','#548','#292','#a37','#777','#09a','#660']
    for trajectory in sorted({r['trajectory'] for r in rows}):
        subset=[r for r in rows if r['trajectory']==trajectory];color=palette[int(trajectory[1:])%len(palette)]
        parts.append('<polyline fill="none" stroke="'+color+'" opacity=".45" points="'+' '.join(f'{x:.1f},{y:.1f}' for x,y in map(project,subset))+'"/>')
        for r in subset:
            if r['regionLabel']:
                x,y=project(r);parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="{color}"><title>{html.escape(reference(r)+": "+r["regionLabel"])}</title></circle>')
    return ''.join(parts)+'</svg>'

def build(sample, annotations, output):
    rows=loadlines(annotations/'annotations.jsonl');observations=loadlines(sample/'observations.jsonl');episodes=json.loads((sample/'evaluation-only'/'episodes.json').read_text())
    audit=json.loads((annotations/'audit.json').read_text())
    if audit['observationsSha256']!=sha(sample/'observations.jsonl'):raise ValueError('Annotation/input binding mismatch')
    tasks,labels=compile_tasks(rows,observations,episodes);output.mkdir(parents=True,exist_ok=False)
    private=output/'evaluation-only';private.mkdir()
    (private/'tasks.json').write_text(json.dumps(tasks,ensure_ascii=False,indent=2),encoding='utf8')
    (private/'support-labels.json').write_text(json.dumps(list(labels.values()),ensure_ascii=False,indent=2),encoding='utf8')
    (private/'trajectory-map.svg').write_text(trajectory_map(rows),encoding='utf8')
    access=[]
    for task in tasks:
        available={mode:{o['id'] for o in select_inputs(task,observations,mode)} for mode in ('current-only','recent-5min','full-history')}
        supported=lambda mode:any(set(group)<=available[mode] for group in task['validEvidenceSets'])
        if task['answerable'] and not supported('full-history'):raise ValueError('Gold evidence unavailable at query cutoff')
        if task['memoryRequired'] and supported('current-only'):raise ValueError('Historical task supported by current-only input')
        if task['memoryTier']=='long' and task['memoryRequired'] and supported('recent-5min'):raise ValueError('Long evidence accessible to recent-only condition')
        access.append({'taskId':task['id'],'referenceEvidenceAvailable':{mode:supported(mode) for mode in available},'semanticShortcutAblationRun':False})
    (private/'access-audit.json').write_text(json.dumps(access,indent=2))
    (output/'execution-protocol.json').write_text(json.dumps({'version':'memory-horizons-v1','modes':['current-only','recent-5min','full-history'],'cutoff':'Only observations at or before currentObservationId time; no future frames or future-derived summaries','restriction':'Apply mode restrictions to persistent retrieval/inspect and caches as well as prompt images. Full-history permits retrieval, not an unbounded all-images prompt.','memoryInterpretation':'Short: 20s-5min same episode; long: >=20min synthetic schedule, cross episode and >=50 intervening observations.','grading':'All three modes answer identical questions with identical answer/evidence rubric; missing historical evidence cannot be replaced with a correct guess.','status':'Input/evidence access audited locally; actual model ablations not executed'},indent=2))
    public=[{k:t[k] for k in ('id','question','queryAtMs','currentObservationId')} for t in tasks]
    (output/'model-questions.json').write_text(json.dumps(public,ensure_ascii=False,indent=2),encoding='utf8')
    info={'version':'school-memory-horizons-v1','tasks':len(tasks),'byTier':dict(Counter(t['memoryTier'] for t in tasks)),'historyRequiredForCitedVerification':dict(Counter(t['memoryTier'] for t in tasks if t['memoryRequired'])),'refusalControls':dict(Counter(t['memoryTier'] for t in tasks if not t['answerable'])),'distinctFactualAnchors':len({t['validEvidenceSets'][0][0] for t in tasks if t['family']=='recall'}),'supportLabels':len(labels),'annotationAuditSha256':sha(annotations/'audit.json'),'builderSha256':sha(Path(__file__)),'tasksSha256':sha(private/'tasks.json'),'modelCalls':0,'scoreEligible':False,'limits':['Assistant source-assisted labels, no independent human review.','Long means >=20min synthetic schedule, cross episode, >=50 intervening observations; report active visual lag separately. Not day-scale memory.','History required for valid original citations, not proof that semantic answers cannot be guessed from current imagery; current-only ablation remains mandatory.','Native trajectory projection is not an official mesh/room map. No local official semantic map/object state truth.','Static taxonomy/visible-surface labels derive from reviewed anchors; no invented object movement or exact room boundary annotations.']}
    info['featureKinds']=dict(Counter(t['testedFeature'] for t in tasks))
    info['memoryHorizons']={tier:{'scheduleLagSeconds':[min(t['historicalLagMs'] for t in tasks if t['memoryTier']==tier and t['memoryRequired'])/1000,max(t['historicalLagMs'] for t in tasks if t['memoryTier']==tier and t['memoryRequired'])/1000],'activeVisualLagSeconds':[min(t['activeVisualLagMs'] for t in tasks if t['memoryTier']==tier and t['memoryRequired'])/1000,max(t['activeVisualLagMs'] for t in tasks if t['memoryTier']==tier and t['memoryRequired'])/1000]} for tier in ('short','long')}
    (output/'manifest.json').write_text(json.dumps(info,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(info,ensure_ascii=True));return tasks,labels

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('sample',type=Path);p.add_argument('annotations',type=Path);p.add_argument('output',type=Path);a=p.parse_args();build(a.sample,a.annotations,a.output)
