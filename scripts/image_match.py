#!/usr/bin/env python3
"""Match query image(s) against candidate images: local features + global similarity.

Reads a JSON request on stdin:
  { "queries": ["<path>", ...], "candidates": [{"id","path"}, ...],
    "minInliers": 20, "ratio": 0.75, "maxDim": 900, "detector": "sift" }

Writes:
  { "ok", "queries": [{path, keypoints}],
    "best":    {id, path, queryPath, inliers, good, ratio, similarity, bbox} | null,  # best by SIFT inliers
    "nearest": {id, path, similarity, inliers, ...} | null,                          # best by global similarity
    "results": [ ... ] }

SIFT inliers answer "same surface / same place under little viewpoint change".
The global similarity (16x16 layout correlation + intensity histogram intersection)
is a cheap "same place under larger viewpoint change" cue, and also gives the
VLM a score for the closest candidate when SIFT fails.
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
        return None, None, None
    h, w = image.shape[:2]
    scale = max_dim / max(h, w) if max(h, w) > max_dim else 1.0
    if scale < 1.0:
        image = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    keypoints, descriptors = detector.detectAndCompute(image, None)
    return keypoints, descriptors, image


def global_descriptor(image):
    if image is None:
        return None
    small = cv2.resize(image, (16, 16), interpolation=cv2.INTER_AREA).astype(np.float32)
    small -= float(small.mean())
    norm = float(np.linalg.norm(small)) or 1.0
    layout = small / norm
    hist = cv2.calcHist([image], [0], None, [16], [0, 256]).flatten().astype(np.float32)
    hist = hist / (float(hist.sum()) or 1.0)
    return (layout, hist)


def global_similarity(a, b) -> float:
    if a is None or b is None:
        return 0.0
    layout = float(np.clip(np.sum(a[0] * b[0]), -1.0, 1.0))
    hist = float(np.minimum(a[1], b[1]).sum())
    return round(0.5 * (0.5 + 0.5 * layout) + 0.5 * hist, 3)


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
        keypoints, descriptors, image = features(path, detector, max_dim)
        queries.append({"path": path, "keypoints": len(keypoints) if keypoints else 0, "feature": (keypoints, descriptors), "global": global_descriptor(image)})

    results = []
    best = None
    nearest = None
    for candidate in candidates:
        keypoints, descriptors, image = features(candidate.get("path", ""), detector, max_dim)
        candidate_global = global_descriptor(image)
        candidate_best = None
        candidate_similarity = 0.0
        for query in queries:
            outcome = match(query["feature"], (keypoints, descriptors), norm, ratio)
            candidate_similarity = max(candidate_similarity, global_similarity(query["global"], candidate_global))
            if candidate_best is None or outcome["inliers"] > candidate_best["inliers"]:
                candidate_best = {**outcome, "queryPath": query["path"]}
        if candidate_best is None:
            candidate_best = {"inliers": 0, "good": 0, "ratio": 0.0, "bbox": None, "queryPath": None}
        entry = {"id": candidate.get("id"), "path": candidate.get("path"), "similarity": candidate_similarity, **candidate_best}
        results.append(entry)
        if best is None or entry["inliers"] > best["inliers"]:
            best = entry
        if nearest is None or entry["similarity"] > nearest["similarity"]:
            nearest = entry

    results.sort(key=lambda item: (item["inliers"], item["similarity"]), reverse=True)
    chosen = best if best and best["inliers"] >= min_inliers else None
    print(json.dumps({
        "ok": True,
        "queries": [{"path": q["path"], "keypoints": q["keypoints"]} for q in queries],
        "best": chosen,
        "nearest": nearest,
        "results": results,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
