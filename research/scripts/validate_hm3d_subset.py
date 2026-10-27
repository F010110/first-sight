"""Local raw-GLB/navmesh/start-pose validation; no VLM calls or score claims."""
import json
import os
from pathlib import Path
import traceback
import argparse

os.environ.setdefault('HABITAT_SIM_LOG', 'quiet')
os.environ.setdefault('MAGNUM_LOG', 'quiet')
ROOT = Path(__file__).resolve().parents[1]


def main():
    import ctypes
    import habitat_sim
    import numpy as np
    import quaternion
    from PIL import Image
    questions = json.loads((ROOT / 'data/hm3d-minival-eqa-subset/questions.json').read_text())
    parser = argparse.ArgumentParser()
    parser.add_argument('--tag', default='v2-wxyz')
    args = parser.parse_args()
    if '/' in args.tag or '\\' in args.tag:
        raise ValueError('Tag must be a single path component')
    output = ROOT / 'runs' / ('hm3d-minival-validation-' + args.tag)
    output.mkdir(parents=True, exist_ok=False)
    results = []
    for scene in sorted({q['episode_history'] for q in questions}):
        sim = None
        row = {'scene': scene, 'passed': False}
        results.append(row)
        try:
            glb = ROOT / 'data/hm3d-minival-glb-v0.2' / scene / (scene.split('-')[1] + '.glb')
            backend = habitat_sim.SimulatorConfiguration()
            backend.scene_id = str(glb)
            backend.enable_physics = False
            backend.gpu_device_id = -1
            agent = habitat_sim.agent.AgentConfiguration()
            # Keep the default agent body settings explicit in the report; these
            # meshes are regenerated, not equivalent to official navigation assets.
            specs = []
            for name, kind in [('rgb', habitat_sim.SensorType.COLOR), ('depth', habitat_sim.SensorType.DEPTH)]:
                spec = habitat_sim.CameraSensorSpec()
                spec.uuid = name
                spec.sensor_type = kind
                spec.resolution = [240, 320]
                spec.position = [0., 1.5, 0.]
                spec.orientation = [-np.pi / 6, 0., 0.]
                spec.hfov = 120
                specs.append(spec)
            agent.sensor_specifications = specs
            sim = habitat_sim.Simulator(habitat_sim.Configuration(backend, [agent]))
            gl = ctypes.CDLL('libOpenGL.so.0')
            gl.glGetString.restype = ctypes.c_char_p
            renderer = gl.glGetString(0x1F01)
            row['renderer'] = renderer.decode() if renderer else 'unknown'
            settings = habitat_sim.NavMeshSettings()
            settings.set_defaults()
            row['navmeshSettings'] = {'agentHeight': settings.agent_height, 'agentRadius': settings.agent_radius}
            row['navmeshGenerated'] = bool(sim.recompute_navmesh(sim.pathfinder, settings))
            row['navigableArea'] = float(sim.pathfinder.navigable_area)
            if not row['navmeshGenerated']:
                raise RuntimeError('Navmesh generation failed')
            sim.pathfinder.save_nav_mesh(str(output / (scene + '.navmesh')))
            checks = []
            for question in [q for q in questions if q['episode_history'] == scene]:
                position = np.array(question['position'], dtype=float)
                snap = np.array(sim.pathfinder.snap_point(position))
                state = habitat_sim.AgentState()
                # Do not silently move the official start. Snap is diagnostic only.
                state.position = position
                # A-EQA stores wxyz; Habitat lists are xyzw. Match upstream
                # get_pts_angle_aeqa rather than silently swapping axes.
                state.rotation = quaternion.quaternion(*question['rotation'])
                sim.initialize_agent(0, state)
                obs = sim.get_sensor_observations()
                rgb, depth = obs['rgb'][..., :3], obs['depth']
                Image.fromarray(rgb).save(output / (question['question_id'] + '.png'))
                checks.append({'questionId': question['question_id'],
                               'startNavigable': bool(sim.pathfinder.is_navigable(position)),
                               'snapDistanceM': float(np.linalg.norm(snap - position)) if np.isfinite(snap).all() else None,
                               'rgbStd': float(rgb.std()), 'validDepthFraction': float((depth > 0).mean()),
                               'finiteDepth': bool(np.isfinite(depth).all())})
            row['starts'] = checks
            row['passed'] = all(c['startNavigable'] and c['finiteDepth'] and c['rgbStd'] > 1 and c['validDepthFraction'] > .5 for c in checks)
        except Exception:
            row['error'] = traceback.format_exc()
        finally:
            if sim is not None:
                sim.close()
            (ROOT / 'reports' / ('hm3d-minival-local-validation-' + args.tag + '.json')).write_text(json.dumps(results, indent=2), encoding='utf-8')
            print(scene, 'passed=', row['passed'], flush=True)


if __name__ == '__main__':
    main()
