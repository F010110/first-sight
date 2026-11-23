"""Build a local, oracle-only annotation review bundle. No model calls/game launch."""
import argparse
import hashlib
import json
import math
import shutil
import struct
from pathlib import Path
from PIL import Image, ImageDraw


def digest(payload):
    return hashlib.sha256(payload).hexdigest()


def floor_surfaces(path):
    data = path.read_bytes()
    if data[:4] != b'VBSP' or struct.unpack_from('<i', data, 4)[0] != 20:
        raise ValueError('Expected Source BSP v20')
    def lump(index):
        start, length, _, compressed = struct.unpack_from('<4i', data, 8 + index * 16)
        if compressed or start < 0 or start + length > len(data):
            raise ValueError('Unsupported/truncated BSP lump')
        return memoryview(data)[start:start + length]
    vertices, planes, faces, edges, surfedges, models = (lump(i) for i in (3, 1, 7, 12, 13, 14))
    first, count = struct.unpack_from('<2i', models, 40)
    result = []
    for face_index in range(first, first + count):
        offset = face_index * 56
        plane, side = struct.unpack_from('<HB', faces, offset)
        normal_z = struct.unpack_from('<f', planes, plane * 20 + 8)[0] * (-1 if side else 1)
        if normal_z < .95:
            continue
        edge_start, edge_count = struct.unpack_from('<ih', faces, offset + 4)
        if not 3 <= edge_count <= 256:
            continue
        points = []
        for i in range(edge_count):
            edge = struct.unpack_from('<i', surfedges, (edge_start + i) * 4)[0]
            a, b = struct.unpack_from('<2H', edges, abs(edge) * 4)
            points.append(struct.unpack_from('<3f', vertices, (a if edge >= 0 else b) * 12))
        if max(p[2] for p in points) - min(p[2] for p in points) <= 4:
            result.append(points)
    return result, digest(data)


