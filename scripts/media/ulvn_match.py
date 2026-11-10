"""ULVN-inspired VPR/geometry adapter, not a reproduction of RAVEL graph/BPL.

Persistent JSONL protocol compatible with image_index.py. Models load lazily;
--check imports dependencies only (no model downloads). stdout is protocol-only.
MegaLoc revision and LightGlue install are pinned separately for reproducibility.
"""
import argparse
import contextlib
import hashlib
import importlib
import json
import os
import sys
import time
from collections import OrderedDict

MEGALOC_REVISION = '5fe0dd697c4a70ba3e23607f6716ab3c606b16db'
MEGALOC_WEIGHTS_REVISION = 'a0f34722c4297ff787e022433799250180860af7'


def check_dependencies():
    result = {}
    for name in ['torch', 'torchvision', 'lightglue', 'cv2', 'numpy', 'PIL']:
        try:
            module = importlib.import_module(name)
            result[name] = getattr(module, '__version__', 'installed')
        except Exception as error:
            result[name] = {'error': str(error)}
    return result


def bounded_put(cache, key, value, limit):
    cache[key] = value
    cache.move_to_end(key)
    while len(cache) > limit:
        cache.popitem(last=False)


def geometry_schedule(scores, top_k, budget):
    """Round robin by current image, not one pair per historical place."""
    ranked = [sorted(enumerate(row), key=lambda x: (-float(x[1]), x[0]))[:top_k] for row in scores]
    pairs = []
    for rank in range(top_k):
        for q, row in enumerate(ranked):
            if rank < len(row):
                pairs.append((q, row[rank][0]))
                if len(pairs) >= budget:
                    return pairs
    return pairs


