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

import hashlib
import json
import os
import pickle
import sys
import tempfile

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


CACHE_VERSION = 1


def cache_key(path: str, detector_name: str, max_dim: int) -> str | None:
    """Include file identity so changed/replaced originals never reuse old features."""
    try:
        stat = os.stat(path)
    except OSError:
        return None
    identity = f"{CACHE_VERSION}|{os.path.abspath(path)}|{stat.st_mtime_ns}|{stat.st_size}|{detector_name}|{max_dim}".encode()
    return hashlib.sha256(identity).hexdigest()


def cached_global_features(path: str, detector, detector_name: str, max_dim: int, cache: bool):
    """Keypoints, descriptors and global descriptor, optionally cached outside the archive.

    This cache is only an acceleration of deterministic image features; it never
    stores identity decisions or candidate scores. File mtime/size are part of the
    key, and an unreadable or ancient cache entry simply falls back to recompute.
    """
    key = cache_key(path, detector_name, max_dim) if cache else None
    cache_path = os.path.join(tempfile.gettempdir(), "first-sight-image-match", key + ".pickle") if key else None
    if cache_path and os.path.exists(cache_path):
        try:
            with open(cache_path, "rb") as handle:
                payload = pickle.load(handle)
            points = [cv2.KeyPoint(float(x), float(y), 1.0) for x, y in payload["points"]]
            return points, payload["descriptors"], (payload["layout"], payload["hist"]), payload["keypoints"]
        except Exception:
            try:
                os.remove(cache_path)
            except OSError:
                pass
    keypoints, descriptors, image = features(path, detector, max_dim)
    global_desc = global_descriptor(image)
    if cache_path and descriptors is not None and keypoints is not None and global_desc is not None:
        temporary = cache_path + f".{os.getpid()}.tmp"
        try:
            os.makedirs(os.path.dirname(cache_path), exist_ok=True)
            payload = {
                "points": [list(point.pt) for point in keypoints],
                "descriptors": descriptors,
                "layout": global_desc[0],
                "hist": global_desc[1],
                "keypoints": len(keypoints),
            }
            with open(temporary, "wb") as handle:
                pickle.dump(payload, handle, protocol=pickle.HIGHEST_PROTOCOL)
            os.replace(temporary, cache_path)
        except Exception:
            try:
                os.remove(temporary)
            except OSError:
                pass
    return keypoints, descriptors, global_desc, len(keypoints) if keypoints else 0


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

    detector_name = str(request.get("detector", "sift")).lower()
    detector, norm = make_detector(detector_name)
    ratio = float(request.get("ratio", 0.75))
    min_inliers = int(request.get("minInliers", 20))
    max_dim = int(request.get("maxDim", 900))
    cache = bool(request.get("cache", False))

    queries = []
    for path in query_paths:
        keypoints, descriptors, query_global, keypoint_count = cached_global_features(path, detector, detector_name, max_dim, cache)
        queries.append({"path": path, "keypoints": keypoint_count, "feature": (keypoints, descriptors), "global": query_global})

    results = []
    best = None
    nearest = None
    for candidate in candidates:
        keypoints, descriptors, candidate_global, _ = cached_global_features(candidate.get("path", ""), detector, detector_name, max_dim, cache)
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
