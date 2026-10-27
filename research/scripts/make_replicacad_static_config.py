"""Build a static ReplicaCAD scene config (no articulated objects) for 3D-Mem testing.

Upstream dataset untouched. Paths are emitted in WSL POSIX form because Habitat
runs inside Ubuntu; Windows drive paths are rejected by the metadata loader.
"""
import json
import re
from pathlib import Path

BASE = Path('datasets/realism-source-survey-20261024-v2/ReplicaCAD_dataset').resolve()
OUT = Path('research/data/replicacad-static').resolve()
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'scenes').mkdir(exist_ok=True)


def posix(path: Path) -> str:
    text = str(path).replace('\\', '/')
    match = re.match(r'^([A-Za-z]):/(.*)$', text)
    if match:
        return f'/mnt/{match.group(1).lower()}/{match.group(2)}'
    return text


scene = json.loads((BASE / 'configs/scenes/apt_1.scene_instance.json').read_text())
for key in ('articulated_object_instances', 'articulated_objects'):
    scene.pop(key, None)
# The upstream apt_1 instance points at the shared empty-stage navmesh handle.
# Redirect it to the apartment navmesh we register below.
scene['navmesh_instance'] = 'apt_1'
(OUT / 'scenes' / 'apt_1_static.scene_instance.json').write_text(json.dumps(scene, indent=1))

config = {
    'stages': {'paths': {'.json': [posix(BASE / 'configs/stages')]}},
    'objects': {'paths': {'.json': [posix(BASE / 'configs/objects')]}},
    'light_setups': {'paths': {'.json': [posix(BASE / 'configs/lighting')]}},
    'scene_instances': {'paths': {'.json': [posix(OUT / 'scenes')]}},
    'navmesh_instances': {'apt_1': posix(BASE / 'navmeshes/apt_1.navmesh'),
                          'apt_1_static': posix(BASE / 'navmeshes/apt_1.navmesh')},
}
(OUT / 'static.scene_dataset_config.json').write_text(json.dumps(config, indent=1))
print(json.dumps(config, indent=1))
