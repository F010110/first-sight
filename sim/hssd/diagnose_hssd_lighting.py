"""Separate same-pose lighting A/B. Does NOT change canonical images/results."""
import argparse
import json
import math
from pathlib import Path


def main():
    import habitat_sim
    import magnum as mn
    import numpy as np
    import cv2
    from PIL import Image
    from habitat_sim.utils.common import quat_from_angle_axis
    parser = argparse.ArgumentParser(); parser.add_argument('capture',type=Path); parser.add_argument('output',type=Path)
    args = parser.parse_args(); args.output.mkdir(parents=True,exist_ok=False)
    manifest = json.loads((args.capture/'manifest.json').read_text()); trace = json.loads((args.capture/'collector-trace.json').read_text())
    windows = [json.loads(line) for line in (args.capture/'windows.jsonl').read_text().splitlines()][:2]
    stats = []
    for mode in ['original-default','explicit-default-light']:
        config = habitat_sim.SimulatorConfiguration()
        config.scene_id = manifest['sceneId']; config.scene_dataset_config_file = str(Path('run/hssd-data/hssd-hab.scene_dataset_config.json').resolve())
        config.gpu_device_id = -1; config.enable_physics = False
        if mode == 'explicit-default-light':
            config.scene_light_setup = 'default'; config.override_scene_light_defaults = True
        agent = habitat_sim.agent.AgentConfiguration(); sensors = []
        for name,yaw in [('left',math.pi/2),('front',0),('right',-math.pi/2)]:
            sensor = habitat_sim.CameraSensorSpec(); sensor.uuid = name; sensor.sensor_type = habitat_sim.SensorType.COLOR
            sensor.resolution = [320,320]; sensor.position = mn.Vector3(0,1.5,0); sensor.orientation = mn.Vector3(0,yaw,0); sensor.hfov = mn.Deg(90); sensors.append(sensor)
        agent.sensor_specifications = sensors
        sim = habitat_sim.Simulator(habitat_sim.Configuration(config,[agent]))
        try:
            for number,window in enumerate(windows):
                dense_tick = window['endTick']*12
                yaw = sum(3 if row.get('action')=='turn_left' else -3 if row.get('action')=='turn_right' else 0 for row in trace[:dense_tick])
                state = habitat_sim.AgentState(); state.position = np.array(trace[dense_tick]['position']); state.rotation = quat_from_angle_axis(math.radians(yaw),np.array([0,1,0]))
                sim.get_agent(0).set_state(state)
                obs = sim.get_sensor_observations(); panels = [obs[v][...,:3] for v in ['left','front','right']]
                raw = np.concatenate(panels,axis=1); gray = cv2.cvtColor(raw,cv2.COLOR_RGB2GRAY)
                original = cv2.cvtColor(cv2.imread(str(args.capture/'triple'/window['frame'])),cv2.COLOR_BGR2RGB)
                kp = [len(cv2.SIFT_create(nfeatures=2500).detect(cv2.cvtColor(p,cv2.COLOR_RGB2GRAY),None)) for p in panels]
                gap = np.full((320,24,3),24,dtype=np.uint8)
                Image.fromarray(np.concatenate([panels[0],gap,panels[1],gap,panels[2]],axis=1)).save(args.output/f'{mode}-{number}.png')
                stats.append({'mode':mode,'observationId':f'observation-{number+1}','meanGray':float(gray.mean()),'keypointsPerPanel':kp,'meanAbsoluteDifferenceFromOriginalJpeg':float(np.mean(np.abs(raw.astype(float)-original.astype(float))))})
        finally:
            sim.close()
    report = {'protocol':'hssd-same-pose-lighting-diagnostic-v1','stats':stats,'poseSource':'Original collector position + reconstruction of recorded 3-degree turn actions; first two original observations. No new navigation or model inference.', 'limitations':'Standard Habitat default lights, not a validated HSSD reference lighting setup. This diagnoses integration lighting, NOT region accuracy. Canonical captures and predictions untouched.'}
    (args.output/'report.json').write_text(json.dumps(report,indent=2)); print(json.dumps(report,indent=2))


if __name__ == '__main__':
    main()
