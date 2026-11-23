"""Free summary of the fixed local frontend probe; no thresholds or model calls."""
import argparse
import json
import statistics
from pathlib import Path


def summarize(report):
    records = report['records']
    summaries = []
    # Warm repeats are timing samples, never extra accuracy trials.
    for backend in ['legacy', 'ulvn']:
        rows = [r for r in records if r['backend'] == backend and r['repeat'] == 1]
        retrieval = [r for r in rows if r['kind'] == 'retrieval']
        sensitivity = []
        for radius in [100, 200, 400]:
            labels = [(r, next(x for x in r['retrieval'] if x['radius'] == radius))
                      for r in retrieval]
            eligible = [(r, x) for r, x in labels if x['positiveRefs']]
            counts = {}
            for mode in ['geometry', 'global']:
                counts[mode] = {str(k): sum(next(v for v in x[mode] if v['k'] == k)['hit']
                                          for _, x in eligible) for k in [1, 3, 5]}
            sensitivity.append({'radius': radius, 'eligibleQueries': len(eligible),
                                'archiveWithoutNearReference': [r['q'] for r, x in labels if not x['positiveRefs']],
                                'hitCounts': counts})
        pairs = []
        for r in rows:
            if r['kind'] != 'pair':
                continue
            best = r['result'].get('best') or {}
            pair = r.get('bestPair') or {}
            pairs.append({'name': r['name'], 'category': r['category'],
                          'inliers': best.get('inliers'), 'similarity': best.get('similarity'),
                          'good': best.get('good'), 'ratio': best.get('ratio'),
                          'currentDirection': (pair.get('current') or {}).get('direction'),
                          'historicalDirection': (pair.get('historical') or {}).get('direction'),
                          'elapsedMs': r['elapsedMs']})
        summaries.append({'backend': backend, 'warmPairDiagnostics': pairs,
                          'physicalRetrievalSensitivity': sensitivity,
                          'warmMedianAllMs': statistics.median(r['elapsedMs'] for r in rows) if rows else None,
                          'warmMedianRetrievalMs': statistics.median(r['elapsedMs'] for r in retrieval) if retrieval else None,
                          'processFirstWallMs': next((r['elapsedMs'] for r in records
                                                     if r['backend'] == backend), None)})
    return {'completed': report['completed'], 'summary': summaries,
            'notes': ['Physical anchor retrieval only, not semantic region or visit recall.',
                      'No reference in archive means not scorable as a positive recall trial, not never visited.',
                      'Pair scores are diagnostics, not calibrated confidence or automatic identity decisions.',
                      'Second pass is cache timing; it does not increase independent sample size.']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('report', type=Path)
    args = parser.parse_args()
    print(json.dumps(summarize(json.loads(args.report.read_text(encoding='utf-8'))),
                     ensure_ascii=False, indent=2))
