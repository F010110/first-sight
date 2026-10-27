"""Isolate whether the 0.2.5 bullet build segfaults on rendering or on scene instance."""
import math
import os
import sys

os.environ.setdefault('HABITAT_SIM_LOG', 'quiet')
import habitat_sim
import magnum as mn

mode = sys.argv[1]
backend = habitat_sim.SimulatorConfiguration()
backend.enable_physics = False
backend.gpu_device_id = -1
if mode == 'stage':
    backend.scene_id = 'datasets/realism-source-survey-20261024-v2/ReplicaCAD_dataset/stages/frl_apartment_stage.glb'
elif mode == 'instance':
    backend.scene_id = 'apt_1_static'
    backend.scene_dataset_config_file = 'research/data/replicacad-static/static.scene_dataset_config.json'
agent_cfg = habitat_sim.agent.AgentConfiguration()
if len(sys.argv) > 2 and sys.argv[2] == 'sensors':
    specs = []
    for uuid, kind in (('rgb', habitat_sim.SensorType.COLOR), ('depth', habitat_sim.SensorType.DEPTH)):
        spec = habitat_sim.CameraSensorSpec()
        spec.uuid = uuid
        spec.sensor_type = kind
        spec.resolution = [480, 640]
        spec.position = mn.Vector3(0., 1.5, 0.)
        spec.hfov = 90
        specs.append(spec)
    agent_cfg.sensor_specifications = specs
print('creating', mode, flush=True)
sim = habitat_sim.Simulator(habitat_sim.Configuration(backend, [agent_cfg]))
print('created; navmesh', sim.pathfinder.is_loaded, flush=True)
if len(sys.argv) > 2 and sys.argv[2] == 'sensors':
    sim.pathfinder.seed(1)
    state = habitat_sim.AgentState()
    state.position = sim.pathfinder.get_random_navigable_point()
    state.rotation = mn.Quaternion.axis_angle(mn.Vector3(0, 1, 0), 0.3)
    sim.initialize_agent(0, state)
    obs = sim.get_sensor_observations()
    print('rendered', obs['rgb'].shape, float(obs['rgb'].mean()), flush=True)
sim.close()
print('done', flush=True)
