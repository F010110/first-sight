import json

base = 'datasets/realism-source-survey-20261024-v2/ReplicaCAD_dataset'
d = json.load(open(f'{base}/replicaCAD.scene_dataset_config.json'))
print(json.dumps({k: d[k] for k in ['stages', 'scene_instances', 'navmesh_instances']}, indent=1)[:3000])
s = json.load(open(f'{base}/configs/scenes/apt_1.scene_instance.json'))
print(json.dumps(s, indent=1)[:2500])
