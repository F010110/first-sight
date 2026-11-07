#!/usr/bin/env python3
"""Persistent bounded visual place index.

One long-running process keeps a small visual index for revisit recall. It never
spawns per window and has no wall-clock match timeout: the work is bounded by
the index size (places x images) and the shortlist, not by a seconds budget.

Protocol: JSON lines on stdin/stdout.

  {"op":"match","id":1,"queries":[{"path":...},...],
   "places":[{"placeId":...,"name":...,"members":[{"observationId":...,"atMs":...,"path":...,"direction":...},...]}],
   "imagesPerPlace":4,"shortlistPlaces":8,"siftImagesPerPlace":2,
   "minInliers":20,"maxDim":640,"ratio":0.75}
  -> {"id":1,"ok":true,"results":[...],"nearest":...,"stats":{...}}

  {"op":"close"}
"""
from __future__ import annotations

import json
import os
import sys
import time
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from image_match import (  # type: ignore
    cached_global_features,
    features,
    global_descriptor,
    global_similarity,
    make_detector,
    match as match_pair,
)

import cv2  # type: ignore


def _global_only(path: str, max_dim: int):
    image = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if image is None:
        return None
    h, w = image.shape[:2]
    scale = max_dim / max(h, w) if max(h, w) > max_dim else 1.0
    if scale < 1.0:
        image = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return global_descriptor(image)


def select_diverse(members: list[dict[str, Any]], n: int) -> list[dict[str, Any]]:
    """Pick up to n images spread over time and camera directions."""
    if n < 1 or not members:
        return []
    by_observation: dict[str, list[dict[str, Any]]] = {}
    for member in members:
        if not member.get("path"):
            continue
        by_observation.setdefault(str(member.get("observationId")), []).append(member)
    observations = sorted(by_observation.values(), key=lambda group: float(group[0].get("atMs") or 0))
    if not observations:
        return []
    if n == 1:
        chosen = [observations[0]]
    elif n >= len(observations):
        chosen = observations
    else:
        indexes = []
        for i in range(n):
            index = round(i * (len(observations) - 1) / (n - 1))
            if index not in indexes:
                indexes.append(index)
        chosen = [observations[index] for index in indexes]
    selected: list[dict[str, Any]] = []
    used_directions: set[str] = set()
    for group in chosen:
        ordered = sorted(group, key=lambda item: {"front": 0, "left": 1, "right": 2}.get(str(item.get("direction")), 9))
        available = [item for item in ordered if str(item.get("direction")) not in used_directions] or ordered
        item = available[0]
        used_directions.add(str(item.get("direction")))
        selected.append(item)
    # Fill with unused members if quantization produced fewer than n.
    if len(selected) < n:
        for item in members:
            if item in selected:
                continue
            selected.append(item)
            if len(selected) >= n:
                break
    return selected[:n]


