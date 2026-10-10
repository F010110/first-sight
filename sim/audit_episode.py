"""Audit saved action endpoints without passing GT to recognition."""
import argparse
import collections
import json
import math
from pathlib import Path


def audit(rows):
    unexpected = []
    for a, b in zip(rows, rows[1:]):
        distance = math.hypot(b["x"] - a["x"], b["z"] - a["z"])
        yaw = ((b["yaw"] - a["yaw"] + 540) % 360) - 180
        if b["action"] == "MoveAhead" and b["success"]:
            expected_dx = .25 * math.sin(math.radians(a["yaw"]))
            expected_dz = .25 * math.cos(math.radians(a["yaw"]))
            if abs(b["x"] - a["x"] - expected_dx) > .001 or abs(b["z"] - a["z"] - expected_dz) > .001:
                unexpected.append({"tick": b["tick"], "error": "move direction/distance differs"})
        elif distance > .001:
            unexpected.append({"tick": b["tick"], "error": "unexpected translation"})
        expected_yaw = {"RotateLeft": -90, "RotateRight": 90}.get(b["action"], 0) if b["success"] else 0
        if abs(yaw - expected_yaw) > .001:
            unexpected.append({"tick": b["tick"], "error": "unexpected rotation"})
    return {"frames": len(rows), "actions": dict(collections.Counter(row["action"] for row in rows)), "failedActions": sum(not row["success"] for row in rows), "unexpectedSteps": unexpected, "note": "Validates discrete action endpoints, not captured continuous dynamics or successful repeated routes."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("episode", type=Path)
    args = parser.parse_args()
    rows = [json.loads(line) for line in (args.episode / "observations.jsonl").read_text(encoding="utf-8").splitlines()]
    output = {"all": audit(rows), "viewerPrefix": audit(rows[:121])}
    (args.episode / "action-audit.json").write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps(output, indent=2))
