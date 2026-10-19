"""Post-hoc trajectory overlays of AI labels/predictions; no model/API calls."""
import hashlib
import json
import shutil
from pathlib import Path
from sim.hssd.download_hssd import SCENES


def prediction_source(trial,name):
    report=json.loads((trial/'inference/report.json').read_text(encoding='utf8'))
    manifest=json.loads((trial/'atlases/input-manifest.json').read_text(encoding='utf8'))
    answer=report['answer'];regions=[];labels={}
    for index,row in enumerate(answer['regions'],1):
        rid=f'P{index}';regions.append({'id':rid,'description':row['reason']})
        for gid in row['groupIds']:
            for oid in manifest['groups'][gid]['observationIds']:labels[oid]={'kind':'core','regionIds':[rid],'reason':row['reason'],'unit':gid}
    for row in answer['boundaryGroups']:
        for gid in row['groupIds']:
            for oid in manifest['groups'][gid]['observationIds']:labels[oid]={'kind':'boundary','regionIds':[f'P{i}' for i in row['adjacentRegionIndices']],'reason':row['reason'],'unit':gid}
    for gid in answer['uncertainGroupIds']:
        for oid in manifest['groups'][gid]['observationIds']:labels[oid]={'kind':'unknown','regionIds':[],'reason':answer['uncertaintyReasons'].get(gid,'证据不足'),'unit':gid}
    return {'name':name,'regions':regions,'labels':labels,'annotations':answer['imageAnnotations'],'sourceReport':str(trial/'inference/report.json')}


def main():
    root=Path('run/review-site/label-maps');root.mkdir(parents=True,exist_ok=True)
    trials=Path('run/single-observation-vlm-1791942042733665700');scenes=[]
    for scene in SCENES:
        captures=sorted(p.parent for p in (Path('run/hssd-six-v1')/scene).glob('attempt-*/capture/manifest.json'))
        if not captures:scenes.append({'id':scene,'ready':False,'reason':'两次采集失败，无有效图像，未生成标签地图'});continue
        capture=captures[-1];trace=json.loads((capture/'collector-trace.json').read_text(encoding='utf8'));by_tick={r['denseTick']:r for r in trace}
        windows=[json.loads(s) for s in (capture/'windows.jsonl').read_text().splitlines()]
        reference=json.loads((Path('run/hssd-region-labels-v1')/scene/'labels.json').read_text(encoding='utf8'))
        sources={'reference':{'name':'原AI参考标签（不是标准答案）','regions':reference['regions'],'labels':{r['observationId']:r for r in reference['labels']},'sourceReport':str(Path('run/hssd-region-labels-v1')/scene/'labels.json')}}
        for arm in ['single-observation','time-2']:sources[arm]=prediction_source(trials/('hssd-'+scene)/arm,'逐观察VLM聚合' if arm=='single-observation' else '每2观察分块＋VLM聚合')
        samples=[];images=root/'images'/scene;images.mkdir(parents=True,exist_ok=True)
        for i,w in enumerate(windows):
            oid=f'observation-{i+1}';tick=w['endTick']*12
            if tick not in by_tick:raise ValueError('Missing exact original pose for '+oid)
            pose=by_tick[tick]
            if abs(pose['timestampMs']-w['timestampMs'])>1:raise ValueError('Pose/sample timestamp mismatch')
            original=capture/'triple'/Path(w['frame']).name;target=images/f'{oid}.jpg';digest=hashlib.sha256(original.read_bytes()).hexdigest()
            if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()!=digest:raise ValueError('Existing map image changed')
            if not target.exists():shutil.copy2(original,target)
            samples.append({'id':oid,'seconds':w['timestampMs']/1000,'x':pose['position'][0],'z':pose['position'][2],'image':f'images/{scene}/{oid}.jpg','imageSha256':digest})
        ids={s['id'] for s in samples}
        if any(set(source['labels'])!=ids for source in sources.values()):raise ValueError('Incomplete source observation inventory')
        scenes.append({'id':scene,'ready':True,'samples':samples,'trajectory':[[r['position'][0],r['position'][2]] for r in trace],'sources':sources})
    data={'protocol':'hssd-label-map-posthoc-v1','scenes':scenes,'notice':'坐标仅取模拟器原轨迹用于事后显示，没有用于标签或VLM推理。连线为走过的轨迹，不是墙/门/区域边界；未观察位置不推测区域。参考标签不是标准答案，各预测P编号独立。'}
    (root/'data.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
    (root/'index.html').write_text(Path(__file__).with_name('hssd_label_maps.html').read_text(encoding='utf8'),encoding='utf8')
    print(json.dumps({'url':'http://127.0.0.1:8879/label-maps/','ready':sum(s['ready'] for s in scenes),'observations':sum(len(s.get('samples',[])) for s in scenes),'apiCalls':0}))


if __name__=='__main__':main()
