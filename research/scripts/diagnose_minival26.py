"""Gather existing low-score evidence without changing or rerunning inference."""
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]


def main():
    scores = json.loads((ROOT / 'reports/minival26-qwen-judge-v1.json').read_text(encoding='utf-8'))
    questions = {q['question_id']: q for q in json.loads((ROOT / 'data/hm3d-minival-eqa-subset/questions.json').read_text())}
    cases = []
    tiles = []
    for row in scores['rows']:
        if row['score'] >= 5:
            continue
        qid = row['questionId']
        folder = ROOT / 'runs/minival26-baseline-v1' / qid
        episode = folder / 'output/baseline' / qid
        log = (folder / 'run.log').read_text(encoding='utf-8', errors='replace')
        events = [line for line in log.splitlines() if any(key in line for key in (
            'Response: [', 'Reason: [', 'Prefiltering selected classes:', 'Prefiltering snapshot:',
            'Next choice Snapshot', 'failed!', 'invalid:', 'Step ', 'initialization successful'))]
        images = sorted((episode / 'chosen_snapshot').glob('*.png'))
        case = dict(row)
        case['scene'] = questions[qid]['episode_history']
        case['events'] = events
        case['selectedImages'] = [str(p.relative_to(ROOT)) for p in images]
        case['snapshotCountOnDisk'] = len(list((episode / 'snapshot').glob('*.png')))
        cases.append(case)
        for path in images[:1]:
            image = Image.open(path).convert('RGB')
            image.thumbnail((400, 400))
            tile = Image.new('RGB', (440, 450), 'white')
            tile.paste(image, (20, 30))
            draw = ImageDraw.Draw(tile)
            draw.text((10, 5), qid[:8] + ' / flash judge ' + str(row['score']), fill='black')
            draw.text((10, 430), path.name, fill='black')
            tiles.append(tile)
    (ROOT / 'reports/minival26-low-score-evidence.json').write_text(json.dumps(cases, indent=2, ensure_ascii=False), encoding='utf-8')
    sheet = Image.new('RGB', (440 * 3, 450 * ((len(tiles) + 2) // 3)), '#dddddd')
    for i, tile in enumerate(tiles):
        sheet.paste(tile, ((i % 3) * 440, (i // 3) * 450))
    target = ROOT / 'reports/minival26-low-score-selected-views.jpg'
    sheet.save(target)
    print(len(cases), 'cases;', len(tiles), 'selected images;', target)


if __name__ == '__main__':
    main()
