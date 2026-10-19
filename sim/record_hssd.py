"""Actual Habitat action tour, indoor-only positions, dense 24fps review video.

Semantic polygons gate collection only. No pose/label enters image inference.
Every video frame is rendered after an actual small motion/turn action; no blends.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

EXTERIOR = {'outdoor', 'porch/terrace/deck/driveway', 'balcony'}


def region_at(point, regions):
    x, y, z = point
    matches = []
    for index, region in enumerate(regions):
        if abs(y-region.get('floor_height', 0)) > .4:
            continue
        polygon = region.get('poly_loop', [])
        inside = False
        for a, b in zip(polygon, polygon[1:]+polygon[:1]):
            if (a[2] > z) != (b[2] > z) and x < a[0]+(z-a[2])*(b[0]-a[0])/(b[2]-a[2]):
                inside = not inside
        if inside:
            matches.append((index, region))
    # Exterior overlap is conservatively rejected rather than silently accepted.
    if not matches or any(r.get('label') in EXTERIOR for _, r in matches):
        return None
    return matches[0][0]


def indoor_scope(point, regions, bridge_distance=.35):
    """Allow only small unlabelled doorway gaps next to an indoor polygon.

    Never assigns a physical identity or bridges known outdoor polygons.
    """
    index = region_at(point, regions)
    if index is not None:
        return True
    x,y,z = point
    for region in regions:
        if region.get('label') in EXTERIOR:
            probe = {**region,'label':'exterior-probe'}
            if region_at(point,[probe]) is not None:
                return False
    for region in regions:
        if region.get('label') in EXTERIOR or abs(y-region.get('floor_height',0)) > .4:
            continue
        polygon = region.get('poly_loop',[])
        for a,b in zip(polygon,polygon[1:]+polygon[:1]):
            dx,dz = b[0]-a[0],b[2]-a[2]; length = dx*dx+dz*dz
            t = max(0,min(1,((x-a[0])*dx+(z-a[2])*dz)/length)) if length else 0
            if (x-a[0]-t*dx)**2+(z-a[2]-t*dz)**2 <= bridge_distance**2:
                return True
    return False


def main():
    import habitat_sim
    import imageio_ffmpeg
    import magnum as mn
    import numpy as np
    from PIL import Image
    parser = argparse.ArgumentParser()
    parser.add_argument('scene'); parser.add_argument('output', type=Path)
    parser.add_argument('--assets', type=Path, default=Path('run/hssd-data'))
    parser.add_argument('--max-frames', type=int, default=1920)
    parser.add_argument('--max-targets', type=int, default=4, help='Bound tour size so a real return can fit; no fake completed revisits')
    parser.add_argument('--avoid-small-targets', action='store_true', help='Retry input quality without targeting tiny closets/toilets; still record actual transit')
    parser.add_argument('--start-region-offset', type=int, default=0)
    parser.add_argument('--seed', type=int, default=20261012)
    args = parser.parse_args()
    capture_script_sha = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    manifest = json.loads((args.assets/'download-manifest.json').read_text())
    if not manifest['complete'] or args.scene not in manifest['scenes']:
        raise ValueError('Require complete pinned download manifest')
    if args.max_frames < 48:
        raise ValueError('Insufficient capture budget')
    args.output.mkdir(parents=True, exist_ok=False)
    for view in ['frames', 'left', 'right', 'triple']:
        (args.output/view).mkdir()
    regions = json.loads((args.assets/f'semantics/scenes/{args.scene}.semantic_config.json').read_text())['region_annotations']
    backend = habitat_sim.SimulatorConfiguration()
    backend.scene_dataset_config_file = str((args.assets/'hssd-hab.scene_dataset_config.json').resolve())
    backend.scene_id = args.scene; backend.enable_physics = False; backend.gpu_device_id = -1
    agent_config = habitat_sim.agent.AgentConfiguration()
    sensors = []
    for name, yaw in [('left', math.pi/2), ('front', 0), ('right', -math.pi/2)]:
        spec = habitat_sim.CameraSensorSpec()
        spec.uuid = name; spec.sensor_type = habitat_sim.SensorType.COLOR
        spec.resolution = [320, 320]; spec.position = mn.Vector3(0, 1.5, 0)
        spec.orientation = mn.Vector3(0, yaw, 0); spec.hfov = mn.Deg(90)
        sensors.append(spec)
    agent_config.sensor_specifications = sensors
    agent_config.action_space = {
        'move_forward': habitat_sim.agent.ActionSpec('move_forward', habitat_sim.agent.ActuationSpec(amount=.025)),
        'turn_left': habitat_sim.agent.ActionSpec('turn_left', habitat_sim.agent.ActuationSpec(amount=3)),
        'turn_right': habitat_sim.agent.ActionSpec('turn_right', habitat_sim.agent.ActuationSpec(amount=3))}
    sim = habitat_sim.Simulator(habitat_sim.Configuration(backend, [agent_config]))
    writer = None
    try:
        import ctypes
        gl = ctypes.CDLL('libOpenGL.so.0'); gl.glGetString.restype = ctypes.c_char_p
        renderer = (gl.glGetString(0x1F01) or b'unknown').decode()
        if 'NVIDIA' not in renderer:
            raise RuntimeError('Require verified NVIDIA renderer, got '+renderer)
        nav = habitat_sim.NavMeshSettings(); nav.set_defaults(); nav.include_static_objects = True
        if not sim.recompute_navmesh(sim.pathfinder, nav):
            raise RuntimeError('Furniture-aware navmesh failed')
        sim.pathfinder.seed(args.seed)
        candidates = {}
        for _ in range(6000):
            point = sim.pathfinder.get_random_navigable_point()
            if not np.all(np.isfinite(point)):
                continue
            region = region_at(point, regions)
            if region is not None:
                candidates.setdefault(region, []).append(point)
        if len(candidates) < 2:
            raise RuntimeError('Fewer than two indoor navigable regions')
        # Region centroids select collector targets; never inference evidence.
        targets = []
        for region, points in sorted(candidates.items()):
            if args.avoid_small_targets and regions[region].get('label') in {'closet','toilet','utilityroom/toolroom'}:
                continue
            points = np.array(points); center = np.median(points, axis=0)
            targets.append((region, points[np.argmin(np.linalg.norm(points-center, axis=1))]))
        islands = {}
        for region,point in targets:
            islands.setdefault(sim.pathfinder.get_island(point),[]).append((region,point))
        targets = max(islands.values(),key=len)
        if len(targets) < 2:
            raise RuntimeError('No island has two indoor region targets')
        offset = args.start_region_offset % len(targets)
        targets = targets[offset:]+targets[:offset]
        start = targets[0][1]
        state = habitat_sim.AgentState(); state.position = start
        sim.initialize_agent(0, state)
        route = []; current = start
        remaining = targets[1:]
        # Actual geodesic route, reject any segment passing through unlabelled/exterior.
        while remaining:
            if len(route) >= args.max_targets:
                break
            options = []
            for region, target in remaining:
                path = habitat_sim.ShortestPath(); path.requested_start = current; path.requested_end = target
                if sim.pathfinder.find_path(path) and all(indoor_scope(p, regions) for p in path.points):
                    # Check intermediate path positions too, not vertices alone.
                    valid = all(indoor_scope(a+(b-a)*t, regions) for a,b in zip(path.points,path.points[1:]) for t in np.linspace(0,1,max(2,int(np.linalg.norm(b-a)/.1)+1)))
                    if valid:
                        options.append((path.geodesic_distance, region, target))
            if not options:
                break
            _, region, target = min(options, key=lambda r:r[0])
            route.append((region,target)); remaining = [(r,p) for r,p in remaining if r != region]; current = target
        if not route:
            raise RuntimeError('No verified indoor connected route')
        route.append((targets[0][0], start))  # Real revisit, not duplicated observations.
        follower = habitat_sim.GreedyGeodesicFollower(sim.pathfinder, sim.get_agent(0), goal_radius=.25,
                    stop_key=None, forward_key='move_forward', left_key='turn_left', right_key='turn_right')
        writer = imageio_ffmpeg.write_frames(str(args.output/'motion-24fps.mp4'), (1008,320), fps=24,
                    codec='libx264', pix_fmt_out='yuv420p', output_params=['-crf','20','-g','24','-movflags','+faststart'])
        writer.send(None)
        trace = []; windows = []; hashes = {}; target_index = 0; reached = []
        observations = sim.get_sensor_observations()
        for dense_tick in range(args.max_frames):
            position = sim.get_agent(0).get_state().position
            region = region_at(position, regions)
            if not indoor_scope(position, regions):
                raise RuntimeError('Action left verified indoor region; capture quarantined')
            panels = [observations[v][...,:3] for v in ['left','front','right']]
            gap = np.full((320,24,3),24,dtype=np.uint8)
            writer.send(np.concatenate([panels[0],gap,panels[1],gap,panels[2]],axis=1))
            if dense_tick % 12 == 0:
                tick = dense_tick//12; name = f'{tick:04d}.jpg'
                if any(image.std() < 1 or np.mean(np.all(image < 5,axis=2)) > .8 for image in panels):
                    raise RuntimeError('Blank or predominantly missing-geometry capture; quarantined')
                for directory, image in zip(['left','frames','right'],panels):
                    Image.fromarray(image).save(args.output/directory/name,quality=90)
                Image.fromarray(np.concatenate(panels,axis=1)).save(args.output/'triple'/name,quality=90)
                hashes[name] = hashlib.sha256((args.output/'triple'/name).read_bytes()).hexdigest()
                if tick % 4 == 0:
                    windows.append({'endTick':tick,'frame':name,'timestampMs':round(dense_tick*1000/24)})
            trace.append({'denseTick':dense_tick,'timestampMs':round(dense_tick*1000/24),'position':position.tolist(),'collectorRegionIndex':region,'targetIndex':target_index})
            if target_index >= len(route):
                break
            action = follower.next_action_along(route[target_index][1])
            if action is None:
                reached.append(route[target_index][0]); target_index += 1
                if target_index >= len(route):
                    break
                follower.reset()
                action = follower.next_action_along(route[target_index][1])
                if action is None:
                    continue
            trace[-1]['action'] = action
            observations = sim.step(action)
        writer.close(); writer = None
        if len(windows) < 4 or len({row['collectorRegionIndex'] for row in trace if row['collectorRegionIndex'] is not None}) < 2:
            raise RuntimeError('Insufficient multi-region observations')
        (args.output/'windows.jsonl').write_text('\n'.join(json.dumps(w) for w in windows)+'\n')
        (args.output/'collector-trace.json').write_text(json.dumps(trace))
        result = {'protocol':'hssd-action-capture-v1','sceneId':args.scene,'revision':manifest['revision'],
                  'license':'CC BY-NC 4.0','source':'https://3dlg-hcvc.github.io/hssd/','glRenderer':renderer,
                  'denseFps':24,'captureFps':2,'denseFrames':len(trace),'samples':len(windows),
                  'visitedCollectorRegions':sorted({r['collectorRegionIndex'] for r in trace if r['collectorRegionIndex'] is not None}),
                  'unlabelledDoorwayFrames':sum(r['collectorRegionIndex'] is None for r in trace), 'collectorDoorwayGapToleranceMeters':.35,
                  'reachedTargets':reached,'plannedTargets':len(route),'completedRoute':target_index >= len(route),
                  'maxTourTargets':args.max_targets,'captureScriptSha256':capture_script_sha,
                  'avoidSmallTargets':args.avoid_small_targets,'startRegionOffset':args.start_region_offset,
                  'triptychSha256':hashes,'seed':args.seed,
                  'limitations':'Collector polygon labels are not human ground truth. Route truncation explicitly reported. Existing replay uses synthetic 1000ms/capture tick, not measured hardware latency. No poses or labels supplied to inference.'}
        (args.output/'manifest.json').write_text(json.dumps(result,indent=2))
        print(json.dumps(result,indent=2))
    except Exception as error:
        (args.output/'capture-failure.json').write_text(json.dumps({'exceptionType':type(error).__name__,'message':str(error),'validCapture':False},indent=2))
        raise
    finally:
        if writer is not None:
            writer.close()
        sim.close()


if __name__ == '__main__':
    main()