class Matcher:
    def __init__(self, device='auto'):
        import torch
        from torchvision import transforms
        from lightglue import SuperPoint, LightGlue
        self.torch = torch
        self.device = 'cuda' if device == 'auto' and torch.cuda.is_available() else ('cpu' if device == 'auto' else device)
        from huggingface_hub import hf_hub_download
        from safetensors.torch import load_file
        import importlib.util
        source = hf_hub_download('gberton/MegaLoc', 'megaloc_model.py', revision=MEGALOC_WEIGHTS_REVISION)
        weights = hf_hub_download('gberton/MegaLoc', 'model.safetensors', revision=MEGALOC_WEIGHTS_REVISION)
        spec = importlib.util.spec_from_file_location('first_sight_pinned_megaloc', source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.encoder = module.MegaLoc()
        self.encoder.load_state_dict(load_file(weights))
        self.encoder = self.encoder.eval().to(self.device)
        with open(weights, 'rb') as stream:
            self.weights_sha256 = hashlib.file_digest(stream, 'sha256').hexdigest()
        self.extractor = SuperPoint(max_num_keypoints=1024).eval().to(self.device)
        self.matcher = LightGlue(features='superpoint').eval().to(self.device)
        self.transform = transforms.Compose([transforms.Resize((320, 320)), transforms.ToTensor(), transforms.Normalize([.485, .456, .406], [.229, .224, .225])])
        self.globals = OrderedDict()
        self.locals = OrderedDict()

    def encode(self, images):
        import numpy as np
        from PIL import Image
        keys = []
        for image in images:
            with open(image['path'], 'rb') as stream:
                key = hashlib.sha256(stream.read()).hexdigest()
            if image.get('sha256') and image['sha256'] != key:
                raise ValueError('Source image hash mismatch')
            keys.append(key)
            image['_key'] = key
        # Outputs belong to this request even if a bounded persistent cache evicts.
        descriptors = {}
        pending = []
        for image, key in zip(images, keys):
            if key in self.globals:
                descriptors[key] = self.globals[key]
                self.globals.move_to_end(key)
            elif key not in {p['_key'] for p in pending}:
                pending.append(image)
        for start in range(0, len(pending), 8):
            batch = pending[start:start + 8]
            tensors = []
            for image in batch:
                with Image.open(image['path']) as im:
                    tensors.append(self.transform(im.convert('RGB')))
            with self.torch.inference_mode():
                z = self.encoder(self.torch.stack(tensors).to(self.device))
                z = self.torch.nn.functional.normalize(z, dim=1).cpu().numpy().astype('float32')
            for image, feature in zip(batch, z):
                descriptors[image['_key']] = feature
                bounded_put(self.globals, image['_key'], feature, 4096)
        return np.stack([descriptors[key] for key in keys])

    def local(self, image):
        from lightglue.utils import load_image
        key = image['_key']
        if key not in self.locals:
            with self.torch.inference_mode():
                features = self.extractor.extract(load_image(image['path']).to(self.device), resize=640)
            bounded_put(self.locals, key, {k: v.cpu() for k, v in features.items()}, 128)
        self.locals.move_to_end(key)
        return {k: v.to(self.device) for k, v in self.locals[key].items()}

    def verify(self, query, old):
        import cv2
        from lightglue.utils import rbd
        with self.torch.inference_mode():
            a, b = self.local(query), self.local(old)
            matches = rbd(self.matcher({'image0': a, 'image1': b}))['matches'].cpu().numpy()
        if len(matches) < 8:
            return {'inliers': 0, 'good': len(matches), 'ratio': 0.0}
        x = rbd(a)['keypoints'].cpu().numpy()[matches[:, 0]]
        y = rbd(b)['keypoints'].cpu().numpy()[matches[:, 1]]
        _, mask = cv2.findFundamentalMat(x, y, cv2.FM_RANSAC, 1.0, .999)
        count = int(mask.sum()) if mask is not None else 0
        return {'inliers': count, 'good': len(matches), 'ratio': count / len(matches)}

    def match(self, request):
        import numpy as np
        started = time.perf_counter()
        queries = request.get('queries', [])
        places = request.get('places', [])
        if not 1 <= len(queries) <= 60 or len(places) > 256:
            raise ValueError('ULVN adapter capacity: 1..60 query images, at most 256 places')
        per_place = int(request.get('imagesPerPlace', 6))
        if not 1 <= per_place <= 24:
            raise ValueError('imagesPerPlace must be 1..24')
        old = []
        for place in places:
            members = place.get('members', [])
            # Same bounded historical input sampling for both matcher backends.
            from image_index import select_diverse
            for member in select_diverse(members, per_place):
                old.append({**member, 'placeId': place['placeId']})
        if not old:
            return {'ok': True, 'results': [], 'best': None, 'nearest': None}
        z = self.encode(queries + old)
        scores = z[:len(queries)] @ z[len(queries):].T
        encoded = time.perf_counter()
        schedule = geometry_schedule(scores, min(4, len(old)), 96)
        results = []
        for q, h in schedule:
            outcome = self.verify(queries[q], old[h])
            results.append({'id': old[h]['placeId'], 'path': old[h]['path'], 'queryPath': queries[q]['path'], 'similarity': float(scores[q, h]), **outcome})
        # Preserve a global alternative per place without labelling it verified.
        for place in places:
            indexes = [i for i, image in enumerate(old) if image['placeId'] == place['placeId']]
            if not indexes:
                continue
            q, local = np.unravel_index(np.argmax(scores[:, indexes]), (len(queries), len(indexes)))
            h = indexes[local]
            if (int(q), int(h)) not in schedule:
                results.append({'id': old[h]['placeId'], 'path': old[h]['path'], 'queryPath': queries[q]['path'], 'similarity': float(scores[q, h]), 'inliers': 0, 'geometricallyVerified': False})
        results.sort(key=lambda x: (-x['inliers'], -x['similarity']))
        return {'ok': True, 'results': results, 'best': results[0] if results else None, 'nearest': max(results, key=lambda x: x['similarity']) if results else None, 'stats': {'backend': 'ulvn-inspired-megaloc-superpoint-lightglue-fundamental-ransac-v1', 'megalocRevision': MEGALOC_REVISION, 'weightsRevision': MEGALOC_WEIGHTS_REVISION, 'weightsSHA256': self.weights_sha256, 'device': self.device, 'retrieval': 'exact-normalized-dot-product', 'queryImages': len(queries), 'historicalImages': len(old), 'geometryPairs': len(schedule), 'encodeMs': (encoded - started) * 1000, 'totalMs': (time.perf_counter() - started) * 1000}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.check:
        with contextlib.redirect_stdout(sys.stderr):
            checks = check_dependencies()
        print(json.dumps({'ok': not any(isinstance(v, dict) for v in checks.values()), 'dependencies': checks, 'megalocRevision': MEGALOC_REVISION}))
        return
    matcher = None
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            if request.get('op') == 'close':
                break
            if request.get('op') != 'match':
                raise ValueError('Unsupported operation')
            with contextlib.redirect_stdout(sys.stderr):
                if matcher is None:
                    matcher = Matcher(os.environ.get('ULVN_DEVICE', 'auto'))
                response = matcher.match(request)
            print(json.dumps({'id': request.get('id'), **response}), flush=True)
        except Exception as error:
            print(json.dumps({'id': request.get('id'), 'ok': False, 'results': [], 'error': type(error).__name__ + ': ' + str(error)}), flush=True)


if __name__ == '__main__':
    main()
