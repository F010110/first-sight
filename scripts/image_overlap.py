#!/usr/bin/env python3
"""Decide whether two photos share a common region (image overlap / place match).

This is the classic local-feature pipeline:

  1. detect keypoints + descriptors (SIFT, scale/rotation invariant)
  2. ratio-test the mutual nearest-neighbour matches
  3. fit a homography with RANSAC and count geometric inliers

A high inlier count means a consistent 2D transform maps part of one image onto
part of the other, i.e. they really do show the same surface/objects even at a
different scale or viewpoint (e.g. a wide shot with a desk on the right vs a
close-up of that desk).

It also reports the matched-region bounding box in each image, so the caller can
tell *which part* overlaps.

Usage:
  python scripts/image_overlap.py A.jpg B.jpg [--min-inliers 15] [--vis out.jpg]
Outputs a single JSON object on stdout.
"""

from __future__ import annotations

import argparse
import json
import sys

try:
    import cv2  # type: ignore
    import numpy as np  # type: ignore
except Exception as exc:  # pragma: no cover - environment dependent
    print(json.dumps({"ok": False, "error": f"opencv/numpy unavailable: {exc}"}))
    sys.exit(2)


def make_detector(name: str):
    name = name.lower()
    if name == "sift" and hasattr(cv2, "SIFT_create"):
        return cv2.SIFT_create(nfeatures=2500), cv2.NORM_L2
    if name == "akaze" and hasattr(cv2, "AKAZE_create"):
        return cv2.AKAZE_create(), cv2.NORM_HAMMING
    return cv2.ORB_create(nfeatures=2500), cv2.NORM_HAMMING


def bbox(points):
    if len(points) == 0:
        return None
    xs = [float(p[0]) for p in points]
    ys = [float(p[1]) for p in points]
    return {"x0": round(min(xs), 1), "y0": round(min(ys), 1), "x1": round(max(xs), 1), "y1": round(max(ys), 1)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("a")
    parser.add_argument("b")
    parser.add_argument("--detector", default="sift")
    parser.add_argument("--ratio", type=float, default=0.75)
    parser.add_argument("--min-inliers", type=int, default=15)
    parser.add_argument("--max-dim", type=int, default=900, help="downscale the long side for speed")
    parser.add_argument("--vis", default=None, help="write a match visualization here")
    args = parser.parse_args()

    gray = []
    sizes = []
    for path in (args.a, args.b):
        image = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        if image is None:
            print(json.dumps({"ok": False, "error": f"cannot read {path}"}))
            return 1
        h, w = image.shape[:2]
        scale = args.max_dim / max(h, w) if max(h, w) > args.max_dim else 1.0
        if scale < 1.0:
            image = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        gray.append(image)
        sizes.append(image.shape[:2])

    detector, norm = make_detector(args.detector)
    features = []
    for image in gray:
        keypoints, descriptors = detector.detectAndCompute(image, None)
        features.append((keypoints, descriptors))

    (kp_a, des_a), (kp_b, des_b) = features
    if des_a is None or des_b is None or len(kp_a) < 4 or len(kp_b) < 4:
        print(json.dumps({"ok": True, "overlap": False, "reason": "too_few_features", "keypointsA": len(kp_a), "keypointsB": len(kp_b)}))
        return 0

    matcher = cv2.BFMatcher(norm)
    pairs = matcher.knnMatch(des_a, des_b, k=2)
    good = [m for m, n in (pair for pair in pairs if len(pair) == 2) if m.distance < args.ratio * n.distance]

    inliers = 0
    region_a = region_b = None
    if len(good) >= 4:
        src = np.float32([kp_a[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
        dst = np.float32([kp_b[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
        homography, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
        if mask is not None:
            mask = mask.ravel()
            inliers = int(mask.sum())
            kept_a = [kp_a[m.queryIdx].pt for m, ok in zip(good, mask) if ok]
            kept_b = [kp_b[m.trainIdx].pt for m, ok in zip(good, mask) if ok]
            region_a, region_b = bbox(kept_a), bbox(kept_b)

    overlap = inliers >= args.min_inliers
    result = {
        "ok": True,
        "detector": args.detector,
        "keypointsA": len(kp_a),
        "keypointsB": len(kp_b),
        "goodMatches": len(good),
        "inliers": inliers,
        "inlierRatio": round(inliers / len(good), 3) if good else 0.0,
        "overlap": overlap,
        "bboxA": region_a,
        "bboxB": region_b,
        "sizeA": [sizes[0][1], sizes[0][0]],
        "sizeB": [sizes[1][1], sizes[1][0]],
    }

    if args.vis and len(good):
        drawn = cv2.drawMatches(gray[0], kp_a, gray[1], kp_b, good[:80], None, flags=cv2.DrawMatchesFlags_NOT_DRAW_SINGLE_POINTS)
        cv2.imwrite(args.vis, drawn)

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
