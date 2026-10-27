"""Use 3D-Mem's own detection/mapping decision functions under pose perturbation.

Detections and masks are computed once from RGB (identical across conditions).
Only the camera pose used to back-project depth is perturbed, so map changes
isolate geometry-to-association sensitivity.

Scope: ReplicaCAD pipeline validation with 3D-Mem mapping code; NOT HM3D
A-EQA/GOAT scores, NOT raw IMU, NOT a three-camera rig.
"""
import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

VENDOR = Path(__file__).resolve().parents[1] / 'vendor' / '3d-mem'
os.chdir(VENDOR)
sys.path.insert(0, str(VENDOR))

import torch  # noqa: E402
from omegaconf import OmegaConf  # noqa: E402
import supervision as sv  # noqa: E402
from ultralytics import SAM, YOLOWorld  # noqa: E402
import open_clip  # noqa: E402

from src.geom import get_cam_intr  # noqa: E402
from src.conceptgraph.slam.slam_classes import DetectionDict, MapObjectDict  # noqa: E402
from src.conceptgraph.slam.mapping import (  # noqa: E402
    aggregate_similarities, compute_spatial_similarities, compute_visual_similarities,
    match_detections_to_objects,
)
from src.conceptgraph.slam.utils import (  # noqa: E402
    detections_to_obj_pcd_and_bbox, get_bounding_box, init_process_pcd,
)
from src.conceptgraph.utils.general_utils import (  # noqa: E402
    ObjectClasses, filter_detections,
)
from src.conceptgraph.utils.model_utils import compute_clip_features_batched  # noqa: E402


