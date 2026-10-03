#!/usr/bin/env python3
"""Build a first sparse monocular map from captured phone frames and motion samples."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


def empty_result(status: str, message: str) -> dict[str, Any]:
    return {
        "status": status,
        "engine": "opencv-orb-essential-matrix",
        "points": [],
        "cameraPositions": [],
        "diagnostics": {},
        "scale": "unavailable",
        "notes": [message],
    }


def read_manifest(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError("capture manifest must be a JSON object")
    return value


def load_motion_prior(cv2: Any, np: Any, samples: list[dict[str, Any]], start_ms: float, end_ms: float, screen_angle: float) -> Any | None:
    selected = [row for row in samples if start_ms <= float(row.get("timeMs", -1)) <= end_ms]
    if len(selected) < 2 or end_ms <= start_ms:
        return None

    # DeviceMotionEvent uses alpha around device Z, beta around X, gamma around Y.
    # For the default portrait rear-camera view, map device axes to approximate camera axes.
    angle = math.radians(screen_angle % 360.0)
    c, s = math.cos(angle), math.sin(angle)
    screen_rotation = np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]], dtype=np.float64)
    device_to_camera = np.diag([1.0, -1.0, -1.0]) @ screen_rotation
    rotation = np.eye(3, dtype=np.float64)
    valid = 0
    for before, after in zip(selected, selected[1:]):
        t0 = float(before.get("timeMs", 0.0))
        t1 = float(after.get("timeMs", t0))
        dt = min(0.1, max(0.0, (t1 - t0) / 1000.0))
        rate = before.get("rotationRate")
        if dt <= 0 or not isinstance(rate, dict):
            continue
        alpha, beta, gamma = (rate.get("alpha"), rate.get("beta"), rate.get("gamma"))
        if not all(isinstance(item, (int, float)) and math.isfinite(item) for item in (alpha, beta, gamma)):
            continue
        device_rate = np.array([beta, gamma, alpha], dtype=np.float64) * (math.pi / 180.0)
        # Camera-coordinate relative rotation is opposite the phone's angular motion.
        camera_rate = -(device_to_camera @ device_rate)
        delta, _ = cv2.Rodrigues(camera_rate * dt)
        rotation = delta @ rotation
        valid += 1
    return rotation if valid >= 2 else None


def rotation_error(cv2: Any, np: Any, left: Any, right: Any) -> float:
    relative = left @ right.T
    vector, _ = cv2.Rodrigues(relative)
    return float(np.linalg.norm(vector))


def choose_pose(cv2: Any, np: Any, essential: Any, camera: Any, points_a: Any, points_b: Any, gyro_prior: Any | None) -> tuple[Any, Any, Any, int, float | None]:
    rotation_a, rotation_b, direction = cv2.decomposeEssentialMat(essential)
    candidates = []
    identity = np.eye(3, dtype=np.float64)
    zero = np.zeros((3, 1), dtype=np.float64)
    first_projection = camera @ np.hstack((identity, zero))
    for rotation in (rotation_a, rotation_b):
        for sign in (-1.0, 1.0):
            translation = direction * sign
            second_projection = camera @ np.hstack((rotation, translation))
            homogeneous = cv2.triangulatePoints(first_projection, second_projection, points_a.T, points_b.T)
            valid_w = np.abs(homogeneous[3]) > 1e-8
            xyz = np.full((3, homogeneous.shape[1]), np.nan, dtype=np.float64)
            xyz[:, valid_w] = homogeneous[:3, valid_w] / homogeneous[3, valid_w]
            second_xyz = rotation @ xyz + translation
            positive = valid_w & (xyz[2] > 0.03) & (second_xyz[2] > 0.03) & (xyz[2] < 150.0)
            positive_count = int(np.count_nonzero(positive))
            angle_error = rotation_error(cv2, np, rotation, gyro_prior) if gyro_prior is not None else None
            score = float(positive_count)
            if angle_error is not None:
                score -= min(math.pi, angle_error) * 8.0
            candidates.append((score, rotation, translation, xyz, positive_count, angle_error))
    best = max(candidates, key=lambda row: row[0])
    return best[1], best[2], best[3], best[4], best[5]


def build_model(manifest: dict[str, Any], base_dir: Path) -> dict[str, Any]:
    try:
        import cv2
        import numpy as np
    except Exception as error:  # Keep collection usable when the vision engine is not installed.
        return empty_result("engine_unavailable", f"三维重建引擎不可用：{error}。请安装 requirements.txt 中的 OpenCV 与 NumPy 后重试。")

    frames = manifest.get("frames", [])
    if not isinstance(frames, list) or len(frames) < 3:
        return empty_result("insufficient_frames", "有效图像帧不足，至少需要 3 帧。")
    camera_info = manifest.get("camera", {})
    width = int(camera_info.get("actualWidth") or frames[0].get("width") or 640)
    height = int(camera_info.get("actualHeight") or frames[0].get("height") or 480)
    focal = 0.92 * max(width, height)
    camera = np.array([[focal, 0.0, width / 2.0], [0.0, focal, height / 2.0], [0.0, 0.0, 1.0]], dtype=np.float64)
    screen_angle = float(camera_info.get("screenOrientationAngle") or 0.0)
    motion_samples = manifest.get("motionSamples", [])
    if not isinstance(motion_samples, list):
        motion_samples = []

    orb = cv2.ORB_create(nfeatures=1400, scaleFactor=1.18, nlevels=8, edgeThreshold=19, fastThreshold=11)
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    loaded: list[tuple[dict[str, Any], Any, Any, Any]] = []
    skipped_images = 0
    for row in frames:
        image_path = (base_dir / str(row.get("path", ""))).resolve()
        try:
            image_path.relative_to(base_dir.resolve())
        except ValueError:
            skipped_images += 1
            continue
        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if image is None:
            skipped_images += 1
            continue
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        keypoints, descriptors = orb.detectAndCompute(gray, None)
        if descriptors is None or len(keypoints) < 25:
            skipped_images += 1
            continue
        loaded.append((row, image, keypoints, descriptors))

    if len(loaded) < 3:
        result = empty_result("insufficient_visual_features", "图像中可稳定跟踪的纹理特征不足。请在光线充足、有角点和纹理的场景重新采集。")
        result["diagnostics"] = {"frameCount": len(frames), "usableFeatureFrames": len(loaded), "skippedFrames": skipped_images}
        return result

    positions: list[dict[str, Any]] = [{"frameIndex": int(loaded[0][0].get("index", 0)), "timeMs": float(loaded[0][0].get("timeMs", 0.0)), "position": [0.0, 0.0, 0.0]}]
    points_world: list[list[float]] = []
    pair_rows: list[dict[str, Any]] = []
    world_from_camera = np.eye(3, dtype=np.float64)
    camera_center = np.zeros(3, dtype=np.float64)
    last_keyframe = loaded[0]
    accepted_pairs = 0
    gyro_errors: list[float] = []

    for current in loaded[1:]:
        row_a, image_a, keypoints_a, descriptors_a = last_keyframe
        row_b, image_b, keypoints_b, descriptors_b = current
        try:
            knn = matcher.knnMatch(descriptors_a, descriptors_b, k=2)
        except cv2.error:
            pair_rows.append({"from": int(row_a.get("index", 0)), "to": int(row_b.get("index", 0)), "status": "descriptor_match_error"})
            continue
        good = [pair[0] for pair in knn if len(pair) >= 2 and pair[0].distance < 0.74 * pair[1].distance]
        if len(good) < 18:
            pair_rows.append({"from": int(row_a.get("index", 0)), "to": int(row_b.get("index", 0)), "status": "few_matches", "matches": len(good)})
            continue
        xy_a = np.float64([keypoints_a[match.queryIdx].pt for match in good])
        xy_b = np.float64([keypoints_b[match.trainIdx].pt for match in good])
        parallax = np.linalg.norm(xy_a - xy_b, axis=1)
        median_parallax = float(np.median(parallax))
        if median_parallax < 1.3:
            pair_rows.append({"from": int(row_a.get("index", 0)), "to": int(row_b.get("index", 0)), "status": "low_parallax", "matches": len(good), "medianParallaxPx": round(median_parallax, 3)})
            continue
        try:
            essential, mask = cv2.findEssentialMat(xy_a, xy_b, camera, method=cv2.RANSAC, prob=0.999, threshold=1.35)
        except cv2.error:
            essential, mask = None, None
        if essential is None or mask is None or essential.shape[0] < 3:
            pair_rows.append({"from": int(row_a.get("index", 0)), "to": int(row_b.get("index", 0)), "status": "essential_matrix_failed", "matches": len(good), "medianParallaxPx": round(median_parallax, 3)})
            continue
        if essential.shape[0] > 3:
            essential = essential[:3, :]
        inliers = mask.ravel().astype(bool)
        inlier_count = int(np.count_nonzero(inliers))
        if inlier_count < 14:
            pair_rows.append({"from": int(row_a.get("index", 0)), "to": int(row_b.get("index", 0)), "status": "few_ransac_inliers", "matches": len(good), "inliers": inlier_count, "medianParallaxPx": round(median_parallax, 3)})
            continue
        inlier_a = xy_a[inliers]
        inlier_b = xy_b[inliers]
        t0 = float(row_a.get("timeMs", 0.0))
        t1 = float(row_b.get("timeMs", t0))
        gyro_prior = load_motion_prior(cv2, np, motion_samples, t0, t1, screen_angle)
        try:
            rotation, translation, xyz, positive_count, gyro_error = choose_pose(cv2, np, essential, camera, inlier_a, inlier_b, gyro_prior)
        except cv2.error:
            pair_rows.append({"from": int(row_a.get("index", 0)), "to": int(row_b.get("index", 0)), "status": "triangulation_failed", "matches": len(good), "inliers": inlier_count})
            continue
        if gyro_error is not None:
            gyro_errors.append(math.degrees(gyro_error))
        if positive_count < 10:
            pair_rows.append({"from": int(row_a.get("index", 0)), "to": int(row_b.get("index", 0)), "status": "weak_cheirality", "matches": len(good), "inliers": inlier_count, "positiveDepthPoints": positive_count})
            continue

        # Monocular translation magnitude is unobservable here. Preserve the recovered direction
        # and use a unit baseline, which is explicitly reported as non-metric.
        translation = translation.reshape(3)
        translation /= max(1e-9, float(np.linalg.norm(translation)))
        relative_camera_to_world = rotation.T
        next_world_from_camera = world_from_camera @ relative_camera_to_world
        next_center = camera_center - next_world_from_camera @ translation
        valid = np.isfinite(xyz).all(axis=0) & (xyz[2] > 0.03) & (xyz[2] < 45.0)
        xyz_valid = xyz[:, valid]
        pixels_valid = inlier_a[valid]
        colors = []
        h, w = image_a.shape[:2]
        for px, py in pixels_valid:
            col = int(np.clip(round(px), 0, w - 1))
            row = int(np.clip(round(py), 0, h - 1))
            b, g, r = image_a[row, col]
            colors.append((int(r), int(g), int(b)))
        world_points = camera_center[:, None] + world_from_camera @ xyz_valid
        for column in range(world_points.shape[1]):
            point = world_points[:, column]
            color = colors[column]
            if np.isfinite(point).all():
                points_world.append([round(float(point[0]), 5), round(float(point[1]), 5), round(float(point[2]), 5), *color])
        camera_center = next_center
        world_from_camera = next_world_from_camera
        pose = {"frameIndex": int(row_b.get("index", 0)), "timeMs": t1, "position": [round(float(value), 6) for value in camera_center]}
        positions.append(pose)
        accepted_pairs += 1
        pair_rows.append({
            "from": int(row_a.get("index", 0)), "to": int(row_b.get("index", 0)), "status": "accepted",
            "matches": len(good), "inliers": inlier_count, "positiveDepthPoints": positive_count,
            "medianParallaxPx": round(median_parallax, 3), "gyroPriorUsed": gyro_prior is not None,
            "gyroRotationDifferenceDeg": round(math.degrees(gyro_error), 2) if gyro_error is not None else None,
        })
        # Rebase from accepted keyframes so small inter-frame motion does not dominate the map.
        last_keyframe = current

    points_world = points_world[:6000]
    if accepted_pairs >= 3 and len(points_world) >= 80:
        status = "model_built"
        notes = ["已从真实相机帧恢复稀疏相机轨迹与三维特征点。", "单目尺度未确定；当前点云是相对几何模型，不可直接当作厘米级尺寸。", "相机焦距使用图像尺寸估值，下一步可加入手机相机标定和 IMU 偏置校准。"]
    elif accepted_pairs > 0 and len(points_world) >= 12:
        status = "partial_model"
        notes = ["已恢复部分相机运动与三维特征点，但视差或可跟踪纹理不足，模型尚不完整。", "单目尺度未确定，点云目前仅表示相对几何。建议慢速平移手机并覆盖不同距离的纹理物体。"]
    else:
        status = "insufficient_visual_motion"
        notes = ["图像与运动数据已收到，但当前运动/纹理不足以稳定恢复三维结构。", "请让手机产生明显的平移视差；单纯原地转动通常无法建立可靠的三维点云。"]

    result = {
        "status": status,
        "engine": "opencv-orb-essential-matrix+gyro-rotation-prior",
        "points": points_world,
        "cameraPositions": positions,
        "diagnostics": {
            "frameCount": len(frames), "usableFeatureFrames": len(loaded), "skippedFrames": skipped_images,
            "acceptedPairs": accepted_pairs, "pairDiagnostics": pair_rows,
            "gyroPriorPairs": sum(1 for row in pair_rows if row.get("gyroPriorUsed")),
            "meanGyroRotationDifferenceDeg": round(sum(gyro_errors) / len(gyro_errors), 2) if gyro_errors else None,
            "pointCount": len(points_world), "intrinsics": "estimated from image size; not camera-calibrated",
        },
        "scale": "monocular-relative-unit-baseline",
        "notes": notes,
    }
    return result


def write_ply(path: Path, result: dict[str, Any]) -> None:
    points = result.get("points", [])
    with path.open("w", encoding="ascii", newline="\n") as handle:
        handle.write("ply\nformat ascii 1.0\n")
        handle.write(f"element vertex {len(points)}\n")
        handle.write("property float x\nproperty float y\nproperty float z\n")
        handle.write("property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n")
        for point in points:
            handle.write(" ".join(str(value) for value in point) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    try:
        manifest = read_manifest(args.manifest)
        result = build_model(manifest, args.manifest.parent)
    except Exception as error:
        result = empty_result("reconstruction_error", f"三维重建异常：{type(error).__name__}: {error}")
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    write_ply(args.output.with_suffix(".ply"), result)
    print(json.dumps({"status": result["status"], "diagnostics": result.get("diagnostics", {}), "pointCount": len(result.get("points", []))}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
