"""Images-only candidate descriptors, no labels or model calls; never overwrite."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('public', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
raw = args.public.read_bytes()
spec = importlib.util.spec_from_file_location('features', Path(__file__).resolve().parents[1] / 'sim/spatial/spatial_visual_features.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
rows = []
for row in json.loads(raw)['observations']:
    for view in row['views']:
        if hashlib.sha256(Path(view['path']).read_bytes()).hexdigest() != view['sha256']:
            raise ValueError('Source image hash changed')
    rows.append({'id': row['id'], 'features': [module.descriptor(v['path']) for v in row['views']]})
with args.output.open('x', encoding='utf8') as file:
    json.dump({'schema': 'spatial-candidate-features-v1', 'inputSha256': hashlib.sha256(raw).hexdigest(), 'method': 'rgb-layout-v1', 'extractorSha256': hashlib.sha256(Path(spec.origin).read_bytes()).hexdigest(), 'rows': rows}, file)
