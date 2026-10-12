"""Build a local index over generated review packages, no external hosting."""
import argparse
import html
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('root', type=Path); args = parser.parse_args()
    rows = []
    for path in sorted(args.root.glob('*/data.json')):
        data = json.loads(path.read_text(encoding='utf-8'))
        rows.append(f'<li><a href="{html.escape(path.parent.name, quote=True)}/">{html.escape(data["datasetId"])}</a> — {len(data["samples"])} 个样本，{data["frameCount"]} 帧，模型 {html.escape(data["model"] or "未知")}</li>')
    if not rows:
        raise ValueError('No review packages')
    (args.root / 'index.html').write_text('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>空间数据审查入口</title><body style="max-width:900px;margin:40px auto;font:18px system-ui;padding:20px"><h1>空间数据审查入口</h1><p>播放连续三视图运动，点击样本点检查AI预测和既有AI审查标签。人工审查可保存并导出，不覆盖原数据。</p><p>val4为开发集；val5尚无完整审核标签，不能报告准确率。本页面显示AI提示，是辅助审查而非独立盲审。</p><ul>' + ''.join(rows) + '</ul></body></html>', encoding='utf-8')
    print(args.root / 'index.html')


if __name__ == '__main__':
    main()
