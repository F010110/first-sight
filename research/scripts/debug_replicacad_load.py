"""Debug ReplicaCAD stage loading under Habitat 0.2.5 in the 3D-Mem env."""
import math
import os
import sys

os.environ.setdefault('HABITAT_SIM_LOG', 'verbose')
import habitat_sim
import magnum as mn

scene = sys.argv[1]
cfg = habitat_sim.SimulatorConfiguration()
cfg.scene_id = scene
cfg.enable_physics = False
cfg.gpu_device_id = -1
agent_cfg = habitat_sim.agent.AgentConfiguration()
spec = habitat_sim.CameraSensorSpec()
spec.uuid = 'rgb'
spec.sensor_type = habitat_sim.SensorType.COLOR
spec.resolution = [240, 320]
agent_cfg.sensor_specifications = [spec]
print('creating simulator', flush=True)
sim = habitat_sim.Simulator(habitat_sim.Configuration(cfg, [agent_cfg]))
print('simulator ok, navmesh loaded:', sim.pathfinder.is_loaded, flush=True)
if not sim.pathfinder.is_loaded:
    settings = habitat_sim.NavMeshSettings()
    settings.set_defaults()
    print('recompute navmesh', flush=True)
    ok = sim.recompute_navmesh(sim.pathfinder, settings)
    print('recompute ok', ok, flush=True)
sim.pathfinder.seed(1)
p = sim.pathfinder.get_random_navigable_point()
print('point', p, flush=True)
state = habitat_sim.AgentState()
state.position = p
sim.initialize_agent(0, state)
obs = sim.get_sensor_observations()
print('obs', obs['rgb'].shape, obs['rgb'].mean(), flush=True)
sim.close()
print('done', flush=True)
