"""Install actual dense simulator renders without touching review identities."""
import argparse
import json
from pathlib import Path
from build_region_review_site import export_display_video


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('render', type=Path)
    parser.add_argument('site', type=Path)
    args = parser.parse_args()
    manifest = json.loads((args.render / 'manifest.json').read_text(encoding='utf-8'))
    data_path = args.site / 'data.json'
    data = json.loads(data_path.read_text(encoding='utf-8'))
    steps = manifest['substeps']
    if steps != 12 or manifest['sourceFrames'] != data['frameCount']:
        raise ValueError('Dense render does not match review timeline')
    windows = [json.loads(line) for line in (args.render / 'windows.jsonl').read_text().splitlines() if line.strip()]
    if len(windows) != len(data['samples']) or any(w['endTick'] != s['tick'] * steps for w, s in zip(windows, data['samples'])):
        raise ValueError('Sample times differ from source route')
    frames = sorted((args.render / 'triple').glob('*.jpg'))
    if [int(p.stem) for p in frames] != list(range((data['frameCount'] - 1) * steps + 1)):
        raise ValueError('Incomplete dense render')
    filename = 'motion-dense24-v1.mp4'
    export_display_video(frames, args.site / filename, data['fps'] * steps, subdivisions=1)
    data['displayInterpolation'] = {'method': 'simulator-rendered-intermediate-poses', 'outputFps': data['fps'] * steps, 'renderedFrames': len(frames), 'sourceRender': str(args.render), 'viewGapPixels': 24, 'visualizationOnly': True}
    data_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    template = Path(__file__).with_name('region_review_site.html').read_text(encoding='utf-8')
    template = template.replace('src="motion-hold.mp4"', f'src="{filename}"').replace('24fps重复原帧，无淡化；原素材2帧/秒，不代表新增转动细节。审核针对当前算法预测，AI审查标签仅作参考。', '24fps模拟器重新渲染中间位姿，无淡化、无重复补帧；新增画面仅用于展示。请审核原AI标签，算法预测独立显示。')
    (args.site / 'index.html').write_text(template, encoding='utf-8')
    print(f'Installed {len(frames)} rendered frames at {data["fps"] * steps}fps: {args.site}')


if __name__ == '__main__':
    main()
