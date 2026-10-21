"""Evaluation ONLY: exact capture clock + supplied HSSD region polygons.

No model request, prediction or old AI label is read. Output must stay private.
Source semantic regions are a reproducible benchmark granularity, not a claim
that all source polygons equal a user's preferred physical-place granularity.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def edge_distance(x, z, polygon):
    result = math.inf
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        dx, dz = b[0] - a[0], b[2] - a[2]
        length = dx * dx + dz * dz
        t = max(0, min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / length)) if length else 0
        result = min(result, math.hypot(x - a[0] - t * dx, z - a[2] - t * dz))
    return result


def inside(x, z, polygon):
    if edge_distance(x, z, polygon) <= 1e-8:
        return True
    result = False
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        if (a[2] > z) != (b[2] > z) and x < a[0] + (z - a[2]) * (b[0] - a[0]) / (b[2] - a[2]):
            result = not result
    return result


def classify(position, regions, margin):
    if len(position) != 3 or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in position):
        raise ValueError('Invalid source position')
    x, y, z = position
    candidates = []
    for index, region in enumerate(regions):
        polygon = region['poly_loop']
        floor = region.get('floor_height', 0)
        if len(polygon) < 3 or any(len(p) != 3 or any(not math.isfinite(v) for v in p) for p in polygon) or not math.isfinite(floor):
            raise ValueError('Invalid supplied region geometry')
        if abs(y - floor) <= .4 and inside(x, z, polygon):
            candidates.append((index, edge_distance(x, z, polygon)))
    if not candidates:
        return 'unknown', None, 'No supplied region contains the exact source position; no interpolation or nearest-region assignment'
    if len(candidates) != 1:
        return 'boundary', None, 'Overlapping supplied polygons; no arbitrary first-region choice'
    index, distance = candidates[0]
    if distance <= margin:
        return 'boundary', None, f'Within frozen {margin}m polygon-edge buffer; exact boundary assignment not scored'
    return 'core', index, f'Unique supplied region {index}, {distance:.4f}m from polygon edge; source label={regions[index].get("label", "unspecified")}'


def label(public_path, captures, output, margin=.35):
    if not math.isfinite(margin) or not 0 <= margin <= 2:
        raise ValueError('Boundary margin must be frozen within 0–2m')
    if len({scene for scene, _, _ in captures}) != len(captures):
        raise ValueError('Duplicate source scene')
    public_raw = public_path.read_bytes()
    rows = json.loads(public_raw)['observations']
    sources = {}
    provenance = {}
    for scene, directory, semantic_path in captures:
        directory, semantic_path = Path(directory), Path(semantic_path)
        trace_raw = (directory / 'collector-trace.json').read_bytes()
        windows_raw = (directory / 'windows.jsonl').read_bytes()
        semantic_raw = semantic_path.read_bytes()
        trace = json.loads(trace_raw)
        windows = [json.loads(line) for line in windows_raw.splitlines() if line.strip()]
        trace_by_time = {r['timestampMs']: r for r in trace}
        windows_by_time = {r['timestampMs']: r for r in windows}
        if len(trace_by_time) != len(trace) or len(windows_by_time) != len(windows):
            raise ValueError('Ambiguous source clock')
        sources[scene] = (trace_by_time, windows_by_time, json.loads(semantic_raw)['region_annotations'])
        provenance[scene] = {'traceSha256': digest(trace_raw), 'windowsSha256': digest(windows_raw), 'semanticsSha256': digest(semantic_raw)}
    labels = []
    seen = set()
    clocks = {}
    for row in rows:
        if row['id'] in seen or row['scene'] not in sources or row['atMs'] <= clocks.get(row['scene'], -math.inf):
            raise ValueError('Duplicate, unknown or unordered public observation')
        seen.add(row['id'])
        clocks[row['scene']] = row['atMs']
        trace, windows, regions = sources[row['scene']]
        if row['atMs'] not in trace or row['atMs'] not in windows or row['id'] != row['scene'] + '-' + Path(windows[row['atMs']]['frame']).stem:
            raise ValueError('Public image ID/time does not exactly bind to source window; no nearest-time matching')
        for view in row['views']:
            if digest(Path(view['path']).read_bytes()) != view['sha256']:
                raise ValueError('Public original/derived image hash changed')
        kind, region, reason = classify(trace[row['atMs']]['position'], regions, margin)
        labels.append({'id': row['id'], 'scene': row['scene'], 'split': 'development', 'kind': kind, 'region': row['scene'] + ':source-region-' + str(region) if region is not None else None, 'reviewer': 'HSSD-supplied-polygon/exact-source-position (automatic, not human)', 'reason': reason})
    revisits = []
    for scene in sources:
        local = [r for r in labels if r['scene'] == scene]
        for region in sorted({r['region'] for r in local if r['kind'] == 'core'}):
            indices = [i for i, r in enumerate(local) if r['kind'] == 'core' and r['region'] == region]
            first = indices[0]
            for last in indices[1:]:
                if any(r['kind'] == 'core' and r['region'] != region for r in local[first + 1:last]):
                    revisits.append({'a': local[first]['id'], 'b': local[last]['id']})
                    break
    output.parent.mkdir(parents=True, exist_ok=True)
    result = {'labels': labels, 'revisits': revisits, 'publicInputSha256': digest(public_raw), 'policy': {'schema': 'hssd-source-polygon-eval-v1', 'boundaryMarginMeters': margin, 'floorToleranceMeters': .4, 'regionAliases': None, 'granularity': 'Distinct supplied region polygons, NOT merged by shared functional name', 'split': 'development; already-used scenes are never relabeled as heldout'}, 'privateSourceHashes': provenance, 'warning': 'Private evaluation artifact. Source polygons can differ from product region semantics; independent visual adjudication remains necessary. No collectorRegionIndex or model prediction used to assign labels.'}
    with output.open('x', encoding='utf-8') as file:
        json.dump(result, file, ensure_ascii=False, indent=2)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--public', type=Path, required=True)
    parser.add_argument('--capture', nargs=3, action='append', metavar=('PUBLIC_SCENE', 'CAPTURE_DIRECTORY', 'SEMANTICS_JSON'), required=True)
    parser.add_argument('--margin', type=float, default=.35)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = label(args.public, args.capture, args.output, args.margin)
    print(json.dumps({'labels': len(result['labels']), 'cores': sum(r['kind'] == 'core' for r in result['labels']), 'revisits': len(result['revisits']), 'modelCalls': 0}))