def rotation_error(deg, axis):
    a = np.deg2rad(deg)
    c, s = np.cos(a), np.sin(a)
    if axis == 'y':
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    if axis == 'x':
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def perturb_pose(pose, yaw_deg, pitch_deg, tx, ty, tz, progress=1.0):
    out = pose.copy()
    # Error is applied in the camera frame: world_R_cam * R_err.
    err = rotation_error(yaw_deg * progress, 'y') @ rotation_error(pitch_deg * progress, 'x')
    out[:3, :3] = pose[:3, :3] @ err
    out[:3, 3] = pose[:3, 3] + np.array([tx, ty, tz]) * progress
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--frames', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--conditions', default='gt,yaw0.5,yaw1,yaw2,pitch1,pitch2,yawdrift1,yawdrift2,tdrift10cm,yaw1_tdrift10cm')
    parser.add_argument('--conf', type=float, default=0.4)
    parser.add_argument('--pose-dir', type=Path, default=None,
                        help='Optional directory of per-frame .pose.npy overrides plus coverage.json')
    args = parser.parse_args()
    # Resolve before chdir into the upstream tree.
    args.frames = args.frames.resolve()
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)

    render = json.loads((args.frames / 'render.json').read_text())
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    cg = OmegaConf.load(VENDOR / 'cfg/concept_graph_default.yaml')
    classes = ObjectClasses(classes_file_path='data/scannet200_classes.txt', bg_classes=cg['bg_classes'],
                            skip_bg=cg['skip_bg'], class_set='scannet200')
    class_arr = classes.get_classes_arr()

    detector = YOLOWorld('yolov8x-world.pt')
    detector.set_classes(class_arr)
    sam = SAM('sam_l.pt')
    clip_model, _, clip_pre = open_clip.create_model_and_transforms('ViT-B-32', 'laion2b_s34b_b79k')
    clip_tok = open_clip.get_tokenizer('ViT-B-32')
    clip_model = clip_model.to(device).eval()

    cam_k = get_cam_intr(90, 480, 640)
    pose_dir = args.pose_dir.resolve() if args.pose_dir else None
    frame_indices = list(range(len(render['frames'])))
    if pose_dir:
        coverage = json.loads((pose_dir / 'coverage.json').read_text())
        frame_indices = coverage['coveredFrames']
    frames = []
    for k in frame_indices:
        rgb = np.array(Image.open(args.frames / f'{k:04d}.png').convert('RGB'))
        depth = np.load(args.frames / f'{k:04d}.depth.npy')
        pose = np.load((pose_dir / f'{k:04d}.pose.npy') if pose_dir else (args.frames / f'{k:04d}.pose.npy'))
        frames.append((rgb, depth, pose))
    frame_lookup = {k: i for i, k in enumerate(frame_indices)}

    # Detect once; identical across pose conditions.
    detections = []
    for k, (rgb, depth, pose) in enumerate(frames):
        results = detector.predict(rgb, conf=0.1, verbose=False)
        if results[0].boxes is None or len(results[0].boxes) == 0:
            detections.append(None)
            continue
        xyxy = results[0].boxes.xyxy
        conf = results[0].boxes.conf.cpu().numpy()
        cls = results[0].boxes.cls.cpu().numpy().astype(int)
        labels = [f"{class_arr[c]} {i}" for i, c in enumerate(cls)]
        masks = sam.predict(rgb, bboxes=xyxy, verbose=False)[0].masks.data.cpu().numpy()
        det = sv.Detections(xyxy=xyxy.cpu().numpy(), confidence=conf, class_id=cls, mask=masks)
        det, labels = filter_detections(image=rgb, detections=det, classes=classes, given_labels=labels,
                                        iou_threshold=cg['object_detection_iou_threshold'],
                                        min_mask_size_ratio=cg['min_mask_size_ratio'],
                                        confidence_threshold=args.conf)
        if det is None or len(det) == 0:
            detections.append(None)
            continue
        # Guard against boxes outside image bounds: upstream crop padding can
        # otherwise produce right<left. Clip to the true image extent and count
        # only genuine out-of-bounds boxes.
        h, w = rgb.shape[:2]
        raw = det.xyxy.copy()
        outside = ((raw[:, 0] < 0) | (raw[:, 1] < 0) | (raw[:, 2] > w) | (raw[:, 3] > h)).any()
        det.xyxy = np.clip(det.xyxy, [0, 0, 0, 0], [w, h, w, h])
        clipped = int(outside)
        keep = (det.xyxy[:, 2] > det.xyxy[:, 0]) & (det.xyxy[:, 3] > det.xyxy[:, 1])
        if not keep.all():
            det = det[keep]
            if len(det) == 0:
                detections.append(None)
                continue
        crops, image_feats, text_feats = compute_clip_features_batched(
            rgb, det, clip_model, clip_pre, clip_tok, class_arr, device)
        detections.append({'det': det, 'labels': labels, 'image_feats': image_feats,
                           'text_feats': text_feats, 'k': k, 'orig': frame_indices[k], 'clipped': clipped})

    conditions = args.conditions.split(',')
    # magnitude tuple: (yaw_deg, pitch_deg, tx, ty, tz); drift=True ramps it
    perturbations = {
        'gt': (0., 0., 0., 0., 0.),
        'yaw0.5': (.5, 0., 0., 0., 0.), 'yaw1': (1., 0., 0., 0., 0.),
        'yaw2': (2., 0., 0., 0., 0.), 'yaw5': (5., 0., 0., 0., 0.),
        'yaw2_t1cm': (2., 0., .01, 0., 0.), 'yaw2_t3cm': (2., 0., .03, 0., 0.),
        'yaw2_t10cm': (2., 0., .10, 0., 0.),
        'pitch1': (0., 1., 0., 0., 0.), 'pitch2': (0., 2., 0., 0., 0.),
        'yawdrift1': (1., 0., 0., 0., 0.), 'yawdrift2': (2., 0., 0., 0., 0.),
        'tdrift10cm': (0., 0., .10, 0., 0.), 'yaw1_tdrift10cm': (1., 0., .10, 0., 0.),
    }
    drift_conditions = {'yawdrift1', 'yawdrift2', 'tdrift10cm', 'yaw1_tdrift10cm'}
    # A constant offset is only a global rigid transform and must leave relative
    # geometry unchanged; drift ramps the error across the trajectory instead.
    results = {}
    assignments = {}
    for cond in conditions:
        yaw, pitch, tx, ty, tz = perturbations[cond]
        obj = MapObjectDict()
        det_to_obj = {}
        counter = 1
        for item in detections:
            if item is None:
                continue
            k = item['k']
            orig = item['orig']
            rgb, depth, pose = frames[k]
            ramp = (k / max(1, len(frames) - 1)) if cond in drift_conditions else 1.0
            cam_pose = perturb_pose(pose, yaw, pitch, tx, ty, tz, progress=ramp)
            masks = item['det'].mask.astype(np.uint8)
            pcds = detections_to_obj_pcd_and_bbox(
                depth_array=depth, masks=masks, cam_K=cam_k[:3, :3], image_rgb=rgb,
                trans_pose=cam_pose, min_points_threshold=cg['min_points_threshold'],
                spatial_sim_type=cg['spatial_sim_type'], obj_pcd_max_points=cg['obj_pcd_max_points'],
                device=device)
            dl = DetectionDict()
            for i in range(len(masks)):
                p = pcds[i]
                if p is None:
                    continue
                pcd = init_process_pcd(pcd=p['pcd'], downsample_voxel_size=cg['downsample_voxel_size'],
                                       dbscan_remove_noise=cg['dbscan_remove_noise'],
                                       dbscan_eps=cg['dbscan_eps'], dbscan_min_points=cg['dbscan_min_points'])
                bbox = get_bounding_box(spatial_sim_type=cg['spatial_sim_type'], pcd=pcd)
                dl[i] = {'bbox': bbox, 'pcd': pcd, 'clip_ft': item['image_feats'][i],
                         'class_name': class_arr[item['det'].class_id[i]],
                         'conf': float(item['det'].confidence[i]),
                         'xyxy': item['det'].xyxy[i], 'mask': masks[i]}
            if len(dl) == 0:
                continue
            if len(obj) == 0:
                for i, d in dl.items():
                    obj[counter] = d
                    det_to_obj[f'{orig},{i}'] = counter
                    counter += 1
                continue
            spatial = compute_spatial_similarities(cg['spatial_sim_type'], dl, obj,
                                                  cg['downsample_voxel_size'])
            visual = compute_visual_similarities(dl, obj)
            agg = aggregate_similarities(cg['match_method'], cg['phys_bias'], spatial, visual)
            matches = match_detections_to_objects(
                agg_sim=agg, detection_threshold=cg['sim_threshold'],
                existing_obj_ids=list(obj.keys()), detected_obj_ids=list(dl.keys()))
            for det_id, obj_id in matches:
                if obj_id is None:
                    obj[counter] = dl[det_id]
                    det_to_obj[f'{orig},{det_id}'] = counter
                    counter += 1
                else:
                    det_to_obj[f'{orig},{det_id}'] = obj_id
        assignments[cond] = det_to_obj
        results[cond] = {'mapObjects': len(obj), 'detections': len(det_to_obj)}
    keys = sorted(set.intersection(*[set(a) for a in assignments.values()]))
    gt = np.array([assignments['gt'][k] for k in keys])
    metrics = {}
    from sklearn.metrics import adjusted_rand_score
    for cond in conditions:
        pred = np.array([assignments[cond][k] for k in keys])
        splits = 0
        for g in set(gt):
            if len(set(pred[gt == g])) > 1:
                splits += 1
        merges = 0
        for p in set(pred):
            if len(set(gt[pred == p])) > 1:
                merges += 1
        metrics[cond] = {'ariVsGt': float(adjusted_rand_score(gt, pred)),
                         'gtClustersSplit': splits, 'predClustersMerged': merges,
                         'mapObjects': results[cond]['mapObjects']}
    report = {'scope': '3D-Mem mapping functions on ReplicaCAD; pose-only perturbation; no A-EQA/GOAT score',
              'renderScene': render['scene'], 'frames': len(frames), 'conditions': perturbations,
              'driftConditions': sorted(drift_conditions),
              'poseDir': str(pose_dir) if pose_dir else None,
              'frameIndices': frame_indices,
              'metrics': metrics, 'skippedIfNoDetections': [i['orig'] for i in detections if i is None],
              'note': 'pcd/bbox recomputed per condition; detections, masks and CLIP features fixed',
              'framesWithClippedBoxes': [i['orig'] for i in detections if i and i.get('clipped')]}
    (args.output / 'association.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    (args.output / 'assignments.json').write_text(json.dumps(
        {cond: {key: int(value) for key, value in a.items()} for cond, a in assignments.items()},
        indent=1), encoding='utf-8')
    print(json.dumps(metrics, indent=2))


if __name__ == '__main__':
    main()
