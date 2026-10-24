"""Create a model-blind source review sheet and unscored annotation scaffold.

Input is the public replay JSON shared by campus/home/HSSD adapters. No provider.
Existing outputs are never overwritten. Review images remain local file references.
"""
import argparse
import hashlib
import html
import json
from pathlib import Path


def prepare(source, output):
    raw = source.read_bytes()
    data = json.loads(raw)
    rows = data['observations']
    seen = set()
    sections = []
    labels = []
    for row in rows:
        if row['id'] in seen:
            raise ValueError('Duplicate observation')
        seen.add(row['id'])
        views = {v['direction']: v for v in row['views']}
        if set(views) != {'left', 'front', 'right'} or len(row['views']) != 3:
            raise ValueError('Require three distinct source views')
        images = []
        for direction in ['left', 'front', 'right']:
            view = views[direction]
            path = Path(view['path']).resolve()
            if hashlib.sha256(path.read_bytes()).hexdigest() != view['sha256']:
                raise ValueError('Original image changed: ' + str(path))
            images.append('<figure><figcaption>' + direction + '</figcaption><img loading="lazy" src="' + html.escape(path.as_uri(), quote=True) + '"></figure>')
        sections.append('<section><h2>' + html.escape(row['scene'] + ' / ' + row['id']) + '</h2><p>source time: ' + str(row['atMs']) + '</p><div class="views">' + ''.join(images) + '</div></section>')
        # Deliberately invalid for scoring until a reviewer fills it. Do not default
        # hard observations to boundary/unknown or supply labels from model output.
        labels.append({'id': row['id'], 'scene': row['scene'], 'split': None, 'kind': None, 'region': None, 'reviewer': '', 'reason': ''})
    output.mkdir(parents=True, exist_ok=False)
    (output / 'labels.UNREVIEWED.json').write_text(json.dumps({'labels': labels, 'revisits': [], 'publicInputSha256': hashlib.sha256(raw).hexdigest()}, ensure_ascii=False, indent=2), encoding='utf-8')
    document = '<!doctype html><meta charset="utf-8"><title>Spatial source-only review</title><style>body{font:16px sans-serif}section{border-bottom:2px solid #999;padding:1em}.views{display:flex}figure{width:33%;margin:0}img{width:100%;height:auto}</style><h1>Source-only review — no model names or predictions</h1><p>Choose a consistent physical-region granularity. Mark core, boundary or unknown from originals; record evidence and actual reviewer. Do not infer revisits from elapsed time alone. This file does not run inference or automatically create truth.</p>' + ''.join(sections)
    (output / 'review.html').write_text(document, encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('public_input', type=Path)
    parser.add_argument('new_output_directory', type=Path)
    args = parser.parse_args()
    prepare(args.public_input, args.new_output_directory)
