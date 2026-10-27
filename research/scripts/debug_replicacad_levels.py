"""Inspect ReplicaCAD stage navigable levels and Habitat 0.2.5 API availability."""
import os
import sys

os.environ.setdefault('HABITAT_SIM_LOG', 'quiet')
import habitat_sim
import numpy as np

cfg = habitat_sim.SimulatorConfiguration()
cfg.scene_id = sys.argv[1]
cfg.enable_physics = False
cfg.gpu_device_id = -1
agent_cfg = habitat_sim.agent.AgentConfiguration()
agent_cfg.sensor_specifications = []
sim = habitat_sim.Simulator(habitat_sim.Configuration(cfg, [agent_cfg]))
settings = habitat_sim.NavMeshSettings()
settings.set_defaults()
if not sim.pathfinder.is_loaded:
    print('recompute', sim.recompute_navmesh(sim.pathfinder, settings))
sim.pathfinder.seed(3)
pts = np.array([sim.pathfinder.get_random_navigable_point() for _ in range(400)])
print('y quantiles', np.quantile(pts[:, 1], [0, .1, .25, .5, .75, .9, 1]))
print('navigable_area', sim.pathfinder.navigable_area)
print('has is_navigable', hasattr(sim.pathfinder, 'is_navigable'))
floor = pts[np.abs(pts[:, 1] - np.quantile(pts[:, 1], .1)) < .2]
print('floor points', len(floor), 'x range', floor[:, 0].min(), floor[:, 0].max(),
      'z range', floor[:, 2].min(), floor[:, 2].max())
sim.close()
