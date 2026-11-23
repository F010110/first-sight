"""Validate a completed render/use audit and build an annotated, read-only viewer bundle."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
from PIL import Image, ImageStat, ImageDraw


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sha(payload):
    return hashlib.sha256(payload).hexdigest()


def publish(args):
    out, episode, base = Path(args.output).resolve(), Path(args.episode).resolve(), Path(args.base).resolve()
    if out.exists():
        raise ValueError('Never overwrite an existing sample')
    if shutil.disk_usage(out.parent).free < 20_000_000_000:
        raise ValueError('20GB reserve required')
    request_raw = Path(args.request).read_bytes()
    request = json.loads(request_raw)
    summary = read_json(episode / 'summary.json')
    observations = [json.loads(line) for line in (episode / 'observations.jsonl.txt').read_text().splitlines() if line.strip()]
    render_steps = [s for s in request['steps'] if s['kind'] == 'render']
    use_steps = [s for s in request['steps'] if s['kind'] == 'use']
    if summary['reason'] != 'completed' or len(observations) != request['render_frames'] or summary['actions'] != len(use_steps):
        raise ValueError('Incomplete render or E replay')
    audit_relative = observations[0]['elevator']['use_audit_path']
    if not audit_relative.startswith('first_sight/route_render_v2_use_') or '..' in audit_relative:
        raise ValueError('Invalid audit binding')
    audit_path = episode.parents[1] / audit_relative
    audit_summary = read_json(Path(str(audit_path) + '.summary.json'))
    if audit_summary['observed_press_count'] != request['expected_use_press_count'] or audit_summary['observed_edge_count'] != request['expected_use_edges']:
        raise ValueError('Not all E key transitions were observed by engine')
    audit = [json.loads(line) for line in audit_path.read_text().splitlines() if line.strip()]
    edges = [r for r in audit if r['kind'] in ('observed-key-press', 'observed-key-release')]
    if [(r['edge'], r['kind'] == 'observed-key-press') for r in edges] != [(s['use_edge_ordinal'], s['use_down']) for s in use_steps]:
        raise ValueError('E edge order differs from recording')
    current_edge = None
    used_models = {}
    for event in audit:
        if event['kind'] == 'observed-key-press':
            current_edge = event['edge']
            used_models.setdefault(current_edge, set())
        elif event['kind'] == 'observed-key-release':
            current_edge = None
        elif event['kind'] == 'player-use' and current_edge:
            used_models[current_edge].add((event.get('actual_target') or {}).get('model'))
    for step in use_steps:
        expected_model = (step.get('recorded_target') or {}).get('model')
        if step['use_down'] and expected_model and expected_model not in used_models.get(step['use_edge_ordinal'], set()):
            raise ValueError(f"Recorded E target missing at edge {step['use_edge_ordinal']}: {expected_model}")
    original = read_json(base / 'sample.json')
    integrity = read_json(base / 'integrity.json')
    if sha((base / 'sample.json').read_bytes()) != integrity['sampleSHA256']:
        raise ValueError('Annotation baseline changed')
    reviews = [read_json(p) for p in sorted((base / 'reviews').glob('review-*.json'))]
    latest = {}
    for review in reviews:
        if review['datasetSHA256'] != integrity['sampleSHA256']:
            raise ValueError('Foreign review revision')
        latest[(review['targetType'], review['targetId'])] = review
    segments = []
    old_segments = original['segments']
    boundaries = [(original['frames'][s['startIndex'] - 1]['atMs'], s['startMs']) for s in old_segments[1:]]
    for s in old_segments:
        review = latest.get(('segment', s['id']), {})
        title = review.get('correctedLabel') or s['title']
        if s['id'] == 'segment-039':
            title = '公寓楼电梯轿厢（同步重建）'
        segment = {**s, 'title': title, 'status': 'annotation-complete', 'sourceStartMs': s['startMs'], 'sourceEndMs': s['endMs'],
                   'startIndex': None, 'endIndex': None, 'annotationAuthority': 'Assistant finalized, using user naming feedback and rerender validation; not new human review'}
        if s['id'] == 'segment-039':
            segment.update(kind='室内', placeId='apartment-elevator-cab', inventory='随轨迹同步的轿厢、金属门、按钮、扶手和照明；这是动态重建，不是恢复原始录像。')
        segments.append(segment)
    layer_map = original['map']
    b = layer_map['bounds']
    scale = min((b['width'] - 60) / (b['maxX'] - b['minX']), (b['height'] - 60) / (b['maxY'] - b['minY']))
    def project(p):
        return [30 + (p[0] - b['minX']) * scale, b['height'] - 30 - (p[1] - b['minY']) * scale]
    out.mkdir()
    image_root = out / 'model-png'
    image_root.mkdir()
    frames, bindings, public_source, public_presentation, qc = [], {}, [], [], []
    total_bytes = 0
    for ordinal, (row, step) in enumerate(zip(observations, render_steps)):
        if row['id'] != ordinal + 1 or abs(row['source_elapsed_s'] - step['source_elapsed_s']) > 1e-5 or abs(row['presentation_elapsed_s'] - step['presentation_elapsed_s']) > 1e-5:
            raise ValueError('Frame/clock binding mismatch')
        source_ms = round(step['source_elapsed_s'] * 1000)
        presentation_ms = round(step['presentation_elapsed_s'] * 1000)
        source_candidates = [i for i, (lo, hi) in enumerate(boundaries, 1) if lo < source_ms < hi]
        segment_index = min(range(len(old_segments)), key=lambda i: 0 if old_segments[i]['startMs'] <= source_ms <= old_segments[i]['endMs'] else min(abs(source_ms - old_segments[i]['startMs']), abs(source_ms - old_segments[i]['endMs'])))
        segment = segments[segment_index]
        if segment['startIndex'] is None:
            segment['startIndex'], segment['startMs'] = ordinal, presentation_ms
        segment['endIndex'], segment['endMs'] = ordinal, presentation_ms
        frame_id = f'rerender-v2-{ordinal + 1:06d}'
        views, model_views, stats = {}, [], []
        for direction in ('front', 'left', 'right'):
            path = episode / row['views'][direction]
            if not path.resolve().is_relative_to(episode):
                raise ValueError('Image outside episode')
            with Image.open(path) as image:
                image.load()
                rgb = image.convert('RGB')
            if rgb.size != (640, 480):
                raise ValueError('Unexpected original dimensions')
            gray = rgb.convert('L')
            stats.append({'view': direction, 'meanLuma': ImageStat.Stat(gray).mean[0], 'nearBlackFraction': sum(gray.histogram()[:6]) / (640 * 480)})
            png_path = image_root / f'{frame_id}-{direction}.png'
            rgb.save(png_path, compress_level=3)
            payload = png_path.read_bytes()
            total_bytes += len(payload)
            if total_bytes > 1_500_000_000 or shutil.disk_usage(out).free < 20_000_000_000:
                raise ValueError('Bounded asset/reserve limit')
            key = frame_id + '/' + direction
            bindings[key] = {'path': str(png_path), 'sha256': sha(payload)}
            views[direction] = '/image/' + key
            model_views.append({'direction': direction, 'path': str(png_path), 'sha256': sha(payload)})
        telemetry = row['elevator']
        if telemetry['active']:
            if math.dist(telemetry['client_cab_position'], telemetry['expected_cab']) > 1:
                raise ValueError('Cab client state was not synchronized')
            if telemetry.get('client_light_position') is None or math.dist(telemetry['client_light_position'], telemetry['expected_light']) > 1:
                raise ValueError('Moving elevator light was not synchronized')
        if 380000 <= source_ms <= 384500 and any(s['meanLuma'] <= 5 for s in stats):
            raise ValueError('Elevator black-frame repair failed')
        near_black = all(s['meanLuma'] < 5 for s in stats)
        reference = min(original['frames'], key=lambda f: abs(f['atMs'] - source_ms))
        reference_review = latest.get(('observation', reference['id']), {})
        description = f"{segment['title']}。"
        if source_candidates:
            previous, following = segments[source_candidates[0] - 1], segments[source_candidates[0]]
            description = f"过渡区间：{previous['title']} ↔ {following['title']}。原采样仅给出边界范围，不虚构精确入室或开门时刻。"
        if segment['id'] == 'segment-039':
            description = '公寓楼电梯轿厢内；轿厢、门与随行灯已同步重建，可见内容以本次三摄为准。重建依据原轨迹，不是原始录像恢复。'
        facility = 'cafe' if segment['id'] in ('segment-025', 'segment-026') else 'apartment-aptbld2' if segment_index >= 35 else segment['placeId']
        frame = {'index': ordinal, 'id': frame_id, 'atMs': presentation_ms, 'sourceAtMs': source_ms, 'views': views,
                 'position': step['player_position_source'], 'angles': step['eye_angles_pyr_deg'], 'mapPoint': project(step['player_position_source']),
                 'layerId': next((l['id'] for l in layer_map['layers'] if l['minZ'] <= step['player_position_source'][2] < l['maxZ']), 'street'),
                 'annotation': {'segmentId': segment['id'], 'placeId': segment['placeId'], 'facilityId': facility, 'description': description,
                                'status': 'annotation-complete', 'visibility': 'uncertain' if near_black else 'limited' if source_candidates else 'clear',
                                'boundaryUncertain': bool(source_candidates), 'objectInventoryScope': 'Segment-level inventory; not exhaustive per-frame object presence',
                                'referenceAnnotation': {'sourceFrameId': reference['id'], 'sourceAtMs': reference['atMs'], 'description': reference_review.get('correctedDescription', reference['annotation']['description']),
                                                        'scope': 'Original manually inspected nearby keyframe, NOT a claim that every object remains visible at this interpolated pose'}}}
        frames.append(frame)
        qc.append({'id': frame_id, 'sourceAtMs': source_ms, 'views': stats, 'elevatorActive': telemetry['active']})
        public_source.append({'id': frame_id, 'scene': 'scene-01', 'atMs': source_ms, 'views': model_views})
        public_presentation.append({'id': frame_id, 'scene': 'scene-01', 'atMs': presentation_ms, 'sourceAtMs': source_ms, 'views': model_views})
    if any(s['startIndex'] is None for s in segments):
        raise ValueError('An annotation segment disappeared')
    presses = []
    active_edge = None
    targets = {}
    for event in audit:
        if event['kind'] == 'observed-key-press':
            active_edge = event['edge']
            targets.setdefault(active_edge, [])
        elif event['kind'] == 'observed-key-release':
            active_edge = None
        elif event['kind'] == 'player-use' and active_edge:
            target = event.get('actual_target')
            if target and target not in targets[active_edge]:
                targets[active_edge].append(target)
    for step in use_steps:
        if not step['use_down']:
            continue
        recorded = step.get('recorded_target')
        observed = targets.get(step['use_edge_ordinal'], [])
        expected_model = recorded.get('model') if recorded else None
        presses.append({'id': f"use-{len(presses) + 1:03d}", 'sourceAtMs': round(step['source_elapsed_s'] * 1000), 'atMs': round(step['presentation_elapsed_s'] * 1000),
                        'originalEdgeOrdinal': step['use_edge_ordinal'], 'keyPressObserved': True, 'recordedTarget': recorded,
                        'actualTargets': observed, 'targetModelMatched': any(t.get('model') == expected_model for t in observed) if expected_model else None,
                        'interactionSuccessVerified': False, 'scope': 'E input verified; target and effects are separate, not every press is a certified successful interaction'})
    if any(p['targetModelMatched'] is False for p in presses):
        raise ValueError('Recorded known E target was not used; preserve failed candidate, do not publish as complete replay')
    for press in presses:
        press['recordedTargetSelectionBindingApplied'] = any(e['kind'] == 'recorded-target-binding' and e.get('edge') == press['originalEdgeOrdinal'] for e in audit)
        press['adjacentTargetBlocked'] = any(e['kind'] == 'blocked-adjacent-use-target' and e.get('edge') == press['originalEdgeOrdinal'] for e in audit)
    revisits = []
    for r in original['revisits']:
        first = min(frames, key=lambda f: abs(f['sourceAtMs'] - r['firstMs']))
        returned = min(frames, key=lambda f: abs(f['sourceAtMs'] - r['returnMs']))
        revisits.append({**r, 'firstIndex': first['index'], 'returnIndex': returned['index'], 'firstMs': first['atMs'], 'returnMs': returned['atMs'], 'status': 'annotation-complete', 'distanceSourceUnits': math.dist(first['position'], returned['position'])})
    for layer in layer_map['layers']:
        shutil.copyfile(base / f"map-{layer['id']}.png", out / f"map-{layer['id']}.png")
    bundle = {'schema': 'unioncity-annotation-review-v1', 'id': 'unioncity-rerender-v2', 'title': 'UnionCity · 修复重渲染样本（2倍时长／约1fps）',
              'reviewRequired': False, 'durationMs': frames[-1]['atMs'], 'sourceDurationMs': frames[-1]['sourceAtMs'],
              'provenance': {**original['provenance'], 'requestSHA256': sha(request_raw), 'sourceClockPreserved': True, 'presentationTimeScale': 2,
                             'nominalPresentationFPS': 1, 'notComparableToOriginalRateRealtimeTest': True, 'basedOnReviewRevision': reviews[-1]['revision'] if reviews else 0,
                             'newlyRendered': True, 'dynamicStateReconstructed': 'apartment elevator only, pose-derived', 'EInputReplayed': audit_summary,
                             'questionsCreated': 0, 'modelCallsForAnnotation': 0, 'author': 'Assistant completed region, facility, boundary, revisit and E-input annotations; exact dynamic state is inferred'},
              'limitations': ['新播放时钟为原始源时间的2倍，保留源时钟；这个慢速版本不能替换旧原速实时试验成绩。',
                              '全部E按下/释放经引擎核对；输入已重放不等于每次交互成功，目标不匹配和未知均保留。',
                              '电梯轿厢/门/随行灯按轨迹同步重建，不是原始逐帧动态状态或原录像恢复。',
                              '已补齐场所、建筑归属、区域分段、边界不确定性、重访与E事件标注；物品清单是段级，不是穷举逐帧物体真值。',
                              '此版无需再次审核；邻近旧关键帧描述仅作参考，不强行断言插值新视点看到相同全部物品。',
                              'BSP底图是水平朝上表面投影，不是可通行图。坐标/地图/标注仅供审核评分，不进入视觉模型输入。'],
              'frames': frames, 'segments': segments, 'revisits': revisits, 'events': [], 'actions': presses, 'map': layer_map}
    raw = json.dumps(bundle, ensure_ascii=False, indent=2).encode('utf-8')
    (out / 'sample.json').write_bytes(raw)
    (out / 'bindings.json').write_text(json.dumps({'allowedImageRoot': str(image_root), 'bindings': bindings}, indent=2), encoding='utf-8')
    (out / 'integrity.json').write_text(json.dumps({'sampleSHA256': sha(raw), 'maps': {l['id']: sha((out / f"map-{l['id']}.png").read_bytes()) for l in layer_map['layers']}}, indent=2))
    for name, clock, data in [('public-source.json', 'original-source', public_source), ('public-presentation.json', 'user-authorized-2x', public_presentation)]:
        (out / name).write_text(json.dumps({'schema': 'spatial-public-input-v1', 'clock': clock, 'presentationTimeScale': 2, 'observations': data}, ensure_ascii=False, indent=2))
    (out / 'render-qc.json').write_text(json.dumps({'complete': True, 'frames': len(frames), 'useAudit': audit_summary, 'unexpectedBlackInRepairedElevator': 0, 'assetBytes': total_bytes, 'qc': qc}, indent=2))
    shutil.copyfile(audit_path, out / 'use-audit.jsonl')
    shutil.copyfile(Path(str(audit_path) + '.summary.json'), out / 'use-audit-summary.json')
    shutil.copyfile(episode / 'observations.jsonl.txt', out / 'render-telemetry.jsonl')
    selected = [min(range(len(frames)), key=lambda i: abs(frames[i]['sourceAtMs'] - t)) for t in (372000, 376000, 380000, 382000, 384000, 386000, 388000)]
    sheet = Image.new('RGB', (960, len(selected) * 204), 'white')
    draw = ImageDraw.Draw(sheet)
    for i, index in enumerate(selected):
        frame = frames[index]
        for j, direction in enumerate(('front', 'left', 'right')):
            with Image.open(bindings[frame['id'] + '/' + direction]['path']) as image:
                sheet.paste(image.resize((320, 180)), (j * 320, i * 204))
        draw.text((4, i * 204 + 184), f"frame={index + 1} source={frame['sourceAtMs']/1000}s presentation={frame['atMs']/1000}s", fill='black')
    sheet.save(out / 'elevator-validation.jpg', quality=94)
    print(json.dumps({'output': str(out), 'frames': len(frames), 'segments': len(segments), 'EPresses': len(presses), 'EEdges': audit_summary['observed_edge_count'], 'sourceSeconds': frames[-1]['sourceAtMs'] / 1000, 'presentationSeconds': frames[-1]['atMs'] / 1000, 'assetBytes': total_bytes, 'modelCalls': 0}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('request', 'episode', 'base', 'output'):
        parser.add_argument('--' + name, required=True)
    publish(parser.parse_args())
