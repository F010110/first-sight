"""Verify GPU rendering and navmesh with an explicitly provided licensed asset."""
import argparse
import hashlib
import json
import math
from pathlib import Path


def main():
    import habitat_sim
    import magnum as mn
    import numpy as np
    from PIL import Image, ImageDraw
    parser = argparse.ArgumentParser()
    parser.add_argument('scene', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--dataset-config', type=Path, help='Habitat dataset config, e.g. HSSD; scene may be an ID')
    parser.add_argument('--egl-default-device', action='store_true', help='Bypass CUDA/EGL matching on WSL; report actual GL renderer')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    backend = habitat_sim.SimulatorConfiguration()
    backend.scene_id = str(args.scene) if args.dataset_config else str(args.scene.resolve())
    if args.dataset_config:
        backend.scene_dataset_config_file = str(args.dataset_config.resolve())
    backend.enable_physics = False
    if args.egl_default_device:
        backend.gpu_device_id = -1
    agent = habitat_sim.agent.AgentConfiguration()
    sensors = []
    for name, yaw in [('left', math.pi/2), ('front', 0), ('right', -math.pi/2)]:
        camera = habitat_sim.CameraSensorSpec()
        camera.uuid = name; camera.sensor_type = habitat_sim.SensorType.COLOR
        camera.resolution = [320, 320]; camera.position = mn.Vector3(0, 1.5, 0)
        camera.orientation = mn.Vector3(0, yaw, 0); camera.hfov = mn.Deg(90)
        sensors.append(camera)
    agent.sensor_specifications = sensors
    sim = habitat_sim.Simulator(habitat_sim.Configuration(backend, [agent]))
    try:
        import ctypes
        gl = ctypes.CDLL('libOpenGL.so.0')
        gl.glGetString.restype = ctypes.c_char_p
        renderer = gl.glGetString(0x1F01)
        renderer = renderer.decode() if renderer else 'unknown'
        settings = habitat_sim.NavMeshSettings(); settings.set_defaults()
        settings.include_static_objects = True
        if args.dataset_config or not sim.pathfinder.is_loaded:
            if not sim.recompute_navmesh(sim.pathfinder, settings):
                raise RuntimeError('Navmesh build failed')
        sim.pathfinder.seed(20261012)
        candidates = np.array([sim.pathfinder.get_random_navigable_point() for _ in range(128)])
        candidates = candidates[np.all(np.isfinite(candidates), axis=1)]
        if not len(candidates):
            raise RuntimeError('No navigable points')
        # Scanned assets may expose roof/ceiling surfaces as a second nav level.
        # Pick the lower floor and a central sampled point for this smoke only.
        lower = candidates[candidates[:, 1] <= candidates[:, 1].min() + 0.3]
        center = np.median(lower[:, [0, 2]], axis=0)
        point = lower[np.argmin(np.linalg.norm(lower[:, [0, 2]] - center, axis=1))]
        if not np.all(np.isfinite(point)):
            raise RuntimeError('No valid indoor navigable test point')
        state = habitat_sim.AgentState(); state.position = point
        sim.initialize_agent(0, state)
        stats = {}
        triple = Image.new('RGB', (1008, 344), (24, 24, 24)); draw = ImageDraw.Draw(triple)
        observations = sim.get_sensor_observations()
        for i, name in enumerate(['left', 'front', 'right']):
            array = observations[name][..., :3]
            stats[name] = {'shape': list(array.shape), 'std': float(array.std()), 'mean': float(array.mean()), 'blackFraction': float(np.mean(np.all(array < 5, axis=2)))}
            if array.std() < 1:
                raise RuntimeError('Blank render: '+name)
            image = Image.fromarray(array); image.save(args.output / f'{name}.png')
            triple.paste(image, (i * 344, 24)); draw.text((i * 344 + 8, 5), name.upper(), fill='white')
        triple.save(args.output / 'triple.png')
        result = {'habitatVersion': habitat_sim.__version__, 'glRenderer': renderer, 'softwareRenderer': any(name in renderer.lower() for name in ['llvmpipe', 'softpipe', 'swrast']), 'eglDefaultDevice': args.egl_default_device, 'sceneId': str(args.scene), 'sceneSha256': hashlib.sha256(args.scene.read_bytes()).hexdigest() if args.scene.is_file() else None, 'datasetConfigSha256': hashlib.sha256(args.dataset_config.read_bytes()).hexdigest() if args.dataset_config else None,
                  'navmeshLoaded': sim.pathfinder.is_loaded, 'navigableArea': sim.pathfinder.navigable_area, 'images': stats,
                  'scope': 'Environment smoke only, not school/office dataset or pipeline acceptance. Same-center 90deg three views; no poses supplied to inference.'}
        (args.output / 'report.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result, indent=2))
    finally:
        sim.close()


if __name__ == '__main__':
    main()
