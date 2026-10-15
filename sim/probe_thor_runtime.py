"""Non-billing alternative-backend probe. Built-in room is NOT a large dataset."""
import argparse
import json
import hashlib
import importlib.metadata
from pathlib import Path


def main():
    from ai2thor.controller import Controller
    from ai2thor.platform import Linux64
    from PIL import Image
    import numpy as np
    p=argparse.ArgumentParser();p.add_argument('output',type=Path);p.add_argument('--scene',default='FloorPlan1');p.add_argument('--executable');a=p.parse_args()
    a.output.mkdir(parents=True,exist_ok=False);controller=None
    try:
        extra={'local_executable_path':a.executable} if a.executable else {}
        controller=Controller(scene=a.scene,width=320,height=320,fieldOfView=90,platform=Linux64,quality='Low',server_timeout=30,**extra)
        meta=controller.last_event.metadata;position=meta['cameraPosition'];yaw=meta['agent']['rotation']['y']
        for offset in [-90,90]:
            event=controller.step(action='AddThirdPartyCamera',position=position,rotation={'x':0,'y':yaw+offset,'z':0},fieldOfView=90)
            if not event.metadata['lastActionSuccess']:raise RuntimeError(event.metadata.get('errorMessage','Camera creation failed'))
        event=controller.last_event
        views={'front':event.frame,'left':event.third_party_camera_frames[0],'right':event.third_party_camera_frames[1]}
        checks={}
        for name,image in views.items():
            path=a.output/(name+'.png');Image.fromarray(image).save(path)
            checks[name]={'shape':list(image.shape),'mean':float(np.mean(image)),'std':float(np.std(image)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
            if np.std(image)<1:raise RuntimeError('Blank camera frame')
        report={'backend':'AI2-THOR Linux64','executable':a.executable,'version':importlib.metadata.version('ai2thor'),'scene':a.scene,'threeCamerasOneWorldState':True,'cameraYawRelativeDegrees':{'front':0,'left':-90,'right':90},'images':checks,'modelCalls':0,'scope':'runtime probe only; not building-scale, not multistory, no dataset accuracy claim'}
        (a.output/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
    except Exception as error:
        (a.output/'failure.json').write_text(json.dumps({'error':str(error)},indent=2));raise
    finally:
        if controller is not None:controller.stop()


if __name__=='__main__':main()
