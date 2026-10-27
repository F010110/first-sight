"""Separate instrumented runtime; never edit the frozen baseline."""
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT/'runs/3dmem-minival-runtime-v1'
OUT = ROOT/'runs/3dmem-imu-memory-runtime-v1'


def replace(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Patch anchor not unique: '+old[:100])
    return text.replace(old,new,1)


def main():
    OUT.mkdir(exist_ok=False)
    for name in ('src','cfg','data'):
        shutil.copytree(SOURCE/name,OUT/name,ignore=shutil.ignore_patterns('__pycache__'))
    for name in ('sam_l.pt','yolov8x-world.pt'):
        (OUT/name).symlink_to((SOURCE/name).resolve())
    shutil.copy2(ROOT/'scripts/imu_memory_noise.py',OUT/'imu_memory_noise.py')
    text = (SOURCE/'run_aeqa_evaluation.py').read_text()
    text = replace(text,'from src.const import *','from src.const import *\nfrom imu_memory_noise import MemoryExperiment, append_json')
    text = replace(text,'    np.random.seed(cfg.seed)',
        '    np.random.seed(cfg.seed)\n    torch.manual_seed(cfg.seed)\n    if torch.cuda.is_available():\n        torch.cuda.manual_seed_all(cfg.seed)')
    text = replace(text,'        # run steps','        experiment = MemoryExperiment(cfg, scene, cfg.noise_trace_dir)\n        scene._research_experiment = experiment\n\n        # run steps')
    text = replace(text,'                rgb = obs["color_sensor"]',
        '                memory_pose, memory_pts = experiment.observation(cam_pose, pts, cnt_step, view_idx, ang)\n                rgb = obs["color_sensor"]')
    text = replace(text,'                depth = obs["depth_sensor"]',
        '                depth = obs["depth_sensor"]\n'
        '                import hashlib\n'
        '                append_json(experiment.output / "observations.jsonl", dict(frame=experiment.current_frame, '
        'rgbSha256=hashlib.sha256(rgb.tobytes()).hexdigest(), depthSha256=hashlib.sha256(depth.tobytes()).hexdigest()))')
    text = replace(text,'                        cam_pos=cam_pose,\n                        pts=pts,\n                        pts_voxel=tsdf_planner.habitat2voxel(pts),',
        '                        cam_pos=memory_pose,\n                        pts=memory_pts,\n                        pts_voxel=tsdf_planner.habitat2voxel(memory_pts),')
    text = replace(text,'                    frame_idx=cnt_step * total_views + view_idx, pts=pts',
        '                    frame_idx=cnt_step * total_views + view_idx, pts=memory_pts')
    text = replace(text,'                # Update depth map, occupancy map',
        '                experiment.objects("after_cleanup", cnt_step)\n\n                # Update depth map, occupancy map (GT navigation control)')
    text = replace(text,'np.linalg.norm(obj["bbox"].center[[0, 2]] - pts[[0, 2]])',
        'np.linalg.norm(obj["bbox"].center[[0, 2]] - memory_pts[[0, 2]])')
    text = replace(text,'            # (3) Update the Frontier Snapshots',
        '            experiment.objects("after_snapshots", cnt_step)\n\n            # (3) Update the Frontier Snapshots')
    text = replace(text,'                max_point_choice, gpt_answer, n_filtered_snapshots = vlm_response',
        '                max_point_choice, gpt_answer, n_filtered_snapshots = vlm_response\n'
        '                append_json(experiment.output / "decisions.jsonl", dict(step=cnt_step, '
        'choiceType=type(max_point_choice).__name__, image=getattr(max_point_choice,"image",None), '
        'answer=gpt_answer, filteredSnapshots=n_filtered_snapshots, totalSnapshots=len(scene.snapshots), '
        'frontiers=len(tsdf_planner.frontiers)))')
    (OUT/'run_aeqa_evaluation.py').write_text(text,encoding='utf-8')
    scene = (OUT/'src/scene_aeqa.py').read_text()
    scene = replace(scene,'            self.objects.update(detection_list)',
        '            if hasattr(self, "_research_experiment"):\n'
        '                self._research_experiment.matches(detection_list, [(k, None) for k in detection_list])\n'
        '            self.objects.update(detection_list)')
    scene = replace(scene,'            # Now merge the detected objects into the existing objects based on the match indices',
        '            if hasattr(self, "_research_experiment"):\n'
        '                self._research_experiment.matches(detection_list, match_indices)\n\n'
        '            # Now merge the detected objects into the existing objects based on the match indices')
    (OUT/'src/scene_aeqa.py').write_text(scene,encoding='utf-8')
    hashes = {str(p.relative_to(OUT)):hashlib.sha256(p.read_bytes()).hexdigest()
              for p in OUT.rglob('*.py')}
    protocol = dict(runtime=str(OUT), runtimeHashes=hashes,
        scope='Online memory-side pure-IMU pose intervention. RGB-D rendering, TSDF and pathfinder use GT. Not full noisy navigation or VIO.',
        observationPolicy='Native 3D-Mem; trajectories can diverge after memory-dependent decisions. No fixed-trajectory causal claim.',
        profiles=__import__('imu_memory_noise').PROFILES, initialState='Exact pose, zero velocity; residual biases unknown to pure integrator.',
        slowBias='Assumed Gauss-Markov tau=100s, stationary sigma=initial residual sigma/3; sensitivity setting, not device identification.',
        motion='Collocated camera/IMU, 200Hz; stop-to-stop quintic rotation then navmesh polyline translation; peak .5m/s, 1m/s², 90deg/s, 180deg/s².',
        clock='Synthetic physical time only. No API waiting time. No resets, clipping or GT correction of estimated pose.',
        noiseConvention='Published one-sided ASD => continuous Qc=ASD²/2; sample std=ASD/sqrt(2*dt).',
        pilotSelection='First three question IDs from frozen manifest; not selected by answers. Seed 0 only; not significance test.',
        pipeline='Full upstream detection, association, actual object fusion, denoising, filtering/merging and snapshot clustering retained.',
        traces=['imu.csv.gz','poses.jsonl','observations.jsonl','associations.jsonl','memory.jsonl','decisions.jsonl','run.log','api usage and image hashes'],
        budgets=dict(steps=50,requests=110,timeoutSeconds=3600,outputTokens=4096), judge='qwen3.7-plus-2026-05-26')
    (ROOT/'reports/imu-memory-v1-protocol.json').write_text(json.dumps(protocol,indent=2),encoding='utf-8')
    print(OUT)


if __name__=='__main__':
    main()
