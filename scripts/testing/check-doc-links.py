"""Check local Markdown links in repository documentation."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[2]
errors = []
for source in [root / 'README.md', root / 'TODO.md', *sorted((root / 'docs').rglob('*.md'))]:
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
