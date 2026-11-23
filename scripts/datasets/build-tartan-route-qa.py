"""Freeze an answer-first, metric-anchor TartanGround development QA set; no inference."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import zipfile

REVISION = '388faf9c800568cfc6828fa47e063f8369397eb3'
ANCHORS = [0, 300, 600, 900, 1200, 1490]
LABELS = ['N4', 'N1', 'N6', 'N2', 'N5', 'N3']  # Not temporal numbering.
VIEWS = ['front', 'left', 'right']

def digest(data):
    return hashlib.sha256(data).hexdigest()

def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf8')

def wrap(deg):
    return (deg + 180) % 360 - 180

def yaw(row):
    x, y, z, w = row[3:]
    return math.degrees(math.atan2(2*(w*z+x*y), 1-2*(y*y+z*z)))

def heading(row):
    return int(round(yaw(row)/15)*15) % 360

def turn(start, target):
    d = wrap(target-start)
    return 'straight' if abs(d) <= 25 else 'reverse' if abs(d) >= 155 else 'right' if d > 0 else 'left'

def build(root, replay, metadata):
    from PIL import Image, ImageDraw
    with zipfile.ZipFile(metadata) as archive:
        poses = {v: [[float(x) for x in line.split()] for line in archive.read(f'pose_lcam_{v}.txt').decode().splitlines()] for v in VIEWS}
        meta = json.loads(archive.read('P0006_metadata.json'))
    if meta['num_poses'] != 1504 or meta['time_step'] != .1:
        raise ValueError('Unexpected pinned trajectory')
    rows = [json.loads(l) for l in (replay/'public/observations.jsonl').read_text().splitlines()]
    if len(rows) != 1504 or any(len(p) != 1504 for p in poses.values()):
        raise ValueError('Incomplete poses/images')
    for i in range(1504):
        for v in VIEWS:
            p = poses[v][i]
            if len(p) != 7 or not all(math.isfinite(x) for x in p) or abs(sum(x*x for x in p[3:])-1) > .001:
                raise ValueError('Invalid quaternion')
            if math.dist(p[:3], poses['front'][i][:3]) > .001:
                raise ValueError('Unexpected camera position offset')
        if abs(wrap(yaw(poses['left'][i])-yaw(poses['front'][i])+90)) > .1 or abs(wrap(yaw(poses['right'][i])-yaw(poses['front'][i])-90)) > .1:
            raise ValueError('NED camera heading convention mismatch')
    root.mkdir(parents=True, exist_ok=False)
    images, private_images = {}, {}
    def image(i, view):
        token = f'I{len(images):03d}'
        existing = next((k for k, v in private_images.items() if v['frame'] == i and v['view'] == view), None)
        if existing:
            return existing
        original = next(f for f in rows[i]['frames'] if f['view'] == view)
        path = (replay/'public'/original['path']).resolve()
        if digest(path.read_bytes()) != original['sha256']:
            raise ValueError('Changed original')
        images[token] = {'path': str(path), 'sha256': original['sha256'], 'headingDeg': heading(poses[view][i]), 'view': view}
        private_images[token] = {'frame': i, 'view': view}
        return token
    nodes = [{'id': label, 'images': [image(i, v) for v in VIEWS]} for i, label in zip(ANCHORS, LABELS)]
    edges = []
    for n, (a, b) in enumerate(zip(ANCHORS, ANCHORS[1:])):
        # Tangent is an ideal recorded movement bearing, NOT body orientation or a safe command.
        p, q = poses['front'][a], poses['front'][a+5]
        bearing = int(round(math.degrees(math.atan2(q[1]-p[1], q[0]-p[0]))/15)*15) % 360
        edges.append({'id': f'E{n}', 'from': LABELS[n], 'to': LABELS[n+1], 'departureHeadingDeg': bearing,
                      'evidenceImages': [image(a, 'front'), image((a+b)//2, 'front'), image(b, 'front')],
                      'kind': 'recorded-directed-robot-traversal-not-human-safe-path'})
    tasks, answers = [], []
    def add(kind, query, candidates, answer, basis, **extra):
        task_id = f'Q{len(tasks)+1:03d}'
        tasks.append({'id': task_id, 'kind': kind, 'queryImages': query, 'candidates': candidates, **extra})
        answers.append({'id': task_id, **answer, 'basis': basis})
    blank = {'placeId': None, 'path': [], 'turn': 'unknown', 'abstain': True}
    for n, a in enumerate(ANCHORS):
        q = a+5
        distances = [math.dist(poses['front'][q][:2], poses['front'][b][:2]) for b in ANCHORS]
        if distances[n] > 2 or min(d for k, d in enumerate(distances) if k != n) < 8:
            raise ValueError('Ambiguous metric anchor label')
        candidates = [LABELS[n], LABELS[(n+2)%6], LABELS[(n+4)%6]]
        random.Random(71+n).shuffle(candidates)
        basis = {'rule': 'unique-reference-anchor-within-2m-other-anchors-at-least-8m', 'queryFrame': q, 'anchorFrame': a, 'distanceM': distances[n], 'allAnchorDistancesM': distances}
        for kind, view in [('localization', 'front'), ('cross_view_localization', 'left' if n%2 == 0 else 'right')]:
            add(kind, [image(q, view)], candidates, {'placeId': LABELS[n], 'path': [], 'turn': 'unknown', 'abstain': False}, basis)
    for n in range(4):
        start, goal = LABELS[n], LABELS[5]
        add('localized_route', [image(ANCHORS[n]+5, 'front')], list(reversed(LABELS)),
            {'placeId': start, 'path': LABELS[n:], 'turn': turn(images[image(ANCHORS[n]+5, 'front')]['headingDeg'], edges[n]['departureHeadingDeg']), 'abstain': False},
            {'rule': 'unique-forward-path-in-frozen-directed-memory', 'startAnchor': start}, goalPlaceId=goal)
    for n in [5, 4, 3]:
        add('localized_route', [image(ANCHORS[n]+5, 'front')], list(reversed(LABELS)),
            {**blank, 'placeId': LABELS[n], 'category':'unrecorded_reverse'}, {'rule': 'no-directed-path-to-goal-not-physical-impossibility'}, goalPlaceId=LABELS[0])
    for n, view in enumerate(['left', 'right', 'left']):
        query = image(ANCHORS[n]+5, view)
        add('heading_alignment', [query], [LABELS[n]],
            {'placeId': LABELS[n], 'path': [], 'turn': turn(images[query]['headingDeg'], images[nodes[n]['images'][0]]['headingDeg']), 'abstain': False},
            {'rule': 'NED-camera-heading-difference-after-15-degree-quantization'}, knownPlaceId=LABELS[n], targetImageId=nodes[n]['images'][0])
    for n in [0, 2]:
        add('missing_body_heading', [image(ANCHORS[n]+5, 'front')], [LABELS[n]],
            {**blank, 'placeId': LABELS[n]}, {'rule': 'camera-yaw-is-not-human-body-heading'}, knownPlaceId=LABELS[n], bodyHeadingAvailable=False)
    public = {'schema': 'tartan-route-qa-public-v1', 'headingConvention': 'NED yaw degrees clockwise-positive, arbitrary world zero; per-camera quaternion-derived, rounded to 15deg; not human body heading',
              'scope': 'single-trajectory-development, metric-anchor gallery localization, not semantic rooms or cross-session revisit',
              'images': images, 'nodes': nodes, 'edges': edges, 'tasks': tasks}
    gold = {'schema': 'tartan-route-qa-gold-v1', 'answers': answers, 'imageSources': private_images, 'anchorFrames': dict(zip(LABELS, ANCHORS)),
            'source': {'revision': REVISION, 'trajectory': 'ModernCityDowntown/Data_omni/P0006', 'metadataPath':str(metadata.resolve()), 'metadataSha256': digest(metadata.read_bytes()), 'replayManifestSha256': digest((replay/'public/manifest.json').read_bytes()), 'license': 'CC-BY-4.0'},
            'labelPolicy': 'Authored-before-inference; positions label 2m anchor neighborhoods, not inferred semantic regions. All original source indices private. No future-place-memory or lifelong claim.'}
    save(root/'public.json', public)
    save(root/'gold.json', gold)
    # Contact sheet for author inspection BEFORE freeze/inference; all task images included.
    tokens = list(images)
    sheet = Image.new('RGB', (6*200, math.ceil(len(tokens)/6)*225), 'white')
    draw = ImageDraw.Draw(sheet)
    for n, token in enumerate(tokens):
        im = Image.open(images[token]['path']); im.thumbnail((200, 200)); x, y = n%6*200, n//6*225
        sheet.paste(im, (x, y)); draw.text((x+2, y+201), f'{token} f{private_images[token]["frame"]} {images[token]["view"]}', fill='black')
    sheet.save(root/'review.jpg')
    save(root/'design.json', {'tasks': len(tasks), 'counts': {k: sum(t['kind'] == k for t in tasks) for k in sorted(set(t['kind'] for t in tasks))}, 'reviewStatus': 'requires-contact-sheet-inspection-before-freeze', 'modelCalls': 0})
    return {'root': str(root), 'tasks': len(tasks), 'images': len(images)}

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--replay', type=Path, default=Path('run/replicacad-pilot/tartanground-moderncity-p0006-v1'))
    p.add_argument('--metadata', type=Path, default=Path('datasets/tartanground-moderncity-speeds-v1/P0006-metadata.zip'))
    a = p.parse_args(); print(json.dumps(build(a.output, a.replay, a.metadata)))
