"""Asset-free three-view RGB-D render. Not a FindingDory episode or IMU simulation."""
import datetime
import argparse
import json
import os
from pathlib import Path
import traceback

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault('HABITAT_SIM_LOG', 'quiet')
os.environ.setdefault('MAGNUM_LOG', 'quiet')
os.environ.setdefault('PYTHONDONTWRITEBYTECODE', '1')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--egl-default-device', action='store_true')
    args = parser.parse_args()
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    output = ROOT / 'runs' / f'habitat-smoke-{stamp}'
    output.mkdir(parents=True, exist_ok=False)
    report = {'at': stamp, 'kind': 'synthetic empty-scene primitive render',
              'benchmarkEpisode': False, 'imuSimulated': False,
              'note': 'Same optical center, different yaw; NOT a calibrated physical three-camera rig',
              'output': str(output), 'passed': False}
    sim = None
    try:
        import habitat_sim
        import magnum as mn
        import numpy as np
        from PIL import Image
        report['habitatVersion'] = habitat_sim.__version__
        cfg = habitat_sim.SimulatorConfiguration()
        cfg.scene_id = 'NONE'
        cfg.enable_physics = False
        if args.egl_default_device:
            cfg.gpu_device_id = -1
        report['eglDefaultDevice'] = args.egl_default_device
        agent = habitat_sim.agent.AgentConfiguration()
        sensors = []
        for name, yaw in [('front', 0.0), ('left', np.pi / 2), ('right', -np.pi / 2)]:
            for suffix, kind in [('rgb', habitat_sim.SensorType.COLOR), ('depth', habitat_sim.SensorType.DEPTH)]:
                sensor = habitat_sim.CameraSensorSpec()
                sensor.uuid = name + '_' + suffix
                sensor.sensor_type = kind
                sensor.resolution = [128, 128]
                sensor.position = [0.0, 1.5, 0.0]
                sensor.orientation = [0.0, float(yaw), 0.0]
                sensor.hfov = 90
                sensors.append(sensor)
        agent.sensor_specifications = sensors
        sim = habitat_sim.Simulator(habitat_sim.Configuration(cfg, [agent]))
        import ctypes
        gl = ctypes.CDLL('libOpenGL.so.0')
        gl.glGetString.restype = ctypes.c_char_p
        renderer = gl.glGetString(0x1F01)
        report['glRenderer'] = renderer.decode() if renderer else 'unknown'
        report['softwareRenderer'] = any(x in report['glRenderer'].lower() for x in ('llvmpipe', 'softpipe', 'swrast'))
        state = habitat_sim.AgentState()
        state.position = [0.0, 0.0, 0.0]
        sim.initialize_agent(0, state)
        templates = sim.get_object_template_manager()
        handle = templates.get_template_handles('cubeSolid')[0]
        for position in ([0, 1.5, -3], [-3, 1.5, 0], [3, 1.5, 0]):
            obj = sim.get_rigid_object_manager().add_object_by_template_handle(handle)
            obj.translation = mn.Vector3(*position)
        observations = sim.get_sensor_observations()
        checks = {}
        for name in ('front', 'left', 'right'):
            rgb = observations[name + '_rgb']
            depth = observations[name + '_depth']
            Image.fromarray(rgb).save(output / (name + '.png'))
            np.save(output / (name + '-depth.npy'), depth)
            hit = depth > 0
            checks[name] = {'rgbShape': list(rgb.shape), 'depthShape': list(depth.shape),
                            'depthFinite': bool(np.isfinite(depth).all()),
                            'positiveDepthPixels': int(hit.sum()),
                            'nearestDepth': float(depth[hit].min()) if hit.any() else None}
        report['views'] = checks
        report['passed'] = all(c['depthFinite'] and c['positiveDepthPixels'] > 0 and
                               c['rgbShape'][:2] == [128, 128] for c in checks.values())
    except Exception:
        report['error'] = traceback.format_exc()
    finally:
        if sim is not None:
            sim.close()
        (output / 'result.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        (ROOT / 'reports' / f'habitat-smoke-{stamp}.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
