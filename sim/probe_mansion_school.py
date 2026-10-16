"""Attempt unmodified school loading; retain errors instead of deleting missing assets."""
import argparse
import json
from pathlib import Path


def main():
    from ai2thor.controller import Controller
    p=argparse.ArgumentParser();p.add_argument('scene',type=Path);p.add_argument('executable');p.add_argument('output',type=Path);a=p.parse_args()
    a.output.mkdir(parents=True,exist_ok=False);c=None
    report={'scene':str(a.scene),'modelCalls':0,'success':False}
    try:
        c=Controller(local_executable_path=a.executable,scene='Procedural',width=320,height=320,quality='Low',server_timeout=40)
        house=json.loads(a.scene.read_text());event=c.step(action='CreateHouse',house=house)
        report.update(success=event.metadata['lastActionSuccess'],error=event.metadata.get('errorMessage'))
        expected={o['id'] for o in house.get('objects',[])}
        actual={o['objectId'] for o in event.metadata.get('objects',[])}
        report.update(sourceTopLevelObjects=len(expected),runtimeObjects=len(actual),missingSourceObjectIds=sorted(expected-actual),visualCompletenessVerified=False)
        report['sourceAssetCounts']={asset:sum(o.get('assetId')==asset for o in house.get('objects',[])) for asset in {o.get('assetId') for o in house.get('objects',[])}}
        report['runtimeAssetCounts']={asset:sum(o.get('assetId')==asset for o in event.metadata.get('objects',[])) for asset in {o.get('assetId','') for o in event.metadata.get('objects',[])}}
        report['sourceAssetsAbsentFromMetadata']=sorted(set(report['sourceAssetCounts'])-set(report['runtimeAssetCounts']))
        report['doorOpenAttempts']=[]
        for obj in event.metadata.get('objects',[]):
            if obj.get('openable') and 'door' in str(obj.get('assetId','')).lower():
                opened=c.step(action='OpenObject',objectId=obj['objectId'],openness=1,forceAction=True)
                report['doorOpenAttempts'].append({'id':obj['objectId'],'success':opened.metadata['lastActionSuccess'],'error':opened.metadata.get('errorMessage')})
        if report['success']:
            from PIL import Image
            Image.fromarray(event.frame).save(a.output/'front.png')
            reachable=c.step(action='GetReachablePositions');report['reachableSuccess']=reachable.metadata['lastActionSuccess'];report['reachableCount']=len(reachable.metadata.get('actionReturn') or [])
            report['reachableError']=reachable.metadata.get('errorMessage')
            points=reachable.metadata.get('actionReturn') or []
            (a.output/'reachable.json').write_text(json.dumps(points))
            if points:report['reachableBounds']={axis:[min(v[axis] for v in points),max(v[axis] for v in points)] for axis in ['x','y','z']}
            def inside(point,polygon):
                x,z=point['x'],point['z'];result=False
                for u,v in zip(polygon,polygon[1:]+polygon[:1]):
                    if (u['z']>z)!=(v['z']>z) and x<(v['x']-u['x'])*(z-u['z'])/(v['z']-u['z'])+u['x']:result=not result
                return result
            report['roomReachableCounts']={r['id']:sum(inside(pt,r['floorPolygon']) for pt in points) for r in house['rooms']}
            report['pointsOutsideRoomPolygons']=sum(not any(inside(pt,r['floorPolygon']) for r in house['rooms']) for pt in points)
            report['note']='Reachability is after force-opening metadata door objects; this is an evaluator accessibility probe, not Agent navigation success. Missing source asset IDs require asset-loading investigation.'
    except Exception as error:report['exception']=str(error)
    finally:
        (a.output/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k not in ['missingSourceObjectIds','sourceAssetCounts','runtimeAssetCounts','sourceAssetsAbsentFromMetadata','doorOpenAttempts']},indent=2))
        if c:c.stop()


if __name__=='__main__':main()
