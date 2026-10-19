"""Pinned HSSD metadata audit and diverse 20-scene candidate selection."""
import collections
import concurrent.futures
import hashlib
import json
import math
import urllib.request
from pathlib import Path

REVISION = '4369cb9876214c7fbebcf552eb532380e4d287e4'
ROOT = Path('run/hssd-catalog-v1')
EXTERIOR = {'outdoor', 'porch/terrace/deck/driveway', 'balcony'}


def get(path):
    target = ROOT / path
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        url = f'https://huggingface.co/datasets/hssd/hssd-hab/resolve/{REVISION}/{path}'
        with urllib.request.urlopen(url, timeout=90) as response:
            target.write_bytes(response.read())
    return json.loads(target.read_text(encoding='utf-8'))


def describe(path):
    scene = get(path); id = Path(path).name.removesuffix('.scene_instance.json')
    semantics = get(f'semantics/scenes/{id}.semantic_config.json')
    regions = semantics.get('region_annotations', [])
    counts = collections.Counter(row.get('label', 'unknown') for row in regions)
    areas = []
    for region in regions:
        polygon = region.get('poly_loop', [])
        areas.append(abs(sum(a[0]*b[2]-b[0]*a[2] for a,b in zip(polygon,polygon[1:]+polygon[:1])))/2 if polygon else 0)
    scene_bytes = (ROOT/path).read_bytes()
    stage = scene['stage_instance']['template_name']
    indoor = [r for r in regions if r.get('label') not in EXTERIOR]
    return {'sceneId': id, 'stage': stage, 'labels': dict(counts), 'regionCount': len(regions),
            'indoorLabels': dict(collections.Counter(r.get('label', 'unknown') for r in indoor)),
            'indoorRegionCount': len(indoor), 'indoorAnnotatedAreaSum': sum(area for region, area in zip(regions, areas) if region.get('label') not in EXTERIOR),
            'annotatedAreaSum': sum(areas), 'largestRegionArea': max(areas, default=0),
            'floorLevels': sorted({round(r.get('floor_height', 0), 1) for r in regions}),
            'objectInstances': len(scene.get('object_instances', [])), 'sceneConfigSha256': hashlib.sha256(scene_bytes).hexdigest(),
            'note': 'Metadata regions are not certified physical rooms. Office/library labels do not certify a nonresidential building. Polygon area sum may overlap.'}


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    api = f'https://huggingface.co/api/datasets/hssd/hssd-hab/revision/{REVISION}'
    with urllib.request.urlopen(api, timeout=60) as response:
        repo = json.load(response)
    (ROOT/'repository.json').write_text(json.dumps(repo, ensure_ascii=False))
    paths = [f['rfilename'] for f in repo['siblings'] if f['rfilename'].startswith('scenes/') and f['rfilename'].endswith('.scene_instance.json')]
    rows = []; failures = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(describe,path): path for path in paths}
        for future in concurrent.futures.as_completed(futures):
            try:
                rows.append(future.result())
            except Exception as error:
                failures.append({'path': futures[future], 'type': type(error).__name__})
    rows.sort(key=lambda r:r['sceneId'])
    labels = sorted({label for row in rows for label in row['labels'] if label not in EXTERIOR})
    frequencies = {label: sum(label in row['labels'] for row in rows) for label in labels}
    def features(row):
        return [min(row['labels'].get(label,0),5)/5 for label in labels] + [math.log1p(row['indoorRegionCount'])/4, math.log1p(row['indoorAnnotatedAreaSum'])/8, math.log1p(row['objectInstances'])/8, min(len(row['floorLevels']),3)/3]
    vectors = {r['sceneId']: features(r) for r in rows}
    chosen = []; stages = set()
    # Cover rare room-label combinations before adding geometric extremes.
    covered = set()
    while len(chosen) < 20:
        available = [r for r in rows if r['stage'] not in stages]
        if not available:
            break
        def score(row):
            novelty = sum(1/math.sqrt(frequencies[label]) for label in row['indoorLabels'] if label not in covered)
            distance = min((sum((a-b)**2 for a,b in zip(vectors[row['sceneId']],vectors[c['sceneId']])) for c in chosen), default=0)
            return novelty+distance
        selected = max(available,key=score)
        chosen.append(selected); stages.add(selected['stage']); covered.update(selected['labels'])
    result = {'dataset':'hssd/hssd-hab','revision':REVISION,'license':'CC BY-NC 4.0','licenseUrl':'https://creativecommons.org/licenses/by-nc/4.0/',
              'licenseSource':'https://3dlg-hcvc.github.io/hssd/','auditedScenes':len(rows),'failures':failures,'labelSceneCounts':frequencies,
              'selectionRule':'Greedy room-label coverage plus feature diversity, unique stage handles, 20 metadata candidates; physical topology and visual distinctness require rendering review.',
              'selected':chosen,'allScenes':rows,'assetsDownloaded':False}
    (ROOT/'catalog.json').write_text(json.dumps(result, ensure_ascii=False, indent=2),encoding='utf-8')
    print(json.dumps({k:result[k] for k in ['auditedScenes','failures','labelSceneCounts','selected']},ensure_ascii=True,indent=2))


if __name__ == '__main__':
    main()