class ImageIndex:
    def __init__(self, detector_name: str = "sift", max_dim: int = 640):
        self.detector, self.norm = make_detector(detector_name)
        self.detector_name = detector_name
        self.max_dim = max_dim
        self.places: dict[str, dict[str, Any]] = {}
        self._globals: dict[str, Any] = {}
        self._features: dict[str, tuple[Any, Any]] = {}
        self._keys: dict[str, str] = {}

    def _key(self, path: str) -> str:
        try:
            stat = os.stat(path)
            return f"{os.path.abspath(path)}|{stat.st_mtime_ns}|{stat.st_size}"
        except OSError:
            return f"{os.path.abspath(path)}|missing"

    def _global(self, path: str):
        key = self._key(path)
        if key not in self._globals:
            self._globals[key] = _global_only(path, self.max_dim)
        return self._globals[key]

    def _sift(self, path: str):
        key = self._key(path)
        if key not in self._features:
            self._features[key] = features(path, self.detector, self.max_dim)[:2]
        return self._features[key]

    def sync(self, places: list[dict[str, Any]], images_per_place: int):
        active = {}
        for place in places:
            place_id = str(place.get("placeId") or "")
            if not place_id:
                continue
            selected = select_diverse(place.get("members") or [], images_per_place)
            if selected:
                active[place_id] = {"name": place.get("name") or place_id, "selected": selected}
        self.places = active

    def match(
        self,
        queries: list[dict[str, Any]],
        places: list[dict[str, Any]],
        images_per_place: int = 4,
        shortlist_places: int = 8,
        sift_images_per_place: int = 2,
        min_inliers: int = 20,
        ratio: float = 0.75,
    ):
        started = time.time()
        self.sync(places, images_per_place)
        query_globals = [self._global(str(query.get("path") or "")) for query in queries]
        scored: list[tuple[str, list[tuple[dict[str, Any], float]]]] = []
        nearest = None
        for place_id, place in self.places.items():
            items = []
            for image in place["selected"]:
                image_global = self._global(str(image.get("path") or ""))
                similarity = max((global_similarity(q, image_global) for q in query_globals if q is not None), default=0.0)
                items.append((image, similarity))
            items.sort(key=lambda pair: pair[1], reverse=True)
            scored.append((place_id, items))
            if items and (nearest is None or items[0][1] > nearest.get("similarity", 0.0)):
                nearest = {"id": place_id, "path": items[0][0].get("path"), "similarity": items[0][1], "queryPath": None}
        scored.sort(key=lambda pair: pair[1][0][1] if pair[1] else 0.0, reverse=True)
        shortlist = scored[: max(1, shortlist_places)]
        query_features = [self._sift(str(query.get("path") or "")) for query in queries]
        results = []
        sift_pairs = 0
        for place_id, items in shortlist:
            best = None
            for image, similarity in items[: max(1, sift_images_per_place)]:
                candidate_features = self._sift(str(image.get("path") or ""))
                for query_index, query_feature in enumerate(query_features):
                    sift_pairs += 1
                    outcome = match_pair(query_feature, candidate_features, self.norm, ratio)
                    if best is None or outcome["inliers"] > best["inliers"]:
                        best = {
                            "id": place_id,
                            "path": image.get("path"),
                            "queryPath": queries[query_index].get("path"),
                            "similarity": similarity,
                            "inliers": outcome["inliers"],
                            "good": outcome["good"],
                            "ratio": outcome["ratio"],
                            "bbox": outcome["bbox"],
                        }
            if best is not None:
                results.append(best)
        results.sort(key=lambda entry: (entry["inliers"], entry["similarity"]), reverse=True)
        return {
            "ok": True,
            "results": results,
            "best": results[0] if results else None,
            "nearest": nearest,
            "stats": {
                "places": len(self.places),
                "queryImages": len(queries),
                "imagesPerPlace": images_per_place,
                "shortlistPlaces": len(shortlist),
                "siftPairs": sift_pairs,
                "elapsedMs": round((time.time() - started) * 1000, 1),
                "cachedGlobal": len(self._globals),
                "cachedSift": len(self._features),
            },
        }


def serve() -> int:
    index = ImageIndex()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except Exception as exc:
            print(json.dumps({"ok": False, "error": f"bad request: {exc}"}), flush=True)
            continue
        operation = request.get("op")
        request_id = request.get("id")
        try:
            if operation == "close":
                print(json.dumps({"id": request_id, "ok": True}), flush=True)
                return 0
            if operation == "match":
                response = index.match(
                    request.get("queries") or [],
                    request.get("places") or [],
                    images_per_place=int(request.get("imagesPerPlace", 4)),
                    shortlist_places=int(request.get("shortlistPlaces", 8)),
                    sift_images_per_place=int(request.get("siftImagesPerPlace", 2)),
                    min_inliers=int(request.get("minInliers", 20)),
                    ratio=float(request.get("ratio", 0.75)),
                )
                response["id"] = request_id
                print(json.dumps(response, ensure_ascii=False), flush=True)
            elif operation == "stats":
                print(json.dumps({"id": request_id, "ok": True, "places": len(index.places)}), flush=True)
            else:
                print(json.dumps({"id": request_id, "ok": False, "error": "unknown operation"}), flush=True)
        except Exception as exc:
            print(json.dumps({"id": request_id, "ok": False, "error": str(exc)}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(serve())
