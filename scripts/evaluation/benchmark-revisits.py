#!/usr/bin/env python3
"""Matcher-only revisit benchmark on the 813 sample.

For each reference revisit return window, build a bounded visual index from
observations before that window and ask the persistent index whether it recalls
the correct older place. No VLM is involved; this only measures visual candidate
recall and latency for different images-per-place counts.
"""
import argparse
import json
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "media"))
from image_index import ImageIndex  # type: ignore


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--reference", required=True)
    parser.add_argument("--scorecard", required=True)
    parser.add_argument("--images-per-place", default="6")
    parser.add_argument("--candidate-counts", default="1,2,5,10,20,50,100")
    parser.add_argument("--shortlist-places", type=int, default=100)
    parser.add_argument("--window", type=int, default=8)
    parser.add_argument("--out")
    args = parser.parse_args()

    bundle = json.loads(Path(args.bundle).read_text(encoding="utf-8"))
    reference = json.loads(Path(args.reference).read_text(encoding="utf-8"))
    scorecard = json.loads(Path(args.scorecard).read_text(encoding="utf-8"))
    observations = bundle["observations"]
    order = [item["id"] for item in observations]
    index_of = {item_id: position for position, item_id in enumerate(order)}
    by_id = {item["id"]: item for item in observations}
    place_of = {item["id"]: item["annotation"]["placeId"] for item in bundle["reference"]}

    pairs = scorecard["findings"]["revisits"]
    all_results = []
    for n_text in str(args.images_per_place).split(","):
        n = int(n_text)
        index = ImageIndex()
        rows = []
        total_started = time.time()
        for pair in pairs:
            query_id = pair["b"]
            if query_id not in index_of:
                rows.append({**pair, "top1": None, "top2": None, "note": "query not in bundle"})
                continue
            position = index_of[query_id]
            start = (position // args.window) * args.window
            window = [order[i] for i in range(start, min(len(order), start + args.window))]
            target = place_of.get(query_id) or pair["place"]
            previous = place_of.get(order[start - 1]) if start > 0 else None
            places = defaultdict(list)
            for observation_id in order[:start]:
                place_id = place_of.get(observation_id)
                if not place_id or (previous and previous != target and place_id == previous):
                    continue
                observation = by_id[observation_id]
                for view in observation.get("views", []):
                    places[place_id].append({
                        "observationId": observation_id,
                        "atMs": observation["atMs"],
                        "path": view["path"],
                        "sha256": view["sha256"],
                        "direction": view["direction"],
                    })
            if target not in places:
                rows.append({**pair, "target": target, "top1": None, "top2": None, "note": "target not in index before return"})
                continue
            query_members = []
            for observation_id in (window[0], window[-1]):
                observation = by_id[observation_id]
                for view in observation.get("views", []):
                    query_members.append({"path": view["path"]})
            query_members = query_members[:6]
            place_payload = [{"placeId": place_id, "name": place_id, "members": members} for place_id, members in places.items()]
            result = index.match(
                query_members,
                place_payload,
                images_per_place=n,
                shortlist_places=args.shortlist_places,
                sift_images_per_place=2,
                min_inliers=0,
                ratio=0.75,
            )
            ranked = [entry["id"] for entry in result["results"]]
            rows.append({
                **pair,
                "target": target,
                "top1": bool(ranked and ranked[0] == target),
                "top2": bool(target in ranked[:2]),
                "rank": (ranked.index(target) + 1) if target in ranked else None,
                "stats": result["stats"],
            })
        elapsed = round((time.time() - total_started) * 1000, 1)
        scored = [row for row in rows if row.get("rank") is not None]
        counts = [int(x) for x in str(args.candidate_counts).split(",")]
        recall_at = {str(k): sum(1 for row in scored if row["rank"] <= k) for k in counts}
        result_row = {
            "imagesPerPlace": n,
            "shortlistPlaces": args.shortlist_places,
            "pairs": len(rows),
            "scored": len(scored),
            "candidateCounts": counts,
            "recallAt": recall_at,
            "top1": sum(1 for row in scored if row["rank"] <= 1),
            "top2": sum(1 for row in scored if row["rank"] <= 2),
            "elapsedMs": elapsed,
            "rows": rows,
        }
        all_results.append(result_row)
        print(json.dumps(result_row, ensure_ascii=True, indent=1))
    if args.out:
        Path(args.out).write_text(json.dumps(all_results, ensure_ascii=True, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
