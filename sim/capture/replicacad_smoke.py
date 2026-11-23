"""ReplicaCAD render smoke: real scene, independent views, private pose oracle.

This is NOT a realistic daily-life benchmark. No room labels or QA are invented.
Uses existing public assets; never mutates them or invokes a model.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path


def sample_polyline(points, spacing=0.25):
    if not math.isfinite(spacing) or spacing <= 0:
        raise ValueError('Positive finite spacing required')
    samples = []
    for a, b in zip(points, points[1:]):
        length = math.dist(a, b)
        if length < 1e-6:
            continue
        steps = max(1, math.ceil(length / spacing))
        yaw = math.atan2(-(b[0] - a[0]), -(b[2] - a[2]))
        for index in range(steps):
            t = index / steps
            samples.append(([float(x + t * (y - x)) for x, y in zip(a, b)], yaw))
    if samples:
        samples.append(([float(v) for v in points[-1]], samples[-1][1]))
    return samples


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--scene', default='apt_1')
    parser.add_argument('--egl-default-device', action='store_true', help='WSL EGL default device; record actual GL renderer')
    parser.add_argument('--long-horizon-hours', type=float, default=0, help='Sparse synthetic revisit timeline, not continuous recording or simulated human activities')
    parser.add_argument('--travel-fps', type=float, default=15, help='Long-horizon movement render rate (default 15); stationary periods remain sparse')
    args = parser.parse_args()
    if not math.isfinite(args.long_horizon_hours) or args.long_horizon_hours < 0 or args.long_horizon_hours > 168:
        parser.error('Long horizon must be between 0 and 168 hours')
    if not math.isfinite(args.travel_fps) or not .5 <= args.travel_fps <= 30:
        parser.error('Travel FPS must be between 0.5 and 30')
    import habitat_sim
    import magnum as mn
    from habitat_sim.utils.common import quat_from_angle_axis
    import numpy as np
    from PIL import Image

    root = args.output.resolve()
    root.mkdir(parents=True, exist_ok=False)
    public, private = root / 'public', root / 'private'
    (public / 'frames').mkdir(parents=True)
    private.mkdir()
    plan = {'schema': 'replicacad-render-smoke-v1', 'scene': args.scene, 'seed': 11,
            'datasetConfigSha256': hashlib.sha256((args.dataset / 'replicaCAD.scene_dataset_config.json').read_bytes()).hexdigest(),
            'scoreEligible': False, 'paidCalls': 0, 'purpose': 'sparse long-horizon spatial revisits' if args.long_horizon_hours else 'render/navigation smoke only; not life-event or room truth',
            'longHorizonHours': args.long_horizon_hours, 'travelFps': args.travel_fps if args.long_horizon_hours else None}
    plan['sourceCodeSha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    plan['collectionReceiptSha256'] = hashlib.sha256((args.dataset.parent / 'receipt.json').read_bytes()).hexdigest()
    (private / 'plan.json').write_text(json.dumps(plan, indent=2))
    sim = None
    try:
        cfg = habitat_sim.SimulatorConfiguration()
        cfg.scene_dataset_config_file = str((args.dataset / 'replicaCAD.scene_dataset_config.json').resolve())
        cfg.scene_id = args.scene
        cfg.enable_physics = True
        cfg.gpu_device_id = -1 if args.egl_default_device else 0
        specs = []
        for name, yaw in [('front', 0), ('left', math.pi / 3), ('right', -math.pi / 3)]:
            spec = habitat_sim.CameraSensorSpec()
            spec.uuid = name
            spec.sensor_type = habitat_sim.SensorType.COLOR
            spec.resolution = [480, 640]
            spec.position = mn.Vector3(0, 1.6, 0)
            spec.orientation = mn.Vector3(0, yaw, 0)
            spec.hfov = mn.Deg(90)
            specs.append(spec)
        agent_cfg = habitat_sim.agent.AgentConfiguration()
        agent_cfg.sensor_specifications = specs
        sim = habitat_sim.Simulator(habitat_sim.Configuration(cfg, [agent_cfg]))
        import ctypes
        gl = ctypes.CDLL('libOpenGL.so.0')
        gl.glGetString.restype = ctypes.c_char_p
        renderer = gl.glGetString(0x1F01)
        renderer = renderer.decode() if renderer else 'unknown'
        if not sim.pathfinder.is_loaded:
            dataset_config = json.loads((args.dataset / 'replicaCAD.scene_dataset_config.json').read_text())
            navmesh = dataset_config.get('navmesh_instances', {}).get(args.scene)
            if not navmesh or not sim.pathfinder.load_nav_mesh(str((args.dataset / navmesh).resolve())):
                raise ValueError('No supplied scene navmesh loaded')
            (private / 'navmesh-binding.json').write_text(json.dumps({'scene': args.scene, 'sourcePath': navmesh,
                'sha256': hashlib.sha256((args.dataset / navmesh).read_bytes()).hexdigest(),
                'note': 'Scene alias was unavailable; explicitly loaded original dataset mapping. No navmesh regeneration.'}, indent=2))
        sim.pathfinder.seed(11)
        start = sim.pathfinder.get_random_navigable_point()
        paths = []
        for _ in range(40):
            path = habitat_sim.ShortestPath()
            path.requested_start = start
            path.requested_end = sim.pathfinder.get_random_navigable_point()
            if sim.pathfinder.find_path(path) and path.geodesic_distance >= 3:
                paths.append(path)
        if not paths:
            raise ValueError('No nontrivial connected route; do not fabricate a route')
        route = max(paths, key=lambda path: path.geodesic_distance)
        samples = sample_polyline([list(p) for p in route.points])[:20]
        times = [index * 500 for index in range(len(samples))]
        if args.long_horizon_hours:
            # Keep explicit gaps, real paths and exact elapsed clocks. Never loop a video.
            # Destinations are geometry-only anchors, NOT named rooms or activity truth.
            anchors = [list(start)] + [list(p.points[-1]) for p in sorted(paths, key=lambda p: p.geodesic_distance)[::max(1, len(paths)//4)][:4]]
            legs = []
            for a, b in zip([0, 1, 2, 0, 3, 1, 0, 4, 2, 0, 1, 0], [1, 2, 0, 3, 1, 0, 4, 2, 0, 1, 0, 2]):
                path = habitat_sim.ShortestPath()
                path.requested_start, path.requested_end = np.array(anchors[a]), np.array(anchors[b])
                if not sim.pathfinder.find_path(path):
                    raise ValueError('Disconnected long-horizon anchors')
                legs.append({'from': a, 'to': b, 'points': [list(map(float, p)) for p in path.points], 'distanceM': float(path.geodesic_distance)})
            timeline = long_horizon_timeline(legs, args.long_horizon_hours * 3600, travel_spacing=1 / args.travel_fps)
            if len(timeline) > 20000:
                raise ValueError('Replay limit exceeded; lower travel FPS or shorten itinerary')
            samples = [(row['position'], row['yaw']) for row in timeline]
            times = [row['atMs'] for row in timeline]
            (private / 'itinerary.json').write_text(json.dumps({'anchors': anchors, 'legs': legs, 'timeline': timeline,
                'limitations': ['Static scene; no object changes or human activity simulated', 'Sparse snapshots; gaps are not continuous observation',
                                'Geometry-only anchors; no room identity labels', 'Travel speed is scripted, not measured human motion']}, indent=2))
        agent = sim.initialize_agent(0)
        with (public / 'observations.jsonl').open('w') as observations, (private / 'poses.jsonl').open('w') as poses:
            for index, (position, yaw) in enumerate(samples):
                if not sim.pathfinder.is_navigable(position):
                    raise ValueError('Interpolated route left supplied navmesh')
                state = habitat_sim.AgentState()
                state.position = np.array(position)
                state.rotation = quat_from_angle_axis(yaw, np.array([0, 1, 0]))
                agent.set_state(state)
                images = sim.get_sensor_observations()
                frames = []
                pixel_hashes = []
                for name in ['front', 'left', 'right']:
                    pixels = images[name][:, :, :3]
                    if float(pixels.std()) < 2:
                        raise ValueError('Blank/degenerate rendering')
                    pixel_hashes.append(hashlib.sha256(pixels.tobytes()).hexdigest())
                    relative = f'frames/{index:04d}-{name}.png'
                    file = public / relative
                    Image.fromarray(pixels).save(file)
                    frames.append({'view': name, 'path': relative, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
                if len(set(pixel_hashes)) != 3:
                    raise ValueError('Views duplicated; cannot claim independent three-camera input')
                observations.write(json.dumps({'id': f'observation-{index:04d}', 'sourceAtMs': times[index], 'frames': frames}) + '\n')
                poses.write(json.dumps({'id': f'observation-{index:04d}', 'position': position, 'yawRadians': yaw,
                                        'regionTruth': None, 'onSuppliedNavmesh': bool(sim.pathfinder.is_navigable(position))}) + '\n')
        manifest = {'schema': 'three-view-render-input-v1', 'observations': len(samples), 'views': ['front', 'left', 'right'],
                    'title': f'ReplicaCAD · {args.long_horizon_hours:g}小时稀疏重访（静态场景）' if args.long_horizon_hours else 'ReplicaCAD · 三摄渲染验证',
                    'scope': '长期稀疏空间重访；静态场景，无人物活动或物体变化；非连续录像、非生活任务验收' if args.long_horizon_hours else '技术渲染小样本；非10分钟生活事件或空间准确率验收',
                    'sampling': {'travelFps': args.travel_fps, 'stationaryIntervalSeconds': 300} if args.long_horizon_hours else None,
                    'camera': {'width': 640, 'height': 480, 'heightM': 1.6, 'horizontalFovDegrees': 90,
                               'yawDegrees': [0, 60, -60], 'projection': 'pinhole', 'hardwareCalibration': False},
                    'time': 'synthetic sparse elapsed timeline; not continuous observation or real human motion' if args.long_horizon_hours else 'synthetic 500ms sample clock; not real human motion or wall-clock recording',
                    'scoreEligible': False}
        (public / 'manifest.json').write_text(json.dumps(manifest, indent=2))
        (private / 'complete.json').write_text(json.dumps({'observations': len(samples), 'independentImages': len(samples) * 3,
                                                        'geodesicRouteMeters': float(route.geodesic_distance), 'habitatVersion': habitat_sim.__version__,
                                                        'glRenderer': renderer, 'physicsBulletAvailable': bool(habitat_sim.built_with_bullet),
                                                        'softwareRenderer': any(s in renderer.lower() for s in ['llvmpipe', 'softpipe', 'swrast'])}, indent=2))
        print(json.dumps(manifest))
    except Exception as error:
        (private / 'failure.json').write_text(json.dumps({'type': type(error).__name__, 'message': str(error)}, indent=2))
        raise
    finally:
        if sim is not None:
            sim.close()


def long_horizon_timeline(legs, duration_seconds, dwell_spacing=300, travel_spacing=2):
    """Script revisits over elapsed time; spatial movement is never stretched into hours."""
    if not legs or not math.isfinite(duration_seconds) or duration_seconds < 3600:
        raise ValueError('At least one hour and connected legs required')
    if dwell_spacing <= 0 or travel_spacing <= 0:
        raise ValueError('Positive sampling intervals required')
    result = []
    for index, leg in enumerate(legs):
        begin = duration_seconds * index / len(legs)
        end = duration_seconds * (index + 1) / len(legs)
        moving = sample_polyline(leg['points'], spacing=travel_spacing)  # nominal 1 m/s
        if not moving or len(moving) * travel_spacing >= end - begin:
            raise ValueError('Invalid route or insufficient travel time')
        for step, (position, yaw) in enumerate(moving):
            result.append({'atMs': round((begin + step * travel_spacing) * 1000), 'position': position, 'yaw': yaw,
                           'phase': 'scripted-travel', 'leg': index})
        arrival = begin + len(moving) * travel_spacing
        t = arrival
        while t < end:
            # Small periodic head turns at a fixed navigable anchor, no activity claims.
            yaw = moving[-1][1] + math.radians(35) * math.sin((t-arrival) / 900)
            result.append({'atMs': round(t * 1000), 'position': moving[-1][0], 'yaw': yaw, 'phase': 'stationary-anchor', 'leg': index})
            t += dwell_spacing
    result.append({**result[-1], 'atMs': round(duration_seconds * 1000)})
    if any(b['atMs'] <= a['atMs'] for a, b in zip(result, result[1:])):
        raise ValueError('Non-monotonic timeline')
    return result


if __name__ == '__main__':
    main()
