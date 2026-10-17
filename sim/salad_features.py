"""Official SALAD inference, isolated local sources/weights. No provider calls or implicit downloads.

JSON stdin: [{id,frames:[absolute paths]}]; JSON stdout matches visual-recall extractor.
Offline extraction accepts a packaged dataset and writes immutable features/provenance.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''): digest.update(block)
    return digest.hexdigest()

def local_path(value):
    if os.name != 'nt' and len(value) > 2 and value[1:3] in (':\\', ':/'):
        return '/mnt/' + value[0].lower() + '/' + value[3:].replace('\\', '/')
    return value

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--salad', required=True, type=Path); parser.add_argument('--dinov2', required=True, type=Path)
    parser.add_argument('--weights', required=True, type=Path); parser.add_argument('--weights-sha256', required=True)
    parser.add_argument('--salad-revision', default='6aede13a3f6c25750bf7fde10209c06cb73060bb')
    parser.add_argument('--dinov2-revision', default='7764ea0f912e53c92e82eb78a2a1631e92725fc8')
    parser.add_argument('--device', choices=['cpu', 'cuda'], default='cpu'); parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--dataset', type=Path); parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    revision = lambda path: subprocess.check_output(['git', '-C', str(path), 'rev-parse', 'HEAD'], text=True).strip()
    for path, expected in [(args.salad, args.salad_revision), (args.dinov2, args.dinov2_revision)]:
        if revision(path) != expected or subprocess.check_output(['git', '-c', 'core.autocrlf=true', '-C', str(path), 'diff', '--name-only', 'HEAD'], text=True).strip():
            raise ValueError('Upstream source revision/cleanliness mismatch')
    if sha(args.weights) != args.weights_sha256: raise ValueError('Weight hash mismatch')
    if not 1 <= args.threads <= 16: raise ValueError('Thread budget exceeded')
    if bool(args.dataset) != bool(args.output): raise ValueError('Dataset extraction requires a new output directory')
    if args.output: args.output.mkdir(parents=True, exist_ok=False)
    # Keep training imports/logging out of extractor protocol stdout.
    protocol = sys.stdout; sys.stdout = sys.stderr
    import torch
    from PIL import Image
    from torchvision import transforms
    torch.set_num_threads(args.threads)
    sys.path.insert(0, str(args.salad.resolve()))
    from models.backbones.dinov2 import DINOv2
    from models.aggregators.salad import SALAD
    original = torch.hub.load
    def load_local(repo, model, *pos, **kw):
        if repo != 'facebookresearch/dinov2': raise ValueError('Unexpected implicit model repository')
        return original(str(args.dinov2.resolve()), model, source='local', pretrained=False)
    torch.hub.load = load_local
    try:
        # Compose official inference modules with the same state_dict names/forward
        # as VPRModel, without importing its Lightning training/loss dependencies.
        class Inference(torch.nn.Module):
            def __init__(self):
                super().__init__()
                self.backbone = DINOv2('dinov2_vitb14', num_trainable_blocks=4, return_token=True, norm_layer=True)
                self.aggregator = SALAD(num_channels=768, num_clusters=64, cluster_dim=128, token_dim=256)
            def forward(self, x): return self.aggregator(self.backbone(x))
        model = Inference()
    finally: torch.hub.load = original
    model.load_state_dict(torch.load(args.weights, map_location='cpu', weights_only=True), strict=True)
    model.eval().to(args.device)
    # Official evaluation resize/normalization; 322 is divisible by patch size 14.
    transform = transforms.Compose([transforms.Resize((322, 322), interpolation=transforms.InterpolationMode.BILINEAR), transforms.ToTensor(), transforms.Normalize(mean=[.485, .456, .406], std=[.229, .224, .225])])
    if args.dataset:
        def dataset_rows():
            with (args.dataset / 'observations.jsonl').open(encoding='utf8') as stream:
                for line in stream:
                    row = json.loads(line)
                    yield {'id': row['id'], 'frames': [str(args.dataset / row['cameras'][v]) for v in ('front', 'left', 'right')]}
        rows = dataset_rows()
    else:
        rows = json.load(sys.stdin)
        if not isinstance(rows, list) or len(rows) > 100: raise ValueError('Extractor batch exceeds 100')
    output = []; started = time.monotonic(); count = 0
    stream = (args.output / 'features.jsonl').open('x', encoding='utf8') if args.output else None
    try:
        for row in rows:
            if not 1 <= len(row['frames']) <= 4: raise ValueError('Camera budget exceeded')
            features = []; hashes = []
            for path in row['frames']:
                before = sha(Path(local_path(path)))
                with Image.open(local_path(path)) as image: tensor = transform(image.convert('RGB')).unsqueeze(0).to(args.device)
                with torch.inference_mode(): vector = torch.nn.functional.normalize(model(tensor), dim=-1)[0].cpu()
                if vector.numel() != 8448 or not torch.isfinite(vector).all(): raise ValueError('Invalid SALAD descriptor')
                if sha(Path(local_path(path))) != before: raise ValueError('Image changed during feature extraction')
                hashes.append(before); features.append(vector.tolist()); count += 1
            result = {'id': row['id'], 'features': features, 'imageSha256': hashes}
            if stream: stream.write(json.dumps(result) + '\n'); stream.flush()
            else: output.append(result)
    finally:
        if stream: stream.close()
    if args.output:
        report = {'method': 'salad-dinov2-vitb14', 'dimensions': 8448, 'metric': 'cosine', 'saladRevision': revision(args.salad), 'dinov2Revision': revision(args.dinov2), 'weightsSha256': args.weights_sha256, 'images': count, 'elapsedSeconds': time.monotonic() - started, 'torchVersion': torch.__version__, 'device': args.device, 'threads': args.threads, 'modelCalls': 0, 'note': 'Official model inference only; no physical identity assigned; dataset features contain no evaluation truth.'}
        report['sourceManifestSha256'] = sha(args.dataset / 'observations.jsonl')
        report['featuresSha256'] = sha(args.output / 'features.jsonl')
        (args.output / 'complete.json').write_text(json.dumps(report, indent=2), encoding='utf8')
        print(json.dumps(report), file=protocol)
    else: print(json.dumps(output), file=protocol)

if __name__ == '__main__': main()
