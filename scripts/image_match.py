#!/usr/bin/env python3
"""Match one or more query images against several candidate images in one run.

Reads a JSON request on stdin:
  { "queries": ["<path>", ...],            # or "query": "<path>"
    "candidates": [{ "id": "scene-1", "path": "<path>" }, ...],
    "minInliers": 20, "ratio": 0.75, "maxDim": 900, "detector": "sift" }

Writes a JSON response on stdout:
  { "ok": true,
    "queries": [{ "path": "<path>", "keypoints": N }, ...],
    "best": { "id", "path", "queryPath", "inliers", "good", "ratio", "bbox" } | null,
    "results": [ ... best per candidate ... ] }

Method: SIFT -> kNN + Lowe ratio -> RANSAC homography -> inlier count, taking the
best query/candidate pair. Every query is tried so a single bad frame does not
hide a real overlap.
"""

from __future__ import annotations

import json
import sys

try:
    import cv2  # type: ignore
    import numpy as np  # type: ignore
except Exception as exc:  # pragma: no cover
    print(json.dumps({"ok": False, "error": f"opencv/numpy unavailable: {exc}"}))
    sys.exit(2)


def make_detector(name: str):
    name = (name or "sift").lower()
    if name == "sift" and hasattr(cv2, "SIFT_create"):
        return cv2.SIFT_create(nfeatures=2500), cv2.NORM_L2
    if name == "akaze" and hasattr(cv2, "AKAZE_create"):
        return cv2.AKAZE_create(), cv2.NORM_HAMMING
    return cv2.ORB_create(nfeatures=2500), cv2.NORM_HAMMING


def features(path: str, detector, max_dim: int):
    image = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if image is None:
        return None, None
    h, w = image.shape[:2]
    scale = max_dim / max(h, w) if max(h, w) > max_dim else 1.0
    if scale < 1.0:
        image = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    keypoints, descriptors = detector.detectAndCompute(image, None)
    return keypoints, descriptors


def bbox(points):
    if not len(points):
        return None
    xs = [float(p[0]) for p in points]
    ys = [float(p[1]) for p in points]
    return {"x0": round(min(xs), 1), "y0": round(min(ys), 1), "x1": round(max(xs), 1), "y1": round(max(ys), 1)}


def match(query, candidate, norm, ratio: float):
    q_kp, q_des = query
    c_kp, c_des = candidate
    if q_des is None or c_des is None or len(q_kp) < 4 or len(c_kp) < 4:
        return {"inliers": 0, "good": 0, "ratio": 0.0, "bbox": None}
    matcher = cv2.BFMatcher(norm)
    pairs = matcher.knnMatch(q_des, c_des, k=2)
    good = [m for m, n in (pair for pair in pairs if len(pair) == 2) if m.distance < ratio * n.distance]
    inliers = 0
    region = None
    if len(good) >= 4:
        src = np.float32([q_kp[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
        dst = np.float32([c_kp[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
        _, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
        if mask is not None:
            mask = mask.ravel()
            inliers = int(mask.sum())
            region = bbox([q_kp[m.queryIdx].pt for m, ok in zip(good, mask) if ok])
    return {"inliers": inliers, "good": len(good), "ratio": round(inliers / len(good), 3) if good else 0.0, "bbox": region}


def main() -> int:
    try:
        request = json.load(sys.stdin)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"bad request: {exc}"}))
        return 1

    query_paths = request.get("queries")
    if not query_paths:
        single = request.get("query")
        query_paths = [single] if single else []
    candidates = request.get("candidates", [])
    if not query_paths:
        print(json.dumps({"ok": False, "error": "query/queries required"}))
        return 1

    detector, norm = make_detector(request.get("detector", "sift"))
    ratio = float(request.get("ratio", 0.75))
    min_inliers = int(request.get("minInliers", 20))
    max_dim = int(request.get("maxDim", 900))

    queries = []
    for path in query_paths:
        keypoints, descriptors = features(path, detector, max_dim)
        queries.append({"path": path, "keypoints": len(keypoints) if keypoints else 0, "feature": (keypoints, descriptors)})

    results = []
    best = None
    for candidate in candidates:
        candidate_features = features(candidate.get("path", ""), detector, max_dim)
        candidate_best = None
        for query in queries:
            outcome = match(query["feature"], candidate_features, norm, ratio)
            if candidate_best is None or outcome["inliers"] > candidate_best["inliers"]:
                candidate_best = {**outcome, "queryPath": query["path"]}
        if candidate_best is None:
            candidate_best = {"inliers": 0, "good": 0, "ratio": 0.0, "bbox": None, "queryPath": None}
        entry = {"id": candidate.get("id"), "path": candidate.get("path"), **candidate_best}
        results.append(entry)
        if best is None or entry["inliers"] > best["inliers"]:
            best = entry

    results.sort(key=lambda item: item["inliers"], reverse=True)
    chosen = best if best and best["inliers"] >= min_inliers else None
    print(json.dumps({
        "ok": True,
        "queries": [{"path": q["path"], "keypoints": q["keypoints"]} for q in queries],
        "best": chosen,
        "results": results,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
