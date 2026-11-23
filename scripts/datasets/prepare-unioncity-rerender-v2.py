"""Prepare source-preserving 2x presentation-clock rendering, nominal 1fps."""
import argparse
import bisect
import hashlib
import json
import math
from pathlib import Path


def angle(a, b, weight):
    return a + ((b - a + 180) % 360 - 180) * weight


def prepare(manual, end_ms, output, pilot=False, pilot_range=None):
    raw = (manual / 'trajectory.jsonl.txt').read_bytes()
    rows = [json.loads(line) for line in raw.decode('utf-8').splitlines() if line.strip()]
    origin = rows[0]['time_s']
    times = [row['time_s'] - origin for row in rows]
    if any(b <= a for a, b in zip(times, times[1:])):
        raise ValueError('Noncausal trajectory')
    start, end = tuple(pilot_range) if pilot_range else (368.0, 389.0) if pilot else (0.0, end_ms / 1000)
    if not 0 <= start < end <= times[-1]:
        raise ValueError('Pilot/source range outside original trajectory')
    pilot = pilot or pilot_range is not None
    samples = [start + i * .5 for i in range(math.floor((end - start) * 2) + 1)]
    if end - samples[-1] > 1e-6:
        samples.append(end)
    def pose(elapsed):
        right = bisect.bisect_left(times, elapsed)
        right = max(1, min(right, len(rows) - 1))
        left = right - 1
        if times[right] - times[left] > 1:
            raise ValueError('Trajectory gap: cannot invent poses')
        weight = max(0, min(1, (elapsed - times[left]) / (times[right] - times[left])))
        a, b = rows[left], rows[right]
        def vector(key):
            return [x + (y - x) * weight for x, y in zip(a[key], b[key])]
        return {'source_elapsed_s': elapsed, 'presentation_elapsed_s': elapsed * 2,
                      'player_position_source': vector('position_source'), 'eye_position_source': vector('eye_position_source'),
                      'eye_angles_pyr_deg': [angle(x, y, weight) for x, y in zip(a['eye_angles_pyr_deg'], b['eye_angles_pyr_deg'])],
                      'pose_interpolation': {'left_source_s': times[left], 'right_source_s': times[right], 'weight': weight}}
    steps = [{**pose(elapsed), 'kind': 'render', 'frame_id': i + 1} for i, elapsed in enumerate(samples)]
    input_raw = (manual / 'input_changes.jsonl.txt').read_bytes()
    inputs = [json.loads(line) for line in input_raw.decode('utf-8').splitlines() if line.strip()]
    use_events, last_down, initial_down = [], False, False
    for row in inputs:
        down = bool(row['buttons'] & 32)
        elapsed = row['time_s'] - origin
        if down != last_down:
            use_events.append({'elapsed_s': elapsed, 'down': down, 'recorded_target': row.get('target'), 'hit_position_source': row.get('hit_position_source')})
        if elapsed < start:
            initial_down = down
        last_down = down
    for ordinal, event in enumerate(use_events, 1):
        if start <= event['elapsed_s'] <= end:
            steps.append({**pose(event['elapsed_s']), 'kind': 'use', 'use_down': event['down'], 'use_edge_ordinal': ordinal,
                          'recorded_target': event['recorded_target'], 'recorded_hit_position': event['hit_position_source']})
    steps.sort(key=lambda s: (s['source_elapsed_s'], 0 if s['kind'] == 'use' else 1))
    result = {'schema': 'first-sight-route-render-v2', 'map': 'rp_unioncity_day',
              'source_recording': str(manual), 'trajectory_sha256': hashlib.sha256(raw).hexdigest(),
              'presentation_time_scale': 2, 'nominal_presentation_fps': 1,
              'source_clock_preserved': True, 'original_images_recovered': False,
              'dynamic_reconstruction_scope': 'All recorded E edges replayed through CUserCmd; apartment elevator pose/doors additionally reconstructed from trajectory, not certified original dynamic state',
              'input_sha256': hashlib.sha256(input_raw).hexdigest(), 'initial_use_down': initial_down,
              'original_use_press_count': sum(e['down'] for e in use_events),
              'expected_use_press_count': sum(s['kind'] == 'use' and s['use_down'] for s in steps),
              'expected_use_edges': sum(s['kind'] == 'use' for s in steps),
              'render_frames': len(samples), 'pilot': pilot, 'steps': steps,
              'elevator': {'name': 'aptbld2ele', 'initial_origin': [-2532, 984, 5500],
                           'recorded_lower_foot_z': 5435.0810546875, 'lower_origin_z': 5500,
                           'movement_start_s': 377.4, 'movement_end_s': 386.45,
                           'lower_open_start_s': 369.8, 'lower_open_end_s': 377.1,
                           'upper_open_start_s': 385.9, 'active_start_s': 369.8, 'active_end_s': 388.0,
                           'state_basis': 'Pose-derived reconstruction, not original per-frame dynamic state',
                           'doors': [
                               {'model': '*126', 'origin': [-2613, 958.5, 5494.5], 'group': 'lower', 'open_y': -46},
                               {'model': '*127', 'origin': [-2613, 1009.5, 5494.5], 'group': 'lower', 'open_y': 46},
                               {'model': '*129', 'origin': [-2606, 958.5, 5494.5], 'group': 'cab', 'open_y': -46},
                               {'model': '*130', 'origin': [-2606, 1009.5, 5494], 'group': 'cab', 'open_y': 46},
                               {'model': '*133', 'origin': [-2613, 958.5, 6334.5], 'group': 'upper', 'open_y': -46},
                               {'model': '*134', 'origin': [-2613, 1009.5, 6334.5], 'group': 'upper', 'open_y': 46}
                           ]}}
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf-8') as file:
        json.dump(result, file, ensure_ascii=False, indent=2)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manual-route', type=Path, required=True)
    parser.add_argument('--end-ms', type=int, default=405555)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--pilot', action='store_true')
    parser.add_argument('--pilot-range', type=float, nargs=2)
    args = parser.parse_args()
    result = prepare(args.manual_route, args.end_ms, args.output, args.pilot, args.pilot_range)
    print(json.dumps({'steps': len(result['steps']), 'renderFrames': result['render_frames'], 'useEdges': result['expected_use_edges'], 'usePresses': result['expected_use_press_count'], 'sourceSpanS': result['steps'][-1]['source_elapsed_s'] - result['steps'][0]['source_elapsed_s'], 'timeScale': 2, 'pilot': result['pilot'], 'output': str(args.output)}))
