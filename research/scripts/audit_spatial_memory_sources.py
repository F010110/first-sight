"""Read-only source acquisition for the paper/code audit; never executes vendor code.

Stores small text sources outside the repository, with URL/hash provenance.
GitHub trees are pinned to commit SHAs; large assets and model weights are excluded.
"""
import concurrent.futures
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
import tempfile

OUT = Path.home() / 'AppData/Local/Temp/opencode/spatial-memory-audit-20261027'
REPOS = {
    'cross': 'jiaming-ai/CROSS',
    'navigator': 'ZJU-OmniAI/Embodied-Omni',
    'omnivla': 'NHirose/OmniVLA',
    'navharness': 'billzhao1030/NavHarness',
    'farm': 'GoldenGait/FARM-Project',
}
PAPERS = {
    'cross': '2605.02227v2', 'mem2ego': '2502.14254v3',
    'navigator': '2608.17512v2', 'omnivla': '2509.19480v1',
    'navharness': '2609.34276v1', 'farm': '2606.15476v3',
    'sensvla': '2609.17021v1', 'spamem': '2604.22409v3',
    'concept': '2608.23650v1', 'motion': '2603.17980v2',
}


def get(url):
    # Use the Windows trust store; do not disable TLS verification.
    with tempfile.TemporaryDirectory(dir=OUT) as temp:
        dest = Path(temp) / 'source'
        command = "Invoke-WebRequest -UseBasicParsing -Uri '{}' -OutFile '{}'".format(
            url.replace("'", "''"), str(dest).replace("'", "''"))
        subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', command],
                       check=True, capture_output=True, timeout=120)
        return dest.read_bytes()


class TextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        if tag in ('p', 'section', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4'):
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip = max(0, self.skip - 1)
        if tag in ('p', 'section', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4'):
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def paper(item):
    name, identifier = item
    url = f'https://arxiv.org/html/{identifier}'
    raw = get(url)
    parser = TextParser()
    parser.feed(raw.decode('utf-8'))
    text = '\n'.join(' '.join(x.split()) for x in ''.join(parser.parts).splitlines() if x.strip())
    folder = OUT / 'papers'
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f'{name}.html').write_bytes(raw)
    (folder / f'{name}.txt').write_text(text, encoding='utf-8')
    return {'name': name, 'url': url, 'sha256': hashlib.sha256(raw).hexdigest()}


def repo(item):
    name, repository = item
    folder = OUT / 'git' / name
    if not folder.exists():
        subprocess.run(['git', 'clone', '--depth', '1', '--filter=blob:none', '--no-checkout',
                        f'https://github.com/{repository}.git', str(folder)], check=True, timeout=180)
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=folder, text=True).strip()
    tree = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', 'HEAD'], cwd=folder, text=True)
    (OUT / f'{name}-tree.txt').write_text(tree, encoding='utf-8')
    # Fresh audit-only clones. Materialize text code only; no weights or submodules.
    patterns = ['*.py', '*.cpp', '*.h', '*.md', '*.yaml', '*.yml', '*.toml', '*.sh', '/LICENSE',
                '!/third_party/', '!/thirdparty/', '!/assets/', '!/docs/',
                '!/embodied_reasoner/', '!/embodied_memory/']
    subprocess.run(['git', 'sparse-checkout', 'set', '--no-cone', *patterns], cwd=folder,
                   check=True, capture_output=True, timeout=180)
    subprocess.run(['git', 'checkout'], cwd=folder, check=True, capture_output=True, timeout=240)
    files = [{'path': str(path.relative_to(folder)).replace('\\', '/'),
              'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
             for path in folder.rglob('*') if path.is_file() and '.git' not in path.parts]
    record = dict(name=name, repository=repository, commit=sha,
                  files=sorted(files, key=lambda x: x['path']))
    (folder / '_manifest.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
    return record


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    records = []
    jobspec = [(paper, item) for item in PAPERS.items()] + [(repo, item) for item in REPOS.items()]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        jobs = {pool.submit(fn, item): item[0] for fn, item in jobspec}
        for job in concurrent.futures.as_completed(jobs):
            try:
                result = job.result()
                records.append(result)
                print('OK', jobs[job], result.get('commit', result.get('url')), flush=True)
            except Exception as error:
                records.append({'name': jobs[job], 'error': str(error)})
                print('FAILED', jobs[job], type(error).__name__, flush=True)
            (OUT / 'manifest.json').write_text(json.dumps(records, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
