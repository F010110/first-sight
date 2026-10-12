"""Record explicit assistant image review; no poses/room IDs used as labels."""
import hashlib
import json
from pathlib import Path


def main():
    root = Path('run/sim/multiview-val5-clean-20261007')
    windows = [json.loads(line) for line in (root / 'windows.jsonl').read_text().splitlines()]
    boundary = {6: ['open-living-area', 'bedroom'], 7: ['open-living-area', 'bedroom'],
                **{i: ['bedroom', 'bathroom'] for i in [10, 11, 12, 13, 30, 31, 32]},
                **{i: ['bedroom', 'open-living-area'] for i in [37, 38, 39]}}
    rows = []
    for i, window in enumerate(windows, 1):
        if i in boundary:
            kind = 'boundary'; regions = boundary[i]
            reason = '门框或门槛近距离横跨视野，三视图分别显示邻接房间地面与家具；按宽门口过渡约定单列，精确观察者侧待人工核对。'
        elif i <= 5 or i == 40:
            kind = 'core'; regions = ['open-living-area']
            reason = '岛台与起居角同属连续生活空间；观察主体在该空间一侧，厨房功能与客厅功能不拆为房间。'
        elif i in [8, 9, 33, 34, 35, 36]:
            kind = 'core'; regions = ['bedroom']
            reason = '白色地面、床和床头家具构成近距离卧室布局；门外卫生间或生活区可见内容不改变主体归属。'
        else:
            kind = 'core'; regions = ['bathroom']
            reason = '马桶、洗手池、垃圾桶与木色地面构成卫生间布局；角落旋转及门外可见床不产生新区域。'
        source = root / 'triple' / Path(window['frame']).name
        rows.append({'observationId': f'observation-{i}', 'kind': kind, 'regions': regions, 'reason': reason,
                     'frames': ['triple/' + source.name], 'imageSha256': hashlib.sha256(source.read_bytes()).hexdigest()})
    result = {'protocol': 'core-boundary-v1', 'blind': False, 'reviewer': 'assistant-image-review',
              'dataset': str(root), 'note': '40 original triptychs visually reviewed. AI development labels, NOT human blind truth. Existing model results already known; post-prediction review, no causal/held-out claim. No simulator room IDs or metric poses used. Generous doorway boundary convention remains human-reviewable.', 'labels': rows}
    path = Path('docs/experiments/region-val5-core-labels-v1.json')
    with path.open('x', encoding='utf-8') as file:
        json.dump(result, file, ensure_ascii=False, indent=2)
    print(path)


if __name__ == '__main__':
    main()
