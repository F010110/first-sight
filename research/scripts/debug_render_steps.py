"""Step-by-step ReplicaCAD render debug with flushed progress prints."""
import math
import os

os.environ.setdefault('HABITAT_SIM_LOG', 'quiet')
import habitat_sim
import magnum as mn
import numpy as np

DATASET = 'research/data/replicacad-static/static.scene_dataset_config.json'
backend = habitat_sim.SimulatorConfiguration()
backend.scene_id = 'apt_1_static'
backend.scene_dataset_config_file = DATASET
backend.enable_physics = False
backend.gpu_device_id = -1
agent_cfg = habitat_sim.agent.AgentConfiguration()
sensors = []
for uuid, kind in (('rgb', habitat_sim.SensorType.COLOR), ('depth', habitat_sim.SensorType.DEPTH)):
    spec = habitat_sim.CameraSensorSpec()
    spec.uuid = uuid
    spec.sensor_type = kind
    spec.resolution = [480, 640]
    spec.position = mn.Vector3(0., 1.5, 0.)
    spec.orientation = mn.Vector3(-15 * math.pi / 180, 0., 0.)
    spec.hfov = 90
    sensors.append(spec)
agent_cfg.sensor_specifications = sensors
print('creating', flush=True)
sim = habitat_sim.Simulator(habitat_sim.Configuration(backend, [agent_cfg]))
print('navmesh', sim.pathfinder.is_loaded, sim.pathfinder.navigable_area, flush=True)
sim.pathfinder.seed(11)
pts = []
for _ in range(2000):
    p = np.array(sim.pathfinder.get_random_navigable_point())
    if np.all(np.isfinite(p)):
        pts.append(p)
    if len(pts) >= 60:
        break
pts = np.array(pts)
print('y quantiles', np.quantile(pts[:, 1], [0, .1, .5, .9, 1]), flush=True)
lower = pts[pts[:, 1] <= pts[:, 1].min() + .5]
print('lower count', len(lower), flush=True)
anchor = lower[len(lower) // 2]
print('anchor', anchor, flush=True)
print('is_navigable?', hasattr(sim.pathfinder, 'is_navigable'), flush=True)
ok = 0
for k in range(6):
    angle = 2 * math.pi * k / 12
    pos = np.array([anchor[0] + 1.1 * math.cos(angle), anchor[1], anchor[2] + 1.1 * math.sin(angle)])
    nav = sim.pathfinder.is_navigable(pos)
    print('candidate', k, pos, nav, flush=True)
    if not nav:
        continue
    state = habitat_sim.AgentState()
    state.position = pos
    state.rotation = mn.Quaternion.axis_angle(mn.Vector3(0, 1, 0), 0.5)
    sim.initialize_agent(0, state)
    obs = sim.get_sensor_observations()
    print('frame', k, obs['rgb'].shape, float(obs['rgb'].mean()), float((obs['depth'] > 0).mean()), flush=True)
    ok += 1
print('ok frames', ok, flush=True)
sim.close()
