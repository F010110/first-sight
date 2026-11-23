"""Check local Markdown links in active course repository documentation."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[2]
sources = [
    root / 'README.md',
    root / 'TODO.md',
    root / 'AGENTS.md',
    root / 'docs' / 'README.md',
    root / 'docs' / 'course-demo-quickstart.md',
    *sorted((root / 'docs' / 'active').glob('*.md')),
    root / 'cam' / 'README.md',
    root / 'cam' / 'host' / 'README.md',
]

errors = []
for source in sources:
    if not source.exists():
        errors.append(f'Missing expected doc: {source.relative_to(root)}')
        continue
    text = source.read_text(encoding='utf-8')
    for link in re.findall(r'\]\(([^\s)]+)\)', text):
        if re.match(r'^[a-zA-Z]+:', link) or link.startswith(('#', '/')):
            continue
        path = link.partition('#')[0]
        if not (source.parent / path).exists():
            errors.append(f'{source.relative_to(root)}: {link}')

if errors:
    raise SystemExit('\n'.join(errors))
print('Local documentation links OK')
