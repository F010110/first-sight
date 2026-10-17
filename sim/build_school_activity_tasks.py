"""Freeze source-bound user questions and narrow identity consequence probes.
No cloud calls. Existing databases are not read when constructing this bank.
"""
import argparse
import json
from pathlib import Path
from annotate_school_activity import loadlines
from salad_features import sha

# Facts are tied to the reviewed camera triplets, never inferred from place summaries.
FACTS=[
 ('P0000',0,'第一段开始时，身旁建筑外墙主要是什么材质？','红砖','exterior'),
 ('P0000',140,'第一段140秒时所在室内通道，地面是木地板还是拼花瓷砖？','拼花瓷砖','hall'),
 ('P0000',177.5,'第一段最后看到的室内球场主要是什么地板？','木地板','gym'),
 ('P0001',0,'第二段开始时，球场边能看到什么供观众坐的设施？','阶梯看台','gym'),
 ('P0003',180,'第四段180秒时，室内场地能否看到篮球架？','能看到篮球架','gym'),
 ('P0004',40,'第五段40秒时，围栏边可见的长条座椅是什么颜色？','橙色或橙黄色','exterior'),
 ('P0005',260,'第六段260秒时，室内是否可见装书的书架？','可见书架和书','library'),
 ('P0006',20,'第七段20秒时，场地地面上有没有球场线？','有球场线','gym'),
 ('P0007',0,'第八段开始时，球场边有没有阶梯看台？','有阶梯看台','gym'),
 ('P0007',60,'第八段60秒看到的房间，墙面下部主要是什么颜色？','蓝色或深蓝色','classroom'),
 ('P0008',0,'第九段开始时，房间内可见的是课桌椅还是球场看台？','课桌椅','classroom'),
 ('P0009',60,'第十段60秒时，房间内有哪些典型阅览设施？','书架和桌椅','library'),
]
PROBES=[
 ('P0000',0,140,False,'室外建筑旁与室内瓷砖通道不是同一具体地点'),
 ('P0000',0,177.5,False,'室外与室内木地板体育馆不同'),
 ('P0000',140,177.5,False,'瓷砖通道与木地板体育馆不同'),
 ('P0007',0,20,True,'同一体育馆内不同朝向和位置'),
 ('P0007',20,40,True,'同一体育馆内不同位置；不要求同一机位'),
 ('P0007',0,40,True,'同一体育馆实例'),
 ('P0007',0,60,False,'体育馆与蓝墙教室不同'),
 ('P0007',20,80,False,'体育馆与上层走廊不同'),
 ('P0007',26,80,False,'同源路线相差约5米的两个物理层，不可因墙面相似合并'),
 ('P0007',0,86.6,False,'体育馆与有书架的房间不同'),
 ('P0009',0,60,False,'室外球场与室内书架房间不同'),
 ('P0009',20,60,False,'室外围栏旁与室内书架房间不同'),
 ('P0009',60,80,False,'书架房间与上层走廊不同'),
]

def build(sample, annotations, output):
    rows=loadlines(annotations/'annotations.jsonl');lookup={(r['trajectory'],r['sourceAtMs']):r for r in rows}
    audit=json.loads((annotations/'audit.json').read_text());manifest=json.loads((sample/'complete.json').read_text())
    if audit['observationsSha256']!=sha(sample/'observations.jsonl'):raise ValueError('Annotations bound to different observations')
    output.mkdir(parents=True,exist_ok=False);tasks=[];public=[]
    for i,(trajectory,seconds,question,answer,region) in enumerate(FACTS):
        row=lookup[trajectory,round(seconds*1000)]
        if row['regionLabel']!=region or row['status']!='assistant-visual-anchor':raise ValueError('Fact lacks reviewed anchor')
        task={'id':f'fact-{i:02d}','sampleId':manifest['sampleId'],'family':'recall','question':question,'queryAtMs':row['atMs']+1,'answerable':True,'expectedAnswer':answer,'validEvidenceSets':[[row['observationId']]],'challenges':[],'annotationStatus':'assistant-source-assisted','reviewedCameraViews':['left','front','right'],'sourceAtMs':row['sourceAtMs'],'trajectory':trajectory}
        tasks.append(task);public.append({k:task[k] for k in ('id','question','queryAtMs')})
    # Lack of camera evidence is intentional: do not use the simulator's world state.
    for i,(question,answer) in enumerate([
        ('这所学校的WiFi密码是什么？','没有密码证据，无法确定'),
        ('第一段与第二段之间关机的20分钟里，我具体走过了哪条路？','空档未记录，无法确定具体路线'),
        ('第六段结束后到第七段开始前，有人移动过书架吗？','关机空档无观察，不能确定对象是否移动'),
        ('根据这些录像，学校现在是否仍然开放营业？','历史模拟画面不足以确认现实当前开放状态'),
    ]):
        task={'id':f'unknown-{i:02d}','sampleId':manifest['sampleId'],'family':'unknown','question':question,'queryAtMs':json.loads((sample/'evaluation-only'/'episodes.json').read_text())[-1]['endMs']+1,'answerable':False,'expectedAnswer':answer,'validEvidenceSets':[],'challenges':[],'annotationStatus':'assistant-source-assisted','unanswerabilityBasis':'protocol/source audit: no observed evidence for requested fact'}
        tasks.append(task);public.append({k:task[k] for k in ('id','question','queryAtMs')})
    probes=[]
    for i,(trajectory,a,b,same,basis) in enumerate(PROBES):
        left,right=lookup[trajectory,round(a*1000)],lookup[trajectory,round(b*1000)]
        probes.append({'id':f'identity-{i:02d}','trajectory':trajectory,'a':left['observationId'],'b':right['observationId'],'aSourceFrame':left['sourceFrameIndex'],'bSourceFrame':right['sourceFrameIndex'],'aSourceAtMs':left['sourceAtMs'],'bSourceAtMs':right['sourceAtMs'],'same':same,'question':f'第{int(trajectory[1:])+1}段的{a:g}秒与{b:g}秒，是否为同一具体房间或地点？','basis':basis,'sourceDeltaZAbsM':abs(left['sourceXYZ'][2]-right['sourceXYZ'][2]),'annotationStatus':'assistant-source-assisted','frozenBeforeScoringThisProbeBank':True,'historicalDevelopmentData':True})
    (output/'private-tasks.json').write_text(json.dumps(tasks,ensure_ascii=False,indent=2),encoding='utf8')
    (output/'model-questions.json').write_text(json.dumps(public,ensure_ascii=False,indent=2),encoding='utf8')
    (output/'identity-probes.json').write_text(json.dumps(probes,ensure_ascii=False,indent=2),encoding='utf8')
    info={'annotationAuditSha256':sha(annotations/'audit.json'),'questions':len(tasks),'identityProbes':len(probes),'independentReview':False,'scoreEligible':False,'unmeasured':['last_seen','complete-route-sequence','observed-object-change'],'note':'16 real-source questions, not executed QA predictions. Identity probes are an offline database readout diagnostic, not retrieval/QA accuracy. P0000/P0007/P0009 have historical tuning exposure; not held-out results.'}
    (output/'manifest.json').write_text(json.dumps(info,indent=2));print(json.dumps(info));return tasks,probes

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('sample',type=Path);p.add_argument('annotations',type=Path);p.add_argument('output',type=Path);a=p.parse_args();build(a.sample,a.annotations,a.output)
