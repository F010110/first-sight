"""Prepare a bounded, model-output-blind three-view audit sheet from public input."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('input')
parser.add_argument('new_output')
parser.add_argument('--stride', type=int, default=8)
parser.add_argument('--rows-per-page', type=int, default=6)
args = parser.parse_args()
source = Path(args.input)
raw = source.read_bytes()
data = json.loads(raw)
rows = data['observations']
out = Path(args.new_output)
out.mkdir(exist_ok=False)
if not 1 <= args.stride <= 32 or not 1 <= args.rows_per_page <= 12:
    raise ValueError('Invalid bounded page size/stride')
selected = list(range(0, len(rows), args.stride))
manifest = {'inputSHA256': hashlib.sha256(raw).hexdigest(), 'selection': f'every {args.stride} observation(s); no model claims read by this script', 'rows': []}
for page, start in enumerate(range(0, len(selected), args.rows_per_page)):
    indices = selected[start:start + args.rows_per_page]
    sheet = Image.new('RGB', (960, len(indices) * 204), 'white')
    draw = ImageDraw.Draw(sheet)
    for slot, index in enumerate(indices):
        row = rows[index]
        draw.text((4, slot * 204 + 182), f"index={index} id={row['id']} sourceMs={row['atMs']}", fill='black')
        for view_index, view in enumerate(row['views']):
            path = Path(view['path'])
            payload = path.read_bytes()
            if hashlib.sha256(payload).hexdigest() != view['sha256']:
                raise ValueError('Source changed')
            with Image.open(path) as image:
                sheet.paste(image.convert('RGB').resize((320, 180)), (view_index * 320, slot * 204))
        manifest['rows'].append({'index': index, 'id': row['id'], 'atMs': row['atMs'], 'viewSHA256': [v['sha256'] for v in row['views']]})
    sheet.save(out / f'page-{page + 1}.jpg', quality=94)
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps({'rows': len(selected), 'pages': (len(selected) + args.rows_per_page - 1) // args.rows_per_page, 'out': str(out)}))
