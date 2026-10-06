"""Derive qualitative "motion mode" windows from a recorded episode.

The agents never get the simulator's pose or any metric displacement. They only
get the same thing the phone would give: a short natural-language description of
how the device moved since the previous observation (still / moved / turned).

This post-processes an existing episode (no simulator needed):

  sim/derive_motion.py run/sim/<episode> [--observe-every 3] [--tick-seconds 1.0] [--seed 7]

Writes `windows.jsonl`, one row per agent observation:

  { window, startTick, endTick, frame, room(GT), start/end pose,
    motionPerfect,            # clean description from ground-truth actions
    motionNoisy }             # corrupted to mimic real VIO failure modes

The replay harness picks `none` / `perfect` / `noisy` (and never passes pose/GT
to the agent). AI2-THOR MoveAhead is 0.25 m per action, Rotate* is 90 degrees.
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

GRID_METERS = 0.25
ROTATE_DEGREES = 90


def speed_bucket(meters: float, seconds: float) -> str:
    if seconds <= 0:
        return "slow"
    speed = meters / seconds
    return "slow" if speed < 0.4 else "moderate" if speed < 0.9 else "fast"


def segments_from_actions(rows, start, end, tick_seconds: float):
    """Group the actions in (start, end] into (kind, direction, value, duration)."""
    segments = []
    for action in [rows[t]["action"] for t in range(start + 1, end + 1)]:
        if action == "MoveAhead":
            seg = ("move", "forward", GRID_METERS, tick_seconds)
        elif action == "MoveBack":
            seg = ("move", "backward", GRID_METERS, tick_seconds)
        elif action == "MoveLeft":
            seg = ("move", "left", GRID_METERS, tick_seconds)
        elif action == "MoveRight":
            seg = ("move", "right", GRID_METERS, tick_seconds)
        elif action == "RotateLeft":
            seg = ("turn", "left", ROTATE_DEGREES, tick_seconds)
        elif action == "RotateRight":
            seg = ("turn", "right", ROTATE_DEGREES, tick_seconds)
        else:
            continue
        if segments and segments[-1][0] == seg[0] and segments[-1][1] == seg[1]:
            kind, direction, value, duration = segments[-1]
            segments[-1] = (kind, direction, value + seg[2], duration + seg[3])
        else:
            segments.append(seg)
    return segments


def describe(segments) -> str:
    head = "The phone's motion over this window, from sensors and camera (approximate): "
    if not segments:
        return head + "stayed still."
    parts = []
    for kind, direction, value, duration in segments:
        if kind == "move":
            parts.append(f"moved {direction} ({speed_bucket(value, duration)}) for about {duration:.1f}s")
        else:
            parts.append(f"turned {direction} roughly {int(value)} degrees in place for about {duration:.1f}s")
    return head + ", then ".join(parts) + "."


def corrupt(segments, rng: random.Random, p_turn_as_move=0.35, p_angle_scale=0.35, p_drop=0.1):
    """Mimic the real fusion's failures: pan read as lateral move, wrong turn size."""
    out = []
    for seg in segments:
        if rng.random() < p_drop:
            continue
        kind, direction, value, duration = seg
        if kind == "turn":
            if rng.random() < p_turn_as_move:
                out.append(("move", "left" if direction == "left" else "right", value / 4, duration))
            else:
                scale = rng.uniform(0.5, 1.5) if rng.random() < p_angle_scale else 1.0
                out.append(("turn", direction, value * scale, duration))
        else:
            out.append(seg)
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("episode", type=Path)
    parser.add_argument("--observe-every", type=int, default=3, help="agent observes every N frames")
    parser.add_argument("--tick-seconds", type=float, default=1.0)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    rows = [json.loads(line) for line in (args.episode / "observations.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    rng = random.Random(args.seed)
    windows = []
    start = 0
    index = 0
    while start < len(rows) - 1:
        end = min(start + args.observe_every, len(rows) - 1)
        perfect = segments_from_actions(rows, start, end, args.tick_seconds)
        windows.append({
            "window": index,
            "startTick": start,
            "endTick": end,
            "frame": f"frames/{end:04d}.jpg",
            "room": rows[end]["room"],
            "prevRoom": rows[start]["room"],
            "startPose": {"x": rows[start]["x"], "z": rows[start]["z"], "yaw": rows[start]["yaw"]},
            "endPose": {"x": rows[end]["x"], "z": rows[end]["z"], "yaw": rows[end]["yaw"]},
            "motionPerfect": describe(perfect),
            "motionNoisy": describe(corrupt(perfect, rng)),
        })
        index += 1
        start = end
        if end == len(rows) - 1:
            break

    out = args.episode / "windows.jsonl"
    out.write_text("\n".join(json.dumps(w, ensure_ascii=False) for w in windows) + "\n", encoding="utf-8")
    print(f"wrote {out} ({len(windows)} windows, observe_every={args.observe_every})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
