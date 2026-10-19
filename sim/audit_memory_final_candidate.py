"""Offline-only scoring provenance audit and candidate freeze. Never calls VLM."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from report_locked_protocol import report, load, lines


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit(base, bank, output):
    output.mkdir(parents=True, exist_ok=False)
    legacy = report(base, bank)
    group = base / 'spatial-memory-runtime-fixed-v4'
    frozen = load(group / 'frozen.json')
    assert sha(group / 'model-replay/observations.jsonl') == frozen['replaySha256']
    assert sha(group / 'model-questions.json') == frozen['publicTasksSha256']
    assert sha(bank / 'evaluation-only/tasks.json') == frozen['privateTasksSha256']
    for mode in ['spatial-memory', 'memory-oracle']:
        root = base / (mode + '-runtime-fixed-v4')
        for file in ['full/results.jsonl', 'full-grading/grades.jsonl']:
            rows = lines(root / file)
            assert len(rows) == len({r['id'] for r in rows}) == 90
    probes = {}
    for directory in ['school-summary-factor-v1', 'school-tools-factor-v1']:
        root = base.parent / directory
        plan = load(root / 'plan.json')
        for path, expected in plan['files'].items():
            path = path[1:] if len(path) > 2 and path[0] == '/' and path[2] == ':' else path
            assert sha(Path(path)) == expected, 'Frozen probe code changed'
        rows = lines(root / 'results.jsonl')
        assert len(rows) == 20 and len({(r['id'], r['enabled']) for r in rows}) == 20
        probes[directory] = {
            'status': 'development-diagnostic-only-not-90-task-score',
            'factor': plan['factor'], 'uniqueQuestions': len({r['id'] for r in rows}),
            'arms': {str(enabled): {
                'executions': len([r for r in rows if r['enabled'] == enabled]),
                'runtimeAccepted': sum(not bool(r.get('error')) for r in rows if r['enabled'] == enabled),
                'failedIds': [r['id'] for r in rows if r['enabled'] == enabled and r.get('error')],
            } for enabled in [False, True]},
            'usage': load(root / 'usage.json'),
        }
    source_files = list(Path('src/agent').glob('*.ts'))
    source_files += [Path('src/sim') / f for f in [
        'memory-provenance-evaluation.ts', 'spatial-memory-evaluation-session.ts',
        'current-evidence-session.ts', 'memory-answer-repair.ts', 'locked-answer-repair.ts',
        'repair-memory-protocol-locked.ts', 'memory-evaluation-grade.ts', 'probe-default-summary.ts']]
    source_files += [Path('package-lock.json'), Path('tsconfig.json')]
    candidate = {
        'status': 'candidate-frozen-not-approved-for-final-online-run',
        'gitCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
        'model': 'qwen3.8-flash', 'enableThinking': False,
        'sourceFiles': {p.as_posix(): sha(p) for p in source_files},
        'memorySQLite': {'path': str(Path(frozen['memoryDirectory']) / 'topology.sqlite'),
                         'sha256': sha(Path(frozen['memoryDirectory']) / 'topology.sqlite')},
        'clockFile': {'path': 'run/school-calendar-v1/clock.json', 'sha256': sha(Path('run/school-calendar-v1/clock.json'))},
        'policy': 'No new grading, no changed reference labels, no hypothetical repairs awarded points, no best-of-version selection.',
    }
    result = {
        'status': 'offline-audit-complete-no-model-calls',
        'reproduciblePrevious90TaskScores': legacy['groups'],
        'latestCompleteAlgorithmScore': None,
        'reason': 'Calendar/default-summary/tool-access change the model inputs. Only 10-task paired diagnostics exist; old semantic grades cannot be transferred to new answers or spliced into a fresh 90-task score.',
        'probes': probes,
        'finalRunGatesStillOpen': [
            'Candidate tool-enabled arm still has one current-answer citation failure.',
            'Locked metadata fallback exists as a separate diagnostic, not the default RequestAgent online path.',
            'Final matched runner must explicitly bind the calendar task view and clock in both groups; original frozen runner still uses legacy public questions.',
        ],
        'nextRunPolicy': 'After integration/configuration is frozen: matched smoke first; only then full 90 per group with independent-context grading. Preserve all failed attempts; no full-history condition.',
    }
    (output / 'candidate-freeze.json').write_text(json.dumps(candidate, ensure_ascii=False, indent=2), encoding='utf8')
    (output / 'offline-audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps({'previousSpatialCards': legacy['groups']['spatial-memory']['cards'],
                      'latestCompleteAlgorithmScore': None,
                      'candidateStatus': candidate['status'],
                      'gates': result['finalRunGatesStillOpen']}, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('base', type=Path)
    p.add_argument('bank', type=Path); p.add_argument('output', type=Path)
    a = p.parse_args(); audit(a.base, a.bank, a.output)
