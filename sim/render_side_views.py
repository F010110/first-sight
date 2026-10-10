"""Render controlled front/left/right views at saved poses; never feed poses to agents."""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    from ai2thor.controller import Controller
    from ai2thor.platform import Linux64
    from PIL import Image, ImageDraw

    parser = argparse.ArgumentParser()
    parser.add_argument("episode", type=Path)
    parser.add_argument("--house", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--windows", type=int, default=40)
    parser.add_argument("--substeps", type=int, default=1, help="Visualization-only interpolated camera poses per recorded action")
    args = parser.parse_args()
    manifest = json.loads((args.episode / "manifest.json").read_text())
    if hashlib.sha256(args.house.read_bytes()).hexdigest() != manifest["house_sha256"]:
        raise ValueError("House differs from source recording")
    rows = [json.loads(line) for line in (args.episode / "observations.jsonl").read_text().splitlines()]
    windows = [json.loads(line) for line in (args.episode / "windows.jsonl").read_text().splitlines()][:args.windows]
    max_tick = max(row["endTick"] for row in windows)
    rows = [row for row in rows if row["tick"] <= max_tick]
    source_max_tick = max_tick
    if args.substeps < 1:
        raise ValueError("substeps must be positive")
    if args.substeps > 1:
        dense = [dict(rows[0], sourceTick=0)]
        for a, b in zip(rows, rows[1:]):
            delta_yaw = ((b["yaw"] - a["yaw"] + 540) % 360) - 180
            for step in range(1, args.substeps + 1):
                fraction = step / args.substeps
                dense.append({**b, "tick": len(dense), "sourceTick": b["tick"], "interpolationFraction": fraction,
                              **{key: a[key] + fraction * (b[key] - a[key]) for key in ("x", "y", "z", "horizon")},
                              "yaw": (a["yaw"] + fraction * delta_yaw) % 360})
        rows = dense
        windows = [{**row, "startTick": row["startTick"] * args.substeps, "endTick": row["endTick"] * args.substeps, "frame": f'frames/{row["endTick"] * args.substeps:04d}.jpg'} for row in windows]
        max_tick = rows[-1]["tick"]
    args.output.mkdir(parents=True, exist_ok=False)
    for name in ("frames", "left", "right", "triple"):
        (args.output / name).mkdir()
    controller = Controller(scene=json.loads(args.house.read_text()), width=manifest["image_size"], height=manifest["image_size"], fieldOfView=90, platform=Linux64, gridSize=0.25, rotateStepDegrees=90, snapToGrid=False, quality=manifest["quality"], server_timeout=120)
    audits = []
    try:
        for row in rows:
            if row["tick"] > max_tick:
                break
            event = controller.step(action="TeleportFull", position={k: row[k] for k in ("x", "y", "z")}, rotation={"x": 0, "y": row["yaw"], "z": 0}, horizon=row["horizon"], standing=True, forceAction=True)
            if not event.metadata["lastActionSuccess"]:
                raise RuntimeError(event.metadata.get("errorMessage", "Teleport failed"))
            position = event.metadata["cameraPosition"]
            front = Image.fromarray(event.frame.copy())
            # Third-party cameras render the avatar's head from this optical center.
            # Use the main camera's self-culling instead, replaying orientation only
            # in a static scene; these renders are not fed to the motion timeline.
            sides = []
            for yaw in (row["yaw"] - 90, row["yaw"] + 90):
                event = controller.step(action="TeleportFull", position={k: row[k] for k in ("x", "y", "z")}, rotation={"x": 0, "y": yaw % 360, "z": 0}, horizon=row["horizon"], standing=True, forceAction=True)
                if not event.metadata["lastActionSuccess"]:
                    raise RuntimeError(event.metadata.get("errorMessage", "Camera render failed"))
                if max(abs(event.metadata["cameraPosition"][k] - position[k]) for k in ("x", "y", "z")) > 0.001:
                    raise RuntimeError("Side optical center differs from front")
                sides.append(Image.fromarray(event.frame.copy()))
            left, right = sides
            size = front.width
            triple = Image.new("RGB", (size * 3, size + 24), "white")
            draw = ImageDraw.Draw(triple)
            for index, (label, image) in enumerate((("LEFT -90 deg", left), ("FRONT 0 deg", front), ("RIGHT +90 deg", right))):
                triple.paste(image, (index * size, 24))
                draw.text((index * size + 8, 5), label, fill="black")
            for name, image in (("frames", front), ("left", left), ("right", right), ("triple", triple)):
                image.save(args.output / name / f'{row["tick"]:04d}.jpg', quality=90)
            actual = event.metadata["agent"]["position"]
            error = max(abs(actual[k] - row[k]) for k in ("x", "y", "z"))
            if error > 0.001:
                raise RuntimeError(f"Pose mismatch: {error}")
            audits.append({"tick": row["tick"], "poseError": error, "sourceRoom": row["room"]})
            if row["tick"] % 20 == 0:
                print(f'rendered {row["tick"]}/{max_tick}', flush=True)
        (args.output / "windows.jsonl").write_text("".join(json.dumps(row) + "\n" for row in windows))
        (args.output / "observations.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows if row["tick"] <= max_tick))
        (args.output / "pose-audit.json").write_text(json.dumps(audits, indent=2))
        (args.output / "manifest.json").write_text(json.dumps({**manifest, "sourceEpisode": str(args.episode), "sourceFrames": source_max_tick + 1, "frames": max_tick + 1, "substeps": args.substeps, "visualizationOnly": args.substeps > 1, "views": ["front", "left-90", "right+90"], "rendering": "same optical center in static scene, sequential orientation-only main-camera renders to exclude avatar self-occlusion; NOT hardware synchronization. Substeps >1 are interpolated visualization poses, NOT measured robot dynamics and NOT agent evaluation inputs.", "triptych": "left/front/right, labeled; weak CV uses front only in both conditions"}, indent=2))
        print(args.output, flush=True)
    finally:
        controller.stop()


if __name__ == "__main__":
    main()
