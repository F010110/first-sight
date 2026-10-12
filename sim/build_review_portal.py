"""Build a local index over generated review packages, no external hosting."""
import argparse
import html
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('root', type=Path); args = parser.parse_args()
    rows = []; catalog = []
    for path in sorted(args.root.glob('*/data.json')):
        data = json.loads(path.read_text(encoding='utf-8'))
        catalog.append({'directory': path.parent.name, 'name': data['datasetId'], 'samples': len(data['samples'])})
        rows.append(f'<li><a href="{html.escape(path.parent.name, quote=True)}/">{html.escape(data["datasetId"])}</a> — {len(data["samples"])} 个样本，{data["frameCount"]} 帧，模型 {html.escape(data["model"] or "未知")}</li>')
    if not rows:
        raise ValueError('No review packages')
    (args.root / 'datasets.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf-8')
    first = html.escape(catalog[0]['directory'], quote=True)
    (args.root / 'index.html').write_text(f'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url={first}/"><title>空间审核</title><p>正在打开审核页面；页面顶部可切换样本集。</p><a href="{first}/">进入审核</a></html>', encoding='utf-8')
    print(args.root / 'index.html')


if __name__ == '__main__':
    main()
