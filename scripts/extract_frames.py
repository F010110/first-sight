"""Extract fixed-interval screenshots from a short video using imageio-ffmpeg."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg


def main() -> int:
    parser = argparse.ArgumentParser(description="从视频节选中定频抽取截图")
    parser.add_argument("video", type=Path, help="输入视频文件")
    parser.add_argument("--output-dir", type=Path, default=Path("frames"), help="截图输出目录")
    parser.add_argument("--interval", type=float, default=5.0,
                        help="抽帧间隔秒数，默认 5 秒；设为 1 即每秒一张")
    parser.add_argument("--start", type=float, default=0.0, help="节选起始时间（秒）")
    parser.add_argument("--duration", type=float, default=300.0,
                        help="节选长度（秒），最多允许 300 秒")
    args = parser.parse_args()

    if not args.video.is_file():
        parser.error(f"找不到视频文件：{args.video}")
    if args.interval <= 0:
        parser.error("--interval 必须大于 0")
    if args.start < 0:
        parser.error("--start 不能小于 0")
    if args.duration <= 0 or args.duration > 300:
        parser.error("--duration 必须大于 0 且不超过 300 秒")
    if any(args.output_dir.glob("frame_*.jpg")):
        parser.error(f"输出目录已有抽帧文件，请选择一个新的目录：{args.output_dir}")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    output_pattern = args.output_dir / "frame_%06d.jpg"
    command = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-ss", str(args.start),
        "-i", str(args.video), "-t", str(args.duration), "-vf",
        f"fps=1/{args.interval}", "-q:v", "3", "-start_number", "0",
        str(output_pattern),
    ]
    try:
        subprocess.run(command, check=True)
    except subprocess.CalledProcessError as exc:
        print(f"抽帧失败（ffmpeg exit code {exc.returncode}）", file=sys.stderr)
        return exc.returncode or 1

    frames = sorted(args.output_dir.glob("frame_*.jpg"))
    print(f"抽取完成：{len(frames)} 张截图，间隔 {args.interval:g} 秒，输出到 {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
