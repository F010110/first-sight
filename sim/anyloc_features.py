"""Official AnyLoc demo modules, pinned local DINOv2; prefix-only VLAD vocabulary.
This small-resource adapter is not the paper's default backbone/vocabulary benchmark.
"""
import argparse
import importlib.util
import json
import subprocess
import time
from pathlib import Path
from salad_features import sha

def main():
    p = argparse.ArgumentParser(); p.add_argument('--anyloc', required=True, type=Path); p.add_argument('--dinov2', required=True, type=Path); p.add_argument('--weights', required=True, type=Path); p.add_argument('--weights-sha256', required=True); p.add_argument('--dataset', required=True, type=Path); p.add_argument('--output', required=True, type=Path); p.add_argument('--clusters', type=int, default=8); p.add_argument('--fit-groups', type=int, default=8); a = p.parse_args()
    if sha(a.weights) != a.weights_sha256: raise ValueError('Weight hash mismatch')
    if not 2 <= a.clusters <= 64 or not 1 <= a.fit_groups <= 16: raise ValueError('Vocabulary budget exceeded')
    a.output.mkdir(parents=True, exist_ok=False)
    import torch
    from PIL import Image
    from torchvision import transforms as T
    torch.set_num_threads(4); torch.manual_seed(0)
    spec = importlib.util.spec_from_file_location('anyloc_official_demo', a.anyloc / 'demo' / 'utilities.py'); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    original = torch.hub.load
    def local(repo, name, *args, **kwargs):
        if repo != 'facebookresearch/dinov2' or name != 'dinov2_vitb14': raise ValueError('Implicit model refused')
        model = original(str(a.dinov2.resolve()), name, source='local', pretrained=False)
        model.load_state_dict(torch.load(a.weights, map_location='cpu', weights_only=True), strict=True)
        return model
    torch.hub.load = local
    try: extractor = module.DinoV2ExtractFeatures('dinov2_vitb14', layer=11, facet='token', device='cpu')
    finally: torch.hub.load = original
    transform = T.Compose([T.Resize((322, 322), interpolation=T.InterpolationMode.BILINEAR), T.ToTensor(), T.Normalize([.485,.456,.406],[.229,.224,.225])])
    rows = [json.loads(l) for l in (a.dataset / 'observations.jsonl').read_text().splitlines()]
    if len(rows) < a.fit_groups or any(rows[i]['atMs'] > rows[i+1]['atMs'] for i in range(len(rows)-1)): raise ValueError('Ordered warmup required')
    def patches(row, view):
        path = a.dataset / row['cameras'][view]
        if sha(path) != row['sha256'][view]: raise ValueError('Image hash mismatch')
        with Image.open(path) as image: tensor = transform(image.convert('RGB')).unsqueeze(0)
        with torch.inference_mode(): return extractor(tensor).squeeze(0)
    start = time.monotonic()
    warmup = [patches(row,v) for row in rows[:a.fit_groups] for v in ['front','left','right']]
    vlad = module.VLAD(a.clusters, desc_dim=768, cache_dir=str(a.output / 'vocabulary'))
    vlad.fit(torch.cat(warmup)); del warmup
    with (a.output / 'features.jsonl').open('x') as stream:
        for row in rows:
            values = []
            for view in ['front','left','right']:
                vector = vlad.generate(patches(row,view))
                if vector.numel() != a.clusters*768 or not torch.isfinite(vector).all(): raise ValueError('Invalid VLAD output')
                values.append(vector.tolist())
            stream.write(json.dumps({'id':row['id'],'features':values,'imageSha256':[row['sha256'][v] for v in ['front','left','right']]})+'\n'); stream.flush()
    revision = lambda path: subprocess.check_output(['git','-C',str(path),'rev-parse','HEAD'],text=True).strip()
    report = {'method':'anyloc-demo-vitb14-layer11-token-vlad', 'dimensions':a.clusters*768,'metric':'cosine','anylocRevision':revision(a.anyloc),'dinov2Revision':revision(a.dinov2),'weightsSha256':a.weights_sha256,'featuresSha256':sha(a.output/'features.jsonl'),'sourceManifestSha256':sha(a.dataset/'observations.jsonl'),'vocabularySha256':sha(a.output/'vocabulary'/'c_centers.pt'),'fitObservationIds':[r['id'] for r in rows[:a.fit_groups]],'warmupEndMs':rows[a.fit_groups-1]['atMs'],'clusters':a.clusters,'images':len(rows)*3,'elapsedSeconds':time.monotonic()-start,'modelCalls':0,'note':'Prefix-fitted development vocabulary; no claims before warmup end, no held-out place accuracy. Smaller configuration than paper defaults.'}
    (a.output/'complete.json').write_text(json.dumps(report,indent=2)); print(json.dumps(report))

if __name__=='__main__': main()
