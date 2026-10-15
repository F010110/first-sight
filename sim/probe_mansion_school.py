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
        if report['success']:
            from PIL import Image
            Image.fromarray(event.frame).save(a.output/'front.png')
            reachable=c.step(action='GetReachablePositions');report['reachableSuccess']=reachable.metadata['lastActionSuccess'];report['reachableCount']=len(reachable.metadata.get('actionReturn') or [])
    except Exception as error:report['exception']=str(error)
    finally:
        (a.output/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
        if c:c.stop()


if __name__=='__main__':main()
