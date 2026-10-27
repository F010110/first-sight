"""Run three image-based VIO conditions without API calls or GT initialization."""
import csv
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import numpy as np
from scipy.spatial.transform import Rotation

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'runs/hm3d-image-vio-v2-smoke'
MAMBA=ROOT.parent/'run/habitat-runtime/bin/micromamba'
REPORT=ROOT/'reports/image-vio-v2-smoke-results.json'


def read(path):
    with path.open() as f:
        return list(csv.DictReader(f))


def analyze(path):
    rows=read(path)
    gt=read(DATA/'truth-evaluation-only.csv')
    truth={round(float(r['t']),8):r for r in gt}
    valid=[r for r in rows if r['initialized']=='1' and
           abs(float(r['state_t'])-float(r['camera_t']))<1e-6]
    result=dict(cameraFrames=len(rows),initializedRows=sum(r['initialized']=='1' for r in rows),
                validCameraUpdates=len(valid),staleStateRows=sum(r['initialized']=='1' for r in rows)-len(valid))
    if not valid:
        return result
    p=np.array([[float(r[k]) for k in ('px','py','pz')] for r in valid])
    rot=Rotation.from_quat([[float(r['q_GtoI_'+k]) for k in ('x','y','z','w')] for r in valid]).as_matrix()
    targets=[truth[round(float(r['camera_t']),8)] for r in valid]
    pg=np.array([[float(r[k]) for k in ('px','py','pz')] for r in targets])
    rg=Rotation.from_quat([[float(r[k]) for k in ('qx','qy','qz','qw')] for r in targets]).as_matrix()
    # Gauge alignment: first valid state, yaw + translation ONLY. No scale fit,
    # no whole-trajectory fitting, no roll/pitch alignment, no feedback to VIO.
    m=rg[0]@rot[0].T
    yaw=np.arctan2(m[1,0]-m[0,1],m[0,0]+m[1,1])
    align=Rotation.from_euler('z',yaw).as_matrix()
    pp=(align@(p-p[0]).T).T+pg[0]
    rr=align@rot
    errors=np.linalg.norm(pp-pg,axis=1)
    angles=np.rad2deg(Rotation.from_matrix(np.transpose(rg,(0,2,1))@rr).magnitude())
    result.update(firstValidTime=float(valid[0]['camera_t']),lastValidTime=float(valid[-1]['camera_t']),
        alignment='First valid state yaw + translation; no scale or future fit, evaluation only',
        positionRmseM=float(np.sqrt(np.mean(errors**2))),maxPositionErrorM=float(max(errors)),
        finalPositionErrorM=float(errors[-1]),rotationRmseDeg=float(np.sqrt(np.mean(angles**2))),
        maxRotationErrorDeg=float(max(angles)),finalRotationErrorDeg=float(angles[-1]),
        maxImuLookaheadSeconds=max(float(r['imu_watermark_t'])-float(r['camera_t']) for r in valid),
        errors=[dict(time=float(r['camera_t']),positionM=float(e),rotationDeg=float(a)) for r,e,a in zip(valid,errors,angles)])
    return result


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--static-initialization',action='store_true')
    args=parser.parse_args()
    variant='static-init-v2' if args.static_initialization else 'v1'
    report=ROOT/'reports'/('image-vio-v2-smoke-'+variant+'-results.json') if args.static_initialization else REPORT
    assert (DATA/'meta.json').exists(),'Sequence generation not complete'
    result=dict(scope='Actual grayscale image + noisy IMU monocular OpenVINS smoke, no GT initialization, not downstream EQA',
        sequence=json.loads((DATA/'meta.json').read_text()),variant=variant,conditions=[])
    for name in ('low_reference','bmi_like','mpu_like'):
        folder=DATA/name; poses=folder/('poses-'+variant+'.csv'); status=folder/('execution-'+variant+'.json')
        config=folder/'estimator_config.yaml'
        if args.static_initialization:
            config=folder/'estimator-static-init-v2.yaml'
            text=(folder/'estimator_config.yaml').read_text()
            text=text.replace('try_zupt: false','try_zupt: true').replace('zupt_only_at_beginning: false','zupt_only_at_beginning: true')
            if not config.exists():
                config.write_text(text)
            else:
                assert config.read_text()==text,'Refusing changed frozen config'
        if poses.exists() and not status.exists():
            # Initial low-reference run was launched directly; do not silently rerun.
            run=dict(status='existing_output',note='Direct initial invocation; original console log not captured to file')
        elif status.exists():
            run=json.loads(status.read_text())
        else:
            print('START',name,flush=True)
            with (folder/('image-replay-'+variant+'.log')).open('w') as log:
                try:
                    p=subprocess.run([str(MAMBA),'run','-p',str(ROOT/'envs/openvins'),
                        str(ROOT/'runs/openvins-build/research_image_replay'),str(config),
                        str(folder/'imu.csv'),str(DATA/'cameras.csv'),str(poses)],
                        stdout=log,stderr=subprocess.STDOUT,timeout=600)
                    run=dict(exitCode=p.returncode,status='completed' if p.returncode==0 else 'failed')
                except subprocess.TimeoutExpired:
                    run=dict(status='timeout')
        run['configSha256']=hashlib.sha256(config.read_bytes()).hexdigest()
        status.write_text(json.dumps(run,indent=2))
        stats=analyze(poses) if poses.exists() else {}
        if stats.get('cameraFrames') != result['sequence']['images']:
            run['completeSequence']=False
            run['noteIncomplete']='Partial output; not a completed condition and not silently resumed'
        else:
            run['completeSequence']=True
        status.write_text(json.dumps(run,indent=2))
        result['conditions'].append(dict(profile=name,execution=run,metrics=stats))
        report.write_text(json.dumps(result,indent=2))
        print(name,{k:v for k,v in stats.items() if k!='errors'},flush=True)


if __name__=='__main__':
    main()
