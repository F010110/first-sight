"""Fetch small upstream source snapshots and audit without executing upstream code."""
import argparse
import ast
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REPOS = {
    'findingdory': 'https://github.com/findingdory-benchmark/findingdory-habitat.git',
    '3d-mem': 'https://github.com/UMass-Embodied-AGI/3D-Mem.git',
    'meta-memory': 'https://github.com/ItsBaymax/Meta-Memory.git',
    'grapheqa': 'https://github.com/SaumyaSaxena/graph_eqa.git',
}


def command(args, cwd=None):
    env = dict(os.environ, GIT_TERMINAL_PROMPT='0', GIT_LFS_SKIP_SMUDGE='1')
    result = subprocess.run(args, cwd=cwd, env=env, capture_output=True,
                            text=True, encoding='utf-8', errors='replace', timeout=180)
    return {'args': args, 'returncode': result.returncode,
            'stdout': result.stdout, 'stderr': result.stderr}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--fetch', action='store_true')
    args = parser.parse_args()
    reports = ROOT / 'reports'
    reports.mkdir(exist_ok=True)
    (ROOT / 'vendor').mkdir(exist_ok=True)
    output = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'scope': 'source-only; no dependency install, model calls or benchmark execution', 'repos': {}}
    for name, url in REPOS.items():
        folder = ROOT / 'vendor' / name
        row = {'url': url}
        output['repos'][name] = row
        if not folder.exists() and args.fetch:
            try:
                row['clone'] = command(['git', '-c', 'core.hooksPath=/dev/null',
                                        'clone', '--depth', '1', url, str(folder)])
            except (OSError, subprocess.TimeoutExpired) as error:
                row['error'] = str(error)
        if not (folder / '.git').exists():
            row['available'] = False
            continue
        row['available'] = True
        row['commit'] = command(['git', 'rev-parse', 'HEAD'], folder)
        row['status'] = command(['git', 'status', '--short'], folder)
        tracked = command(['git', 'ls-files'], folder)
        files = tracked['stdout'].splitlines()
        row['trackedFiles'] = len(files)
        row['licenses'] = [p for p in files if Path(p).name.lower().startswith(('license', 'copying', 'notice'))]
        selected = [p for p in files if Path(p).name.lower() in {
            'readme.md', 'requirements.txt', 'pyproject.toml', 'setup.py', 'setup.sh',
            'environment.yml', 'environment.yaml', '.gitmodules'}]
        row['dependencyFiles'] = selected
        row['sha256'] = {p: hashlib.sha256((folder / p).read_bytes()).hexdigest()
                         for p in selected if (folder / p).is_file()}
        errors = []
        checked = 0
        for relative in files:
            if not relative.endswith('.py'):
                continue
            try:
                ast.parse((folder / relative).read_bytes(), filename=relative)
                checked += 1
            except (SyntaxError, ValueError, OSError) as error:
                errors.append({'path': relative, 'error': str(error)})
        row['syntax'] = {'pythonFilesParsed': checked, 'errors': errors,
                         'note': 'Host parser only; not an import/runtime or target-Python compatibility test'}
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    target = reports / f'source-audit-{stamp}.json'
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
    print(target)
    for name, row in output['repos'].items():
        print(name, 'available=', row.get('available'),
              'commit=', row.get('commit', {}).get('stdout', '').strip(),
              'syntaxErrors=', len(row.get('syntax', {}).get('errors', [])))


if __name__ == '__main__':
    main()
