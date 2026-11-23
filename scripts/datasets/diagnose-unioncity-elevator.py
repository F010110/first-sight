"""Read-only offline diagnosis of the rerendered apartment-elevator interval."""
import argparse
import hashlib
import json
import math
import struct
from pathlib import Path
from PIL import Image, ImageStat


def diagnose(args):
    output = Path(args.output)
    if output.exists():
        raise ValueError('Use a new output path')
    bsp_bytes = Path(args.bsp).read_bytes()
    if bsp_bytes[:4] != b'VBSP':
        raise ValueError('Not a Source BSP')
    def lump(i):
        start, size, version, compressed = struct.unpack_from('<4i', bsp_bytes, 8 + i * 16)
        if compressed or start < 0 or start + size > len(bsp_bytes):
            raise ValueError('Unsupported BSP lump')
        return memoryview(bsp_bytes)[start:start + size], version
    models, _ = lump(14)
    nodes, _ = lump(5)
    leaves, leaf_version = lump(10)
    planes, _ = lump(1)
    if leaf_version != 1:
        raise ValueError('Only dleaf v1 supported')
    def contents(point):
        node = struct.unpack_from('<i', models, 36)[0]
        for _ in range(200):
            if node < 0:
                return struct.unpack_from('<i', leaves, (-1 - node) * 32)[0]
            plane, front, back = struct.unpack_from('<3i', nodes, node * 32)
            x, y, z, distance = struct.unpack_from('<4f', planes, plane * 20)
            node = front if x * point[0] + y * point[1] + z * point[2] - distance >= 0 else back
        raise ValueError('BSP traversal bound exceeded')
    entities = json.loads(Path(args.entities).read_text(encoding='utf-8'))
    elevator = next(e for e in entities if e.get('targetname') == 'aptbld2ele')
    related = [e for e in entities if e.get('targetname', '').startswith('aptbld2ele') or e.get('parentname') == 'aptbld2ele']
    selected = [{k: e[k] for k in ('classname', 'targetname', 'parentname', 'origin', 'model', 'target', 'hammerid') if k in e} for e in related]
    model_number = int(elevator['model'][1:])
    model = struct.unpack_from('<9f3i', models, model_number * 48)
    origin = list(map(float, elevator['origin'].split()))
    bounds = {'min': [origin[i] + model[i] for i in range(3)], 'max': [origin[i] + model[i + 3] for i in range(3)]}
    render = json.loads(Path(args.render_request).read_text())
    rows = []
    for display_frame in range(175, 184):
        render_index = (display_frame - 1) * 2
        step = render['steps'][render_index]
        stats = []
        for view in ('front', 'left', 'right'):
            png_path = Path(args.png_root) / f'observation-{render_index + 1:06d}-{view}.png'
            jpg_path = Path(args.render_episode) / view / f'{render_index + 1:06d}.jpg'
            with Image.open(png_path) as image:
                png = image.convert('RGB')
            with Image.open(jpg_path) as image:
                jpg = image.convert('RGB')
            gray = png.convert('L')
            histogram = gray.histogram()
            stats.append({'view': view, 'meanLuma': ImageStat.Stat(gray).mean[0],
                          'fractionLumaLE5': sum(histogram[:6]) / (png.width * png.height),
                          'jpegPNGDecodedPixelsEqual': png.tobytes() == jpg.tobytes(),
                          'pngSHA256': hashlib.sha256(png_path.read_bytes()).hexdigest()})
        rows.append({'displayFrame': display_frame, 'renderFrame': render_index + 1,
                     'sourceMs': round(step['source_elapsed_s'] * 1000),
                     'playerPosition': step['player_position_source'], 'eyePosition': step['eye_position_source'],
                     'staticWorldContents': contents(step['eye_position_source']),
                     'eyeAboveInitialCabTopUnits': step['eye_position_source'][2] - bounds['max'][2], 'views': stats})
    trajectory = [json.loads(line) for line in (Path(args.manual_route) / 'trajectory.jsonl.txt').read_text().splitlines() if line.strip()]
    t0 = trajectory[0]['time_s']
    samples = []
    for elapsed in (375.9, 378.0, 380.1, 382.25, 384.35, 386.45):
        row = min(trajectory, key=lambda r: abs(r['time_s'] - t0 - elapsed))
        samples.append({'elapsedS': row['time_s'] - t0, **{k: row[k] for k in ('position_source', 'on_ground', 'move_type')}})
    result = {'schema': 'unioncity-elevator-offline-diagnosis-v1', 'modelCalls': 0, 'gameLaunched': False,
              'finding': 'Strong evidence of unsynchronized dynamic elevator state in pose-only rerender; not PNG conversion damage. No original images or per-frame rerender entity states exist, so exact runtime state is not directly observed.',
              'apartmentEntityEvidence': selected, 'initialCabWorldBounds': bounds, 'frames': rows,
              'originalTrajectorySamples': samples, 'staticBSPHash': hashlib.sha256(bsp_bytes).hexdigest(),
              'limits': ['Static world contents exclude moving brush entities.', 'Cab bounds are initial BSP placement, not measured rerender-time placement.', 'Original manual recording contains no images; original view cannot be recovered.', 'No deletion, frame replacement or fabricated reconstruction performed.']}
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf-8') as file:
        json.dump(result, file, ensure_ascii=False, indent=2)
    print(json.dumps({'output': str(output), 'checkedDisplayFrames': [175, 183], 'nearlyBlackFrames': [r['displayFrame'] for r in rows if all(v['meanLuma'] < 5 for v in r['views'])], 'allConversionPixelsEqual': all(v['jpegPNGDecodedPixelsEqual'] for r in rows for v in r['views']), 'apartmentElevator': elevator['targetname'], 'modelCalls': 0}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('bsp', 'entities', 'render-request', 'png-root', 'render-episode', 'manual-route', 'output'):
        parser.add_argument('--' + name, required=True)
    diagnose(parser.parse_args())
