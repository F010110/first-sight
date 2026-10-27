"""Render actual intermediate HM3D images + noisy IMU on a fixed GT route.

No VLM calls, object detector, synthetic feature tracks or GT filter initialization.
Smoke sequence only; poses from the completed GT pilot select the physical route.
"""
import argparse
import csv
import json
import math
import os
from pathlib import Path
import re
import sys
import numpy as np
from scipy.spatial.transform import Rotation

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'runs/3dmem-minival-runtime-v1'))
os.environ.setdefault('HABITAT_SIM_LOG','quiet')
os.environ.setdefault('MAGNUM_LOG','quiet')
from src.habitat import make_simple_cfg
import habitat_sim
import quaternion
import cv2
from imu_memory_noise import PROFILES, G

A = np.array([[1.,0.,0.],[0.,0.,-1.],[0.,1.,0.]])
C = np.diag([1.,-1.,-1.])  # OpenCV camera/IMU -> OpenGL camera


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--out',type=Path,default=ROOT/'runs/hm3d-image-vio-v2-smoke')
    parser.add_argument('--observations',type=int,default=13)
    args=parser.parse_args()
    out=args.out.resolve()
    out.mkdir(exist_ok=False)
    (out/'images').mkdir()
    manifest=json.loads((ROOT/'reports/minival26-baseline-v1-manifest.json').read_text())
    qid=manifest['questions'][0]
    q=json.loads((ROOT/'runs/minival26-baseline-v1'/qid/'question.json').read_text())[0]
    route=[json.loads(x) for x in (ROOT/'runs/imu-memory-v1-pilot'/qid/'gt/trace/poses.jsonl').read_text().splitlines()][:args.observations]
    scene=q['episode_history']
    mesh=ROOT/'data/hm3d-minival-glb-v0.2'/scene/(scene.split('-')[1]+'.glb')
    settings=dict(scene=str(mesh),default_agent=0,sensor_height=0.,width=640,height=640,
                  hfov=120.,scene_dataset_config_file='default',camera_tilt=0.)
    sim=habitat_sim.Simulator(make_simple_cfg(settings))
    if not sim.pathfinder.load_nav_mesh(str(ROOT/'runs/hm3d-minival-validation-v2-wxyz'/(scene+'.navmesh'))):
        raise RuntimeError('Failed loading navmesh')
    agent=sim.initialize_agent(0)
    cameras_file=(out/'cameras.csv').open('w',newline='')
    cameras=csv.writer(cameras_file); cameras.writerow(['t','image0'])
    truth_file=(out/'truth-evaluation-only.csv').open('w',newline='')
    truth=csv.writer(truth_file); truth.writerow(['t','px','py','pz','qx','qy','qz','qw'])
    profiles=dict(low_reference=dict(gyro_asd_dps=.0005,accel_asd_ug=25.,gyro_bias_dps=.0001,accel_bias_mg=.01),
                  bmi_like=PROFILES['bmi_like'],mpu_like=PROFILES['mpu_like'])
    sensors={}
    for name,spec in profiles.items():
        folder=out/name; folder.mkdir()
        f=(folder/'imu.csv').open('w',newline='')
        writer=csv.writer(f); writer.writerow(['t','wx','wy','wz','ax','ay','az'])
        rng=np.random.default_rng(0)
        bg=rng.normal(size=3)*np.deg2rad(spec['gyro_bias_dps'])
        ba=rng.normal(size=3)*spec['accel_bias_mg']*.001*G
        sensors[name]=dict(file=f,writer=writer,rng=rng,bg=bg,ba=ba,dg=np.zeros(3),da=np.zeros(3))
        config=(ROOT/'runs/openvins-on-render-v1/estimator_config.yaml').read_text()
        config=re.sub(r'^sim_.*\n','',config,flags=re.M)
        config=re.sub(r'^gravity_mag:.*$',f'gravity_mag: {G}',config,flags=re.M)
        (folder/'estimator_config.yaml').write_text(config)
        fx=320/math.tan(math.radians(60))
        (folder/'kalibr_imucam_chain.yaml').write_text('''%YAML:1.0
cam0:
  T_imu_cam:
    - [1.0, 0.0, 0.0, 0.0]
    - [0.0, 1.0, 0.0, 0.0]
    - [0.0, 0.0, 1.0, 0.0]
    - [0.0, 0.0, 0.0, 1.0]
  cam_overlaps: []
  camera_model: pinhole
  distortion_coeffs: [0.0, 0.0, 0.0, 0.0]
  distortion_model: radtan
  intrinsics: ['''+f'{fx}, {fx}, 320.0, 320.0'+''']
  resolution: [640, 640]
  rostopic: /cam0/image_raw
''')
        ng=np.deg2rad(spec['gyro_asd_dps'])/np.sqrt(2)
        na=spec['accel_asd_ug']*1e-6*G/np.sqrt(2)
        (folder/'kalibr_imu_chain.yaml').write_text(f'''%YAML:1.0
imu0:
  T_i_b:
    - [1.0, 0.0, 0.0, 0.0]
    - [0.0, 1.0, 0.0, 0.0]
    - [0.0, 0.0, 1.0, 0.0]
    - [0.0, 0.0, 0.0, 1.0]
  accelerometer_noise_density: {na}
  accelerometer_random_walk: {spec['accel_bias_mg']*.001*G/3*np.sqrt(2/100)}
  gyroscope_noise_density: {ng}
  gyroscope_random_walk: {np.deg2rad(spec['gyro_bias_dps'])/3*np.sqrt(2/100)}
  rostopic: /imu0
  time_offset: 0.0
  update_rate: 200.0
  model: calibrated
  Tw:
    - [1.0, 0.0, 0.0]
    - [0.0, 1.0, 0.0]
    - [0.0, 0.0, 1.0]
  R_IMUtoGYRO:
    - [1.0, 0.0, 0.0]
    - [0.0, 1.0, 0.0]
    - [0.0, 0.0, 1.0]
  Ta:
    - [1.0, 0.0, 0.0]
    - [0.0, 1.0, 0.0]
    - [0.0, 0.0, 1.0]
  R_IMUtoACC:
    - [1.0, 0.0, 0.0]
    - [0.0, 1.0, 0.0]
    - [0.0, 0.0, 1.0]
  Tg:
    - [0.0, 0.0, 0.0]
    - [0.0, 0.0, 0.0]
    - [0.0, 0.0, 0.0]
''')
    tick=0; image_count=0
    start=np.array(route[0]['gtCameraPose'])
    endpoints=[]
    def segment(p0,p1,r0,r1,hold=None):
        nonlocal tick,image_count
        dp=p1-p0; rv=Rotation.from_matrix(r0.T@r1).as_rotvec()
        duration=hold if hold is not None else max(.2,1.875*np.linalg.norm(dp)/.5,
            np.sqrt(5.774*np.linalg.norm(dp)),1.875*np.linalg.norm(rv)/np.deg2rad(90),
            np.sqrt(5.774*np.linalg.norm(rv)/np.deg2rad(180)))
        # Exact 200Hz samples and 20Hz camera phases; quintic starts/stops at rest.
        n=max(10,int(np.ceil(duration*20))*10); duration=n/200
        for k in range(n):
            u=k/n; s=10*u**3-15*u**4+6*u**5
            sd=(30*u**2-60*u**3+30*u**4)/duration
            sdd=(60*u-180*u**2+120*u**3)/duration**2
            r=r0@Rotation.from_rotvec(rv*s).as_matrix(); p=p0+dp*s
            rw=A@r@C
            w=C.T@(rv*sd)
            f=rw.T@(A@(dp*sdd)-np.array([0.,0.,-G]))
            t=tick/200
            for name,spec in profiles.items():
                sen=sensors[name]; rng=sen['rng']; decay=np.exp(-.005/100)
                sen['dg']=decay*sen['dg']+np.deg2rad(spec['gyro_bias_dps'])/3*np.sqrt(1-decay**2)*rng.normal(size=3)
                sen['da']=decay*sen['da']+spec['accel_bias_mg']*.001*G/3*np.sqrt(1-decay**2)*rng.normal(size=3)
                wm=w+sen['bg']+sen['dg']+np.deg2rad(spec['gyro_asd_dps'])/np.sqrt(.01)*rng.normal(size=3)
                am=f+sen['ba']+sen['da']+spec['accel_asd_ug']*1e-6*G/np.sqrt(.01)*rng.normal(size=3)
                sen['writer'].writerow([t,*wm,*am])
            if tick%10==0:
                state=habitat_sim.AgentState(); state.position=p
                state.rotation=quaternion.from_rotation_matrix(r)
                agent.set_state(state)
                rgb=sim.get_sensor_observations()['color_sensor'][:,:,:3]
                image_path=f'images/{image_count:06d}.png'
                if not cv2.imwrite(str(out/image_path),cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)):
                    raise RuntimeError('Image write failed')
                cameras.writerow([t,image_path]); truth.writerow([t,*(A@p),*Rotation.from_matrix(rw).as_quat()])
                image_count+=1
            tick+=1
    segment(start[:3,3],start[:3,3],start[:3,:3],start[:3,:3],hold=3.)
    last=start
    for obs in route[1:]:
        pose=np.array(obs['gtCameraPose'])
        segment(last[:3,3],last[:3,3],last[:3,:3],pose[:3,:3])
        if np.linalg.norm(pose[:3,3]-last[:3,3])>1e-6:
            offset=np.array([0.,1.5,0.])
            path=habitat_sim.ShortestPath(); path.requested_start=last[:3,3]-offset
            path.requested_end=pose[:3,3]-offset
            if not sim.pathfinder.find_path(path):
                raise RuntimeError('Route path missing; refusing through-wall interpolation')
            points=[last[:3,3]]+[np.array(p)+offset for p in path.points]+[pose[:3,3]]
            for a,b in zip(points[:-1],points[1:]):
                if np.linalg.norm(b-a)>1e-6: segment(a,b,pose[:3,:3],pose[:3,:3])
        endpoints.append(dict(sourceFrame=obs['frame'],time=tick/200))
        last=pose
    segment(last[:3,3],last[:3,3],last[:3,:3],last[:3,:3],hold=.1)
    cameras_file.close(); truth_file.close()
    for sensor in sensors.values(): sensor['file'].close()
    sim.close()
    (out/'meta.json').write_text(json.dumps(dict(questionId=qid,scene=scene,cameraHz=20,imuHz=200,
        images=image_count,durationSeconds=tick/200,profiles=profiles,sourceObservations=len(route),
        endpoints=endpoints,worldHabitatToEstimator=A.tolist(),opencvToOpenGL=C.tolist(),
        cameraEqualsIMU=True,gravity=G,syntheticFeatures=False,gtInitialization=False,
        note='Smoke route only; intermediate images genuinely rendered, noise settings not device replicas.'),indent=2))
    print('Generated',image_count,'images;',tick,'IMU samples/profile;',out,flush=True)


if __name__=='__main__':
    main()
