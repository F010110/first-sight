"""REVIEW ONLY: native poses join frozen predictions by source ID.
Never imported by recognition, retrieval or the 90-question model runner.
No floor polygons/mesh are invented from trajectories.
"""
import argparse
import hashlib
import json
import math
import shutil
import sqlite3
from collections import defaultdict
from pathlib import Path


def load(path):
    return json.loads(path.read_text(encoding='utf8'))


def lines(path):
    return [json.loads(s) for s in path.read_text(encoding='utf8').splitlines() if s.strip()]


def build(memory, replay, truth, image_package, output, clock=None):
    if output.exists():
        raise ValueError('Require a new review directory')
    rows = lines(replay)
    native = {r['observationId']: r for r in lines(truth)}
    images = {r['id']: r for r in load(image_package / 'data.json')['samples']}
    dates = {r['id']: r['recordedTime'] for r in load(clock)['observations']} if clock else {}
    db = sqlite3.connect(memory.resolve().as_uri() + '?mode=ro', uri=True)
    try:
        assignments = {r[0]: json.loads(r[1]) for r in db.execute('select observation_id,raw from assignments')}
        nodes = {r[0]: json.loads(r[1]) for r in db.execute('select id,raw from places')}
        edges = [dict(zip(['fromObservationId', 'toObservationId', 'fromPlaceId', 'toPlaceId'], r))
                 for r in db.execute('select from_observation_id,to_observation_id,from_place,to_place from transitions')]
    finally:
        db.close()
    if set(assignments) != {r['id'] for r in rows} or any(r['id'] not in native or r['id'] not in images for r in rows):
        raise ValueError('Predictions/native poses/image package do not cover the same observations')
    ordered = list(dict.fromkeys(assignments[r['id']]['placeId'] for r in rows if assignments[r['id']]['placeId']))
    numbers = {key: i+1 for i, key in enumerate(ordered)}
    samples = []
    for index, row in enumerate(rows):
        n = native[row['id']]
        if hashlib.sha256(n['sourceFrameUid'].encode()).hexdigest()[:24] != row['id']:
            raise ValueError('Native pose binding mismatch')
        xyz = n['sourcePose'][:3]
        if len(xyz) != 3 or not all(isinstance(x, (int, float)) and math.isfinite(x) for x in xyz):
            raise ValueError('Invalid native coordinates')
        sample = images[row['id']]
        if sample['sha256'] != row['sha256']:
            raise ValueError('Image identity mismatch')
        cameras = {}
        for view, relative in sample['cameras'].items():
            path = image_package / relative
            if hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256'][view]:
                raise ValueError('Original image changed')
            # Same review server, no additional image copies and no native truth in model inputs.
            import os
            cameras[view] = Path(os.path.relpath(path, output)).as_posix()
        a = assignments[row['id']]
        samples.append({'id': row['id'], 'index': index, 'episode': row['episodeNumber'],
                        'atMs': row['atMs'], 'sourceAtMs': row['sourceAtMs'], 'time': dates.get(row['id']),
                        'xyz': xyz, 'placeId': a['placeId'], 'placeNumber': numbers.get(a['placeId']),
                        'reason': a['reason'], 'cameras': cameras})
    grouped = defaultdict(list)
    for point in samples:
        if point['placeId']:
            grouped[point['placeId']].append(point)
    places = []
    for key in ordered:
        points = grouped[key]
        xs, ys, zs = ([p['xyz'][i] for p in points] for i in range(3))
        places.append({'id': key, 'number': numbers[key], 'summary': nodes[key]['summary'],
                       'observations': len(points), 'episodes': sorted({p['episode'] for p in points}),
                       'centroid': [sum(xs)/len(xs), sum(ys)/len(ys)],
                       'xyExtentM': math.hypot(max(xs)-min(xs), max(ys)-min(ys)),
                       'nativeZRange': [min(zs), max(zs)], 'sampleIds': [p['id'] for p in points]})
    # Suspicion queues, NOT automatic room/floor truth or scores.
    close_pairs = {}
    for i, a in enumerate(samples):
        if not a['placeId']:
            continue
        for b in samples[i+1:]:
            if not b['placeId'] or a['placeId'] == b['placeId']:
                continue
            distance = math.dist(a['xyz'][:2], b['xyz'][:2])
            if distance > .75:
                continue
            same_route = a['episode'] == b['episode']
            if same_route and abs(a['xyz'][2]-b['xyz'][2]) > .3:
                continue
            key = tuple(sorted([a['placeId'], b['placeId']]))
            if key not in close_pairs or distance < close_pairs[key]['distanceM']:
                close_pairs[key] = {'a': a['id'], 'b': b['id'], 'placeA': a['placeId'], 'placeB': b['placeId'],
                                    'distanceM': round(distance, 3), 'sameRoute': same_route,
                                    'reason': '同段低高度差且XY接近，可能误拆或区域边界' if same_route else '跨段XY接近；高度对齐/楼层未知，不能据此判错'}
    fingerprint = hashlib.sha256(memory.read_bytes() + replay.read_bytes() + truth.read_bytes()).hexdigest()
    output.mkdir(parents=True)
    data = {'protocol': 'spatial-trajectory-review-v1', 'fingerprint': fingerprint,
            'title': '学校 · 63地点轨迹审核' if len(places) == 63 else '空间地点轨迹审核',
            'warning': '审核专用原生位姿，未提供给算法。没有建筑平面图/房间多边形；线是采样轨迹，不是墙或可通行路径。不同录像不连线。原生Z受采集高度影响，跨段不能直接作为楼层真值。候选问题不是错误判定。',
            'samples': samples, 'places': places, 'edges': edges,
            'suspicions': sorted(close_pairs.values(), key=lambda p: (not p['sameRoute'], p['distanceM'])),
            'provenance': {'memorySha256': hashlib.sha256(memory.read_bytes()).hexdigest(),
                           'replaySha256': hashlib.sha256(replay.read_bytes()).hexdigest(),
                           'nativeTruthSha256': hashlib.sha256(truth.read_bytes()).hexdigest()},
            'limits': ['No independent physical-place ground truth', 'No complete floor plan available',
                       'Cross-route Z/robot-height alignment unverified', 'Trajectories are sampled, not complete free-space coverage']}
    (output / 'data.json').write_text(json.dumps(data, ensure_ascii=False), encoding='utf8')
    shutil.copy2(Path(__file__).with_name('spatial_graph_review.html'), output / 'index.html')
    return {'observations': len(samples), 'places': len(places), 'suspectedPairs': len(close_pairs),
            'fingerprint': fingerprint, 'reviewOnly': True}


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    for name in ['memory', 'replay', 'truth', 'image_package', 'output']:
        p.add_argument(name, type=Path)
    p.add_argument('--clock', type=Path)
    args = p.parse_args()
    print(json.dumps(build(**vars(args)), ensure_ascii=True))
