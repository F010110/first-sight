"""Print scene-dataset handle counts to diagnose instance resolution."""
import os

os.environ.setdefault('HABITAT_SIM_LOG', 'verbose')
import habitat_sim

dataset = 'research/data/replicacad-static/static.scene_dataset_config.json'
cfg = habitat_sim.SimulatorConfiguration()
cfg.scene_id = 'apt_1_static'
cfg.scene_dataset_config_file = dataset
cfg.enable_physics = False
cfg.gpu_device_id = -1
agent = habitat_sim.agent.AgentConfiguration()
agent.sensor_specifications = []
sim = habitat_sim.Simulator(habitat_sim.Configuration(cfg, [agent]))
print('stage handles:', sim.metadata_mediator.get_scene_handles())
sim.close()