def build(args):
    out = Path(args.output).resolve()
    if out.exists():
        raise ValueError('Use a new output root; never overwrite a review')
    if shutil.disk_usage(out.parent).free < 20 * 1024 ** 3:
        raise ValueError('At least 20GiB free required')
    raw = Path(args.input).read_bytes()
    rows = json.loads(raw)['observations']
    source = json.loads(Path(args.annotations).read_text(encoding='utf-8'))
    render_raw = Path(args.render_request).read_bytes()
    render = json.loads(render_raw)
    steps = render['steps']
    if len(rows) != 192 or len(source['observationNotes']) != len(rows):
        raise ValueError(f"Expected 192 observations and notes: {len(rows)}, {len(source['observationNotes'])}")
    assignment = {}
    segments = []
    for n, (start, end, place, title, kind, inventory) in enumerate(source['segments']):
        if not 0 <= start <= end < len(rows):
            raise ValueError('Invalid segment range')
        segment = {'id': f'segment-{n + 1:03}', 'startIndex': start, 'endIndex': end,
                   'startMs': rows[start]['atMs'], 'endMs': rows[end]['atMs'], 'placeId': place,
                   'title': title, 'kind': kind, 'inventory': inventory,
                   'status': 'pending-user-review', 'inventoryScope': 'Visible somewhere in this segment, NOT a per-frame visibility assertion',
                   'boundaryScope': 'Boundary lies between adjacent sampled observations, not a certified door/action instant'}
        segments.append(segment)
        for i in range(start, end + 1):
            if i in assignment:
                raise ValueError('Overlapping segments')
            assignment[i] = segment
    if len(assignment) != len(rows):
        raise ValueError('Unannotated observations')
    allowed_root = Path(rows[0]['views'][0]['path']).resolve().parent
    frames, bindings = [], {}
    for i, row in enumerate(rows):
        step = min(steps, key=lambda s: abs(s['source_elapsed_s'] * 1000 - row['atMs']))
        if abs(step['source_elapsed_s'] * 1000 - row['atMs']) > 2:
            raise ValueError('Pose/image clock mismatch')
        views = {}
        if {v['direction'] for v in row['views']} != {'front', 'left', 'right'} or len(row['views']) != 3:
            raise ValueError('Need exactly three independent views')
        for view in row['views']:
            path = Path(view['path']).resolve()
            if not path.is_relative_to(allowed_root) or digest(path.read_bytes()) != view['sha256']:
                raise ValueError('Changed/out-of-root original image')
            key = f"{row['id']}/{view['direction']}"
            bindings[key] = {'path': str(path), 'sha256': view['sha256']}
            views[view['direction']] = '/image/' + key
        if len({v['path'] for v in row['views']}) != 3:
            raise ValueError('Duplicated view paths')
        segment = assignment[i]
        note = source['observationNotes'][i]
        frames.append({'index': i, 'id': row['id'], 'atMs': row['atMs'], 'views': views,
                       'position': step['player_position_source'], 'angles': step['eye_angles_pyr_deg'],
                       'annotation': {'segmentId': segment['id'], 'placeId': segment['placeId'],
                                      'description': note, 'visibility': 'uncertain' if i in range(175, 182) else 'limited' if i in [16, 21, 39, 45, 56, 57, 62, 67, 73, 78, 79, 80, 81, 91, 114, 115, 116, 145, 148, 153, 154, 183] else 'clear',
                                      'status': 'pending-user-review'}})
    bounds = {'minX': min(f['position'][0] for f in frames) - 700, 'maxX': max(f['position'][0] for f in frames) + 700,
              'minY': min(f['position'][1] for f in frames) - 700, 'maxY': max(f['position'][1] for f in frames) + 700,
              'width': 1100, 'height': 780, 'padding': 30}
    def project(point):
        scale = min((bounds['width'] - 60) / (bounds['maxX'] - bounds['minX']), (bounds['height'] - 60) / (bounds['maxY'] - bounds['minY']))
        return [30 + (point[0] - bounds['minX']) * scale, bounds['height'] - 30 - (point[1] - bounds['minY']) * scale]
    layers = [{'id': 'platform', 'title': '地铁站台高度层', 'minZ': 4750, 'maxZ': 4900},
              {'id': 'concourse', 'title': '地下闸机／楼梯高度层', 'minZ': 4900, 'maxZ': 5310},
              {'id': 'street', 'title': '街面／首层／店后间', 'minZ': 5310, 'maxZ': 5800},
              {'id': 'upper', 'title': '上层房间／屋顶高度层', 'minZ': 5800, 'maxZ': 6600}]
    surfaces, bsp_hash = floor_surfaces(Path(args.bsp))
    entities = json.loads(Path(args.entities).read_text(encoding='utf-8'))
    doors = []
    for entity in entities:
        if 'door' not in entity.get('classname', '') or not entity.get('origin'):
            continue
        try:
            position = list(map(float, entity['origin'].split()))
        except ValueError:
            continue
        if len(position) == 3 and bounds['minX'] <= position[0] <= bounds['maxX'] and bounds['minY'] <= position[1] <= bounds['maxY']:
            doors.append({'position': position, 'class': entity['classname'], 'hammerId': entity.get('hammerid'), 'scope': 'Static entity origin, not verified traversal or door state'})
    out.mkdir()
    for layer in layers:
        image = Image.new('RGB', (bounds['width'], bounds['height']), '#101a28')
        draw = ImageDraw.Draw(image)
        count = 0
        for polygon in surfaces:
            z = sum(p[2] for p in polygon) / len(polygon)
            if not layer['minZ'] <= z < layer['maxZ']:
                continue
            if max(p[0] for p in polygon) < bounds['minX'] or min(p[0] for p in polygon) > bounds['maxX'] or max(p[1] for p in polygon) < bounds['minY'] or min(p[1] for p in polygon) > bounds['maxY']:
                continue
            draw.polygon([tuple(project(p)) for p in polygon], fill='#26394d', outline='#526c82')
            count += 1
        layer['surfaces'] = count
        layer['url'] = f"/map/{layer['id']}.png"
        image.save(out / f"map-{layer['id']}.png")
    for frame in frames:
        frame['mapPoint'] = project(frame['position'])
        frame['layerId'] = next((l['id'] for l in layers if l['minZ'] <= frame['position'][2] < l['maxZ']), 'street')
    revisits = source['revisits']
    for r in revisits:
        a, b = frames[r['firstIndex']], frames[r['returnIndex']]
        r['firstMs'], r['returnMs'] = a['atMs'], b['atMs']
        r['distanceSourceUnits'] = math.dist(a['position'], b['position'])
    events = [{'id': 'boundary-' + s['id'], 'fromIndex': s['startIndex'] - 1, 'toIndex': s['startIndex'],
               'type': 'visual-segment-transition', 'status': 'pending-user-review',
               'interactionSuccess': None, 'scope': 'Viewpoint transition in new rendering, NOT a verified original interaction'} for s in segments[1:]]
    bundle = {'schema': 'unioncity-annotation-review-v1', 'id': 'unioncity-route-v1', 'title': 'UnionCity · 完整路线数据标注审核',
              'provenance': {'inputSHA256': digest(raw), 'renderRequestSHA256': digest(render_raw), 'annotationSHA256': digest(Path(args.annotations).read_bytes()),
                             'bspSHA256': bsp_hash, 'newlyRendered': True, 'originalFootageRecovered': False, 'dynamicStateReconstructed': False,
                             'modelCallsForAnnotation': 0, 'author': source['author'], 'questionsCreated': 0, 'oracleOnly': True},
              'limitations': ['这是沿原轨迹重新渲染的样本，不是当时原始录像。', '门和动态物品状态没有重建，不能认定成功开门、取放物品或正常乘梯。',
                              'BSP底图是各高度层朝上水平表面投影，不是经过验证的可通行图或完整语义房间图。', '所有标注均待用户审核；段内物品清单不代表每帧都可见。', '坐标、底图和审核结果仅供标注/评分，不作为助手视觉输入。'],
              'durationMs': frames[-1]['atMs'], 'frames': frames, 'segments': segments, 'revisits': revisits, 'events': events,
              'map': {'bounds': bounds, 'layers': layers, 'doors': doors}}
    sample_raw = json.dumps(bundle, ensure_ascii=False, indent=2).encode('utf-8')
    (out / 'sample.json').write_bytes(sample_raw)
    (out / 'bindings.json').write_text(json.dumps({'allowedImageRoot': str(allowed_root), 'bindings': bindings}, indent=2), encoding='utf-8')
    (out / 'integrity.json').write_text(json.dumps({'sampleSHA256': digest(sample_raw), 'maps': {l['id']: digest((out / f"map-{l['id']}.png").read_bytes()) for l in layers}}, indent=2), encoding='utf-8')
    print(json.dumps({'out': str(out), 'observations': len(frames), 'segments': len(segments), 'revisits': len(revisits), 'events': len(events), 'floorSurfaces': [l['surfaces'] for l in layers], 'modelCalls': 0}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--annotations', required=True)
    parser.add_argument('--render-request', required=True)
    parser.add_argument('--bsp', required=True)
    parser.add_argument('--entities', required=True)
    parser.add_argument('--output', required=True)
    build(parser.parse_args())
