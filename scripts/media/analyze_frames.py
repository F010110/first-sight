"""Analyze a small, evenly spaced subset of extracted video frames."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def spaced_subset(paths: list[Path], limit: int) -> list[Path]:
    if limit <= 0 or len(paths) <= limit:
        return paths
    if limit == 1:
        return [paths[len(paths) // 2]]
    indexes = [round(i * (len(paths) - 1) / (limit - 1)) for i in range(limit)]
    return [paths[i] for i in indexes]


def main() -> int:
    parser = argparse.ArgumentParser(description="用 Qwen 识别视频截图并生成场景提示")
    parser.add_argument("frames_dir", type=Path, help="extract_frames.py 输出的截图目录")
    parser.add_argument("--goal", default="", help="可选：用户当前目标")
    parser.add_argument("--max-images", type=int, default=12,
                        help="均匀选取的最多截图数；设为 0 则处理全部截图（默认 12）")
    parser.add_argument("--output-dir", type=Path, default=Path("observations"),
                        help="每张截图对应的 JSON 输出目录")
    args = parser.parse_args()

    if not args.frames_dir.is_dir():
        parser.error(f"找不到截图目录：{args.frames_dir}")
    if args.max_images < 0:
        parser.error("--max-images 不能小于 0")

    paths = sorted(p for p in args.frames_dir.iterdir()
                   if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS)
    if not paths:
        parser.error("目录中没有支持的图片")
    selected = spaced_subset(paths, args.max_images)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    script = Path(__file__).with_name("scene_reader.py")
    manifest = []
    for index, image in enumerate(selected, start=1):
        output_path = args.output_dir / f"{image.stem}.json"
        command = [sys.executable, str(script), str(image), "--output", str(output_path)]
        if args.goal:
            command.extend(["--goal", args.goal])
        print(f"[{index}/{len(selected)}] {image.name}", flush=True)
        result = subprocess.run(command, check=False)
        manifest.append({"image": str(image), "result": str(output_path), "exit_code": result.returncode})
        if result.returncode:
            print(f"识别失败：{image.name}（exit code {result.returncode}）", file=sys.stderr)

    manifest_path = args.output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    failures = sum(item["exit_code"] != 0 for item in manifest)
    print(f"完成：{len(selected) - failures}/{len(selected)} 张成功；清单：{manifest_path}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
