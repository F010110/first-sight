"""Index allowlisted project text paths and hashes, without copying secrets or research contents."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT/'docs/project-sync/repository-catalog.json'
FOLDERS = ['src', 'scripts', 'tests', 'docs', 'cam/docs']
EXTENSIONS = {'.md', '.ts', '.js', '.mjs', '.cjs', '.py', '.json', '.yaml', '.yml', '.toml'}
EXCLUDED = {'node_modules', '__pycache__', '.venv', '.git', 'local'}

def main():
    paths = {ROOT/name for name in ['README.md', 'TODO.md', 'package.json', 'tsconfig.json']}
    for folder in FOLDERS:
        for path in (ROOT/folder).rglob('*'):
            relative = path.relative_to(ROOT)
            if path.is_symlink() or any(part in EXCLUDED for part in relative.parts):
                continue
            if path.is_file() and path.suffix.lower() in EXTENSIONS and path != TARGET:
                paths.add(path)
    rows = []
    for path in sorted(paths):
        if not path.is_file(): continue
        data = path.read_bytes()
        rows.append({'path':path.relative_to(ROOT).as_posix(), 'bytes':len(data), 'sha256':hashlib.sha256(data).hexdigest()})
    value = {'schema':'project-sync-file-catalog-v1', 'knowledgeSnapshotDate':'2026-10-27', 'catalogGeneratedAt':datetime.now(timezone.utc).isoformat(), 'scope':'Allowlisted text paths and hashes only; not semantic review of every file, not a content backup.', 'excluded':['research/', 'cam/local/', 'datasets/', 'run/', 'node_modules/', '.git/', '.venv/', 'credentials/environment values'], 'files':rows}
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps({'catalog':str(TARGET.relative_to(ROOT)), 'files':len(rows), 'contentCopied':False}))

if __name__ == '__main__': main()
