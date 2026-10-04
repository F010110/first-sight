#!/usr/bin/env python3
"""Detect and localize *local* changes between two views of the same place.

This is the "matching + non-matching" primitive:

  1. SIFT + RANSAC homography aligns the two frames (what stayed the same).
  2. One frame is warped into the other's frame; only the overlap is compared.
  3. The residual is brightness-normalized (to absorb auto-exposure), thresholded
     and grouped into connected "changed" blobs.

A changed blob is exactly a local change: the desk is the same desk, but the
laptop screen flipped black->white, a lamp turned off, an object appeared/moved.

Usage:
  python scripts/image_change.py A.jpg B.jpg [--vis out.jpg] [--min-area 250] [--k 4]
Outputs a single JSON object on stdout.
"""

from __future__ import annotations

import argparse
import json
import sys

try:
    import cv2  # type: ignore
    import numpy as np  # type: ignore
except Exception as exc:  # pragma: no cover
    print(json.dumps({"ok": False, "error": f"opencv/numpy unavailable: {exc}"}))
    sys.exit(2)


def load(path: str, max_dim: int):
    image = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if image is None:
        return None
    h, w = image.shape[:2]
    scale = max_dim / max(h, w) if max(h, w) > max_dim else 1.0
    if scale < 1.0:
        image = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return image


def align(a, b):
    """Returns H mapping A into B's frame, plus the inlier count."""
    sift = cv2.SIFT_create(nfeatures=2500)
    kp_a, des_a = sift.detectAndCompute(a, None)
    kp_b, des_b = sift.detectAndCompute(b, None)
    if des_a is None or des_b is None or len(kp_a) < 8 or len(kp_b) < 8:
        return None, 0
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    pairs = matcher.knnMatch(des_a, des_b, k=2)
    good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < 0.75 * n.distance]
    if len(good) < 8:
        return None, 0
    src = np.float32([kp_a[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kp_b[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    homography, mask = cv2.findHomography(src, dst, cv2.RANSAC, 4.0)
    inliers = int(mask.sum()) if mask is not None else 0
    return homography, inliers


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("a")
    parser.add_argument("b")
    parser.add_argument("--max-dim", type=int, default=640)
    parser.add_argument("--min-area", type=float, default=250, help="minimum blob area in pixels")
    parser.add_argument("--k", type=float, default=4.0, help="threshold = mean + k*std of the residual")
    parser.add_argument("--vis", default=None, help="write a heatmap+boxes visualization here")
    parser.add_argument("--boxes", default=None, help="write the current view with changed-region boxes here")
    parser.add_argument("--edge-margin", type=int, default=3, help="suppress changes within this many px of a strong edge (parallax)")
    args = parser.parse_args()

    a = load(args.a, args.max_dim)
    b = load(args.b, args.max_dim)
    if a is None or b is None:
        print(json.dumps({"ok": False, "error": "cannot read one of the images"}))
        return 1

    homography, inliers = align(a, b)
    hb, wb = b.shape[:2]
    if homography is not None:
        warped = cv2.warpPerspective(a, homography, (wb, hb))
        mask = cv2.warpPerspective(np.ones_like(a, dtype=np.uint8), homography, (wb, hb))
    else:
        # No reliable alignment: compare directly (assume the camera barely moved).
        warped, mask = a, np.ones_like(b, dtype=np.uint8)

    overlap = mask > 0
    overlap_ratio = float(overlap.mean())
    if overlap_ratio < 0.2:
        print(json.dumps({"ok": True, "aligned": homography is not None, "inliers": inliers, "overlapRatio": round(overlap_ratio, 3), "changed": False, "reason": "too little overlap"}))
        return 0

    # Only compare well inside the overlap: pixels near the overlap border are
    # newly revealed by the camera moving/turning, not scene changes.
    margin = max(4, int(0.03 * min(wb, hb)))
    interior = cv2.erode((overlap.astype(np.uint8) * 255), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (margin | 1, margin | 1))) > 0
    compare = interior if int(interior.sum()) > int(0.15 * overlap.sum()) else overlap

    # Brightness-normalize inside the comparison area so auto-exposure does not dominate.
    diff = cv2.absdiff(warped, b).astype(np.float32)
    diff[~compare] = 0
    shift = float(np.median((warped.astype(np.float32) - b.astype(np.float32))[compare]))
    normalized = np.abs((warped.astype(np.float32) - shift) - b.astype(np.float32))
    normalized[~compare] = 0
    blurred = cv2.GaussianBlur(normalized, (7, 7), 0)

    values = blurred[compare]
    threshold = max(12.0, float(values.mean() + args.k * values.std()))
    binary = ((blurred > threshold) & compare).astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
    binary = cv2.dilate(binary, kernel, iterations=2)

    # Parallax / occlusion shows up right at object boundaries; suppress residual
    # changes within a small margin of strong edges so camera movement inside the
    # same place is not mistaken for a scene change.
    if args.edge_margin > 0:
        edges = cv2.Canny(b, 60, 160)
        edge_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (args.edge_margin * 2 + 1, args.edge_margin * 2 + 1))
        edges = cv2.dilate(edges, edge_kernel)
        binary[edges > 0] = 0

    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    regions = []
    for index in range(1, count):
        x, y, w, h, area = stats[index]
        if area < args.min_area:
            continue
        region_mask = labels == index
        regions.append({
            "x": int(x), "y": int(y), "w": int(w), "h": int(h),
            "area": int(area),
            "meanDiff": round(float(blurred[region_mask].mean()), 1),
        })
    regions.sort(key=lambda r: r["area"], reverse=True)
    changed_ratio = float((binary > 0).sum()) / float(compare.sum() or 1)

    result = {
        "ok": True,
        "aligned": homography is not None,
        "inliers": inliers,
        "overlapRatio": round(overlap_ratio, 3),
        "threshold": round(threshold, 1),
        "changedRatio": round(changed_ratio, 4),
        "compareArea": int(compare.sum()),
        "width": int(wb),
        "height": int(hb),
        "regions": regions[:8],
        "changed": changed_ratio >= 0.005 or len(regions) > 0,
    }

    if args.vis:
        vis = cv2.cvtColor(b, cv2.COLOR_GRAY2BGR)
        heat = cv2.applyColorMap(cv2.convertScaleAbs(blurred, alpha=255.0 / max(1.0, threshold * 2)), cv2.COLORMAP_JET)
        vis = cv2.addWeighted(vis, 0.6, heat, 0.4, 0)
        for region in regions:
            cv2.rectangle(vis, (region["x"], region["y"]), (region["x"] + region["w"], region["y"] + region["h"]), (0, 255, 255), 2)
        cv2.imwrite(args.vis, vis)

    if args.boxes:
        boxes = cv2.cvtColor(b, cv2.COLOR_GRAY2BGR)
        for region in regions:
            cv2.rectangle(boxes, (region["x"] - 4, region["y"] - 4), (region["x"] + region["w"] + 4, region["y"] + region["h"] + 4), (0, 200, 255), 2)
        cv2.imwrite(args.boxes, boxes)

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
