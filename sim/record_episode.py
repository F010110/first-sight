"""Record a simulated indoor tour (AI2-THOR / ProcTHOR) for FirstSight tests.

This adapts EAM's recorder idea into a self-contained episode format that is easy
for the Node agents to replay:

  run/sim/<episode-id>/
    frames/0000.jpg ...          RGB observations, in order
    observations.jsonl           {tick, action, room (GT), pose, success}
    manifest.json                house/scene, rooms, route, provenance

The `room` field is ground truth for evaluation only; the agents under test must
never see it.

Run inside WSL with the EAM simulator venv (see sim/README.md):
  wsl -d Ubuntu --cd /mnt/d/Projects/Projects2026/VLM -- \
    /mnt/d/Projects/Projects2026/EAM/.venv-thor/bin/python sim/record_episode.py \
    --house /mnt/d/Projects/Projects2026/EAM/data/procthor-connectivity/val-5.json \
    --fixed-route --max-frames 80
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from navigation import fixed_route  # noqa: E402


def room_at(house, position):
    """Floor-polygon ray casting; doorways may remain 'unknown'."""
    x, z = position["x"], position["z"]
    for room in house["rooms"]:
        polygon = room["floorPolygon"]
        inside = False
        for a, b in zip(polygon, polygon[1:] + polygon[:1]):
            if (a["z"] > z) != (b["z"] > z):
                cross = a["x"] + (z - a["z"]) * (b["x"] - a["x"]) / (b["z"] - a["z"])
                if x < cross:
                    inside = not inside
        if inside:
            return room["id"]
    return "unknown"


def main() -> int:
    from ai2thor.controller import Controller
    from ai2thor.platform import Linux64
    from PIL import Image

    parser = argparse.ArgumentParser()
    parser.add_argument("--scene", default="FloorPlan1")
    parser.add_argument("--house", type=Path, help="Pinned ProcTHOR house JSON")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--fixed-route", action="store_true")
    parser.add_argument("--max-frames", type=int, default=80)
    parser.add_argument("--size", type=int, default=320)
    parser.add_argument("--quality", default="Low")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    out = args.output or (root / "run" / "sim" / ("episode-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")))
    (out / "frames").mkdir(parents=True, exist_ok=False)

    house = json.loads(args.house.read_text()) if args.house else None
    if house is not None:
        args.scene = args.house.stem

    controller = None
    try:
        print("Initializing simulator", flush=True)
        controller = Controller(scene=house or args.scene, width=args.size, height=args.size, fieldOfView=90,
                                platform=Linux64, gridSize=0.25, rotateStepDegrees=90,
                                quality=args.quality, server_timeout=120)
        print("Simulator ready", flush=True)

        if args.fixed_route:
            initial = controller.last_event.metadata["agent"]
            positions = controller.step(action="GetReachablePositions").metadata["actionReturn"]
            actions = [None] + fixed_route(positions, initial["position"], initial["rotation"]["y"])
        else:
            actions = [None, "RotateRight", "RotateRight", "RotateRight", "RotateRight", "MoveAhead"]
        planned = len(actions)
        actions = actions[: args.max_frames]

        rows = []
        with (out / "observations.jsonl").open("w", encoding="utf-8") as observations:
            for tick, action in enumerate(actions):
                event = controller.last_event if action is None else controller.step(action=action)
                meta = event.metadata
                Image.fromarray(event.frame).save(out / "frames" / f"{tick:04d}.jpg", format="JPEG", quality=90)
                agent = meta["agent"]
                room = room_at(house, agent["position"]) if house else args.scene
                row = {
                    "tick": tick,
                    "action": action or "Initialize",
                    "room": room,
                    "success": bool(meta.get("lastActionSuccess")),
                    "x": round(agent["position"]["x"], 4),
                    "y": round(agent["position"]["y"], 4),
                    "z": round(agent["position"]["z"], 4),
                    "yaw": round(agent["rotation"]["y"], 2),
                    "horizon": round(agent.get("cameraHorizon", 0), 2),
                }
                rows.append(row)
                observations.write(json.dumps(row) + "\n")
                observations.flush()
                if tick % 10 == 0:
                    print(f"recorded {tick}/{len(actions)} room={room} action={row['action']}", flush=True)

        rooms = []
        for row in rows:
            if row["room"] not in rooms:
                rooms.append(row["room"])
        manifest = {
            "schema": "firstsight-sim-episode-v1",
            "scene": args.scene,
            "frames": len(rows),
            "rooms_seen": rooms,
            "route": "fixed-grid-out-and-back" if args.fixed_route else "smoke",
            "route_truncated": len(actions) < planned,
            "image_size": args.size,
            "quality": args.quality,
            "pose": "oracle (AI2-THOR camera pose; GT, not given to agents)",
            "house_sha256": hashlib.sha256(args.house.read_bytes()).hexdigest() if args.house else None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "recorded",
        }
        (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
        print(str(out), flush=True)
        return 0
    finally:
        if controller is not None:
            controller.stop()


if __name__ == "__main__":
    raise SystemExit(main())
