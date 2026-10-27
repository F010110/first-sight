"""Fixed-denominator baseline summary. No new API calls."""
import collections
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    judge = json.loads((ROOT / 'reports/minival26-qwen-judge-v1.json').read_text(encoding='utf-8'))
    progress = json.loads((ROOT / 'reports/minival26-baseline-v1-progress.json').read_text())
    rows = judge['rows']
    assert len(rows) == 26 and len({r['questionId'] for r in rows}) == 26
    normalized = []
    for row in rows:
        score = row['score']
        if score is None:
            raise ValueError('Unresolved judge failure; do not silently omit')
        normalized.append(0. if not row['prediction'] else 100 * (score - 1) / 4)
    tokens = collections.Counter()
    calls = 0
    for path in (ROOT / 'runs/minival26-baseline-v1').glob('*/api-usage.jsonl'):
        for line in path.read_text(encoding='utf-8').splitlines():
            data = json.loads(line)
            calls += 1
            for key in ('prompt_tokens', 'completion_tokens', 'total_tokens'):
                tokens[key] += (data.get('usage') or {}).get(key, 0)
    result = {'questions': 26, 'processCompleted': sum(r['status'] == 'process_completed' for r in progress['executions']),
              'answersPresent': sum(bool(r['prediction']) for r in rows),
              'histogramRaw': dict(collections.Counter(r['score'] for r in rows)),
              'normalizedMatch': sum(normalized) / 26,
              'normalization': '100*(raw-1)/4 for answers; missing answer=0; fixed denominator=26',
              'perfectMatchCountJudge': sum(r['score'] == 5 for r in rows),
              'hours': sum(r['seconds'] for r in progress['executions']) / 3600,
              'inferenceSuccessfulApiCalls': calls, 'inferenceTokens': dict(tokens),
              'judgeBackend': judge['judgeModel'], 'manualVisualReviewComplete': False,
              'caveat': 'Adapted raw-GLB minival subset + Qwen inference/judge; not official paper reproduction; no SPL or perturbation comparison yet'}
    (ROOT / 'reports/minival26-baseline-v1-summary.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
