"""Read-only source/import-scope audit. No model calls or product execution."""
import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]

def reachable(entry, root=ROOT):
    pending = [entry]
    seen = set()
    while pending:
        name = pending.pop()
        if name in seen:
            continue
        seen.add(name)
        path = root / name
        text = path.read_text(encoding='utf8')
        for ref in re.findall(r"(?:from\s*|import\s*)['\"]([^'\"]+)['\"]", text):
            if not ref.startswith('.'):
                continue
            target = (path.parent / ref).with_suffix('.ts').resolve()
            if target.is_file() and target.is_relative_to(root):
                pending.append(target.relative_to(root).as_posix())
    return sorted(seen)

def run(output):
    if output.exists():
        raise FileExistsError('Preserve prior audits')
    entries = ['src/evaluation/run-egolife-native.ts', 'src/evaluation/rerun-egolife-native-qa.ts', 'src/desktop/server.ts', 'src/desktop/realtime-server.ts']
    graphs = {entry: reachable(entry) for entry in entries}
    targets = ['src/assistant/runtime.ts', 'src/assistant/capabilities.ts', 'src/assistant/qwen-planner.ts', 'src/hardware/realtime-method2.ts', 'src/hardware/realtime-question.ts']
    evidence = {entry: {target: target in paths for target in targets} for entry, paths in graphs.items()}
    output.mkdir(parents=True)
    files = sorted(set(name for paths in graphs.values() for name in paths))
    result = {'scope': 'Current source import graph plus explicitly reviewed implementation; not a runtime full-system benchmark', 'entries': evidence, 'sourceHashes': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files}, 'graphs': graphs, 'limitations': 'Static graph is supporting evidence, not proof of runtime behavior. Prepared desktop entry and camera entry are distinct implementations.', 'paidCalls': 0, 'newEvaluationStarted': False}
    (output / 'audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    return evidence

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.output), ensure_ascii=False))
