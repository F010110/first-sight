"""Describe screenshots and produce a conservative optional user tip with Qwen."""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
from pathlib import Path

from openai import OpenAI


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def make_prompt(goal: str) -> str:
    tip_policy = (
        "用户有明确目标：仅当画面清楚显示目标或能直接帮助完成目标时，给一句具体提示；"
        "不要提供假设性建议。"
        if goal
        else
        "用户没有提供目标：user_tip 必须为 null，除非画面中有明确、紧急且值得提醒的安全风险。"
    )
    return f"""请根据图片识别当前场景，并严格输出一个 JSON 对象，不要添加 Markdown 代码块。
用户目标：{goal or '未提供'}
JSON 字段：
{{
  "scene": "简洁描述场景",
  "environment": "室内、室外或不确定",
  "objects": [{{"name": "物体", "position": "相对画面位置"}}],
  "readable_text": ["清楚可辨认的文字"],
  "uncertainties": ["无法确认的内容"],
  "user_tip": "对用户目标确实有帮助时给出一句简短提示，否则为 null"
}}
只描述画面中可见内容，不推测画面之外的信息。位置使用画面中的左/中/右、近/远等相对描述。
{tip_policy}"""


def image_data_url(path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(path.name)
    if mime_type is None or not mime_type.startswith("image/"):
        raise ValueError(f"无法识别图片类型：{path.name}")
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def main() -> int:
    parser = argparse.ArgumentParser(description="用 Qwen 识别截图场景并生成可选提示")
    parser.add_argument("image", type=Path, help="截图文件路径")
    parser.add_argument("--goal", default="", help="可选：用户当前目标，例如‘帮我找水杯’")
    parser.add_argument("--model", default=os.getenv("QWEN_MODEL", "qwen3-vl-plus"),
                        help="模型名，默认读取 QWEN_MODEL 或使用 qwen3-vl-plus")
    parser.add_argument("--output", type=Path, help="可选：将模型原始 JSON 文本保存到文件")
    args = parser.parse_args()

    api_key = os.getenv("QWEN_API_KEY")
    base_url = os.getenv("QWEN_BASE_URL")
    if not api_key:
        parser.error("缺少 QWEN_API_KEY 环境变量")
    if not base_url:
        parser.error("缺少 QWEN_BASE_URL 环境变量（应为 OpenAI 兼容 API 的 base URL）")
    if not args.image.is_file():
        parser.error(f"找不到图片文件：{args.image}")

    try:
        client = OpenAI(api_key=api_key, base_url=base_url)
        response = client.chat.completions.create(
            model=args.model,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": make_prompt(args.goal)},
                    {"type": "image_url", "image_url": {"url": image_data_url(args.image)}},
                ],
            }],
            temperature=0.2,
        )
        content = response.choices[0].message.content or "{}"
        try:
            parsed = json.loads(content)
            rendered = json.dumps(parsed, ensure_ascii=False, indent=2)
        except json.JSONDecodeError:
            rendered = content
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(rendered + "\n", encoding="utf-8")
        print(rendered)
        return 0
    except Exception as exc:  # Do not print environment variables or credentials.
        print(f"Qwen 请求失败：{type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
