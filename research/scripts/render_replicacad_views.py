"""Render a smooth RGB-D pass in ReplicaCAD with GT camera poses.

Pipeline-validation input only: not HM3D A-EQA/GOAT, not a three-camera rig.
"""
import argparse
import json
import math
import os
from pathlib import Path

os.environ.setdefault('HABITAT_SIM_LOG', 'quiet')
os.environ.setdefault('MAGNUM_LOG', 'quiet')

SCENE_DATASET = 'research/data/replicacad-static/static.scene_dataset_config.json'


def main():
    import habitat_sim
    import magnum as mn
    import numpy as np
    import quaternion
    from PIL import Image

    parser = argparse.ArgumentParser()
    parser.add_argument('--scene', default='apt_1')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--frames', type=int, default=16)
    parser.add_argument('--radius', type=float, default=1.1)
    parser.add_argument('--seed', type=int, default=11)
    parser.add_argument('--tilt-deg', type=float, default=-15.)
    parser.add_argument('--physics', action='store_true', help='ReplicaCAD articulated objects need physics')
    parser.add_argument('--stage-only', action='store_true', help='Load static stage GLB without articulated instances')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)

    backend = habitat_sim.SimulatorConfiguration()
    backend.scene_id = args.scene
    if not args.stage_only:
        backend.scene_dataset_config_file = SCENE_DATASET
    backend.enable_physics = args.physics
    backend.gpu_device_id = -1
    agent_cfg = habitat_sim.agent.AgentConfiguration()
    sensors = []
    for uuid, kind in (('rgb', habitat_sim.SensorType.COLOR), ('depth', habitat_sim.SensorType.DEPTH)):
        spec = habitat_sim.CameraSensorSpec()
        spec.uuid = uuid
        spec.sensor_type = kind
        spec.resolution = [480, 640]
        spec.position = mn.Vector3(0., 1.5, 0.)
        spec.orientation = mn.Vector3(args.tilt_deg * math.pi / 180, 0., 0.)
        spec.hfov = 90
        sensors.append(spec)
    agent_cfg.sensor_specifications = sensors
    sim = habitat_sim.Simulator(habitat_sim.Configuration(backend, [agent_cfg]))
    try:
        sim.pathfinder.seed(args.seed)
        points = []
        for _ in range(4000):
            p = np.array(sim.pathfinder.get_random_navigable_point())
            if np.all(np.isfinite(p)):
                points.append(p)
            if len(points) >= 80:
                break
        if len(points) < 20:
            raise RuntimeError('Insufficient navigable points')
        points = np.array(points)
        # Scanned/staged scenes can expose upper surfaces; keep the lowest band.
        lower = points[points[:, 1] <= points[:, 1].min() + 0.5]
        if len(lower) < 10:
            raise RuntimeError('Insufficient lower-level navigable points')
        center = np.median(lower[:, [0, 2]], axis=0)
        anchor = lower[np.argmin(np.linalg.norm(lower[:, [0, 2]] - center, axis=1))]
        radius = args.radius
        offsets = []
        for k in range(args.frames):
            angle = 2 * math.pi * k / args.frames
            x = anchor[0] + radius * math.cos(angle)
            z = anchor[2] + radius * math.sin(angle)
            y = anchor[1]
            if not sim.pathfinder.is_navigable(np.array([x, y, z])):
                continue
            offsets.append((angle, x, y, z))
        if len(offsets) < 6:
            raise RuntimeError('Insufficient navigable orbit poses')

        records = []
        for k, (angle, x, y, z) in enumerate(offsets):
            state = habitat_sim.AgentState()
            state.position = np.array([x, y, z])
            # Look toward the anchor; yaw about world Y.
            yaw = math.atan2(anchor[0] - x, anchor[2] - z) + math.pi
            state.rotation = [0.0, math.sin(yaw / 2), 0.0, math.cos(yaw / 2)]
            sim.initialize_agent(0, state)
            obs = sim.get_sensor_observations()
            rgb = obs['rgb'][..., :3]
            depth = obs['depth']
            cam = sim.agents[0].get_state().sensor_states['depth']
            quat = cam.rotation
            # Habitat sensor rotation is camera->world (OpenGL convention).
            # habitat_sim returns a numpy-quaternion object here.
            rot = np.asarray(quaternion.as_rotation_matrix(quat))
            pose = np.eye(4)
            pose[:3, :3] = rot
            pose[:3, 3] = np.array(cam.position)
            name = f'{k:04d}'
            Image.fromarray(rgb).save(args.output / f'{name}.png')
            np.save(args.output / f'{name}.depth.npy', depth.astype(np.float32))
            np.save(args.output / f'{name}.pose.npy', pose.astype(np.float64))
            records.append({'frame': k, 'yawRad': yaw, 'cameraWorld': pose.tolist(),
                            'anchor': anchor.tolist(), 'position': [x, y, z],
                            'depthMin': float(depth[depth > 0].min()) if (depth > 0).any() else None,
                            'depthValidFraction': float((depth > 0).mean())})
        (args.output / 'render.json').write_text(json.dumps({
            'scene': args.scene, 'sceneDatasetConfig': SCENE_DATASET,
            'scope': 'ReplicaCAD pipeline validation, NOT HM3D A-EQA/GOAT, single moving camera',
            'width': 640, 'height': 480, 'hfov': 90, 'tiltDeg': args.tilt_deg,
            'frames': records, 'glRenderer': os.environ.get('GALLIUM_DRIVER'),
        }, indent=2, default=float), encoding='utf-8')
        print('rendered', len(records), 'views to', args.output)
    finally:
        sim.close()


if __name__ == '__main__':
    main()
