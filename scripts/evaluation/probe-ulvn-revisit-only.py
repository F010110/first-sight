"""Bounded revisit-only diagnostic: no grouping, anchors, new-place or VLM."""
import hashlib
import importlib.util
import json
from pathlib import Path
import time
import argparse
from sequential_visual_policy import select_direction_pairs, independent_view_support


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--final-check', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    out = root / ('run/ulvn-revisit-final-v1' if args.final_check else 'run/ulvn-revisit-only-v1')
    out.mkdir(parents=True, exist_ok=False)
    source = root / 'run/unioncity-batch40-realtime813-v1-grounded-review-v1/bundle.json'
    # Controls select queries only. Expected identities are never given to retrieval.
    queries = [220, 380, 388, 460, 473, 595, 680, 698]
    if args.final_check:
        queries = sorted(queries + [660])
    config = {'queries': queries, 'recentExclusionObservations': 30,
              'candidateCount': 5, 'candidateTemporalSeparation': 8,
              'pairsPerCandidate': 4, 'minInliers': 60, 'minRatio': .35,
              'maxSeconds': 1200}
    if args.final_check:
        config.update(candidateCount=20, candidateTemporalSeparation=0, pairsPerCandidate=9)
    # Forced pairs are isolated diagnostics, NEVER extra retrieval candidates.
    negative_controls = {460: [237], 473: [163], 595: [547],
                         660: [580], 680: [100, 440], 698: [163]}
    plan = {'configuration': config, 'sourceSHA256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'scriptSHA256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'method': 'MegaLoc retrieval + LightGlue verification from ULVN frontend; not full upstream BPL.',
            'scope': 'Revisit evidence only, no place creation/grouping/anchor gate. No VLM or ground truth input.',
            'limits': 'One fixed local run, no threshold sweep. Development controls, not independent accuracy benchmark.',
            'exclusionMeaning': '30-observation exclusion suppresses immediate continuity; not proof of having left a place.'}
    (out / 'plan.json').write_text(json.dumps(plan, indent=2), encoding='utf-8')
    import numpy as np
    spec = importlib.util.spec_from_file_location('worker', root / 'scripts/media/ulvn_match.py')
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    started = time.perf_counter()
    matcher = worker.Matcher('auto')
    rows = json.loads(source.read_text(encoding='utf-8'))['observations']
    history = []
    reports = []
    with (out / 'queries.jsonl').open('x', encoding='utf-8') as stream:
        for ordinal, row in enumerate(rows[:max(queries)], 1):
            if time.perf_counter() - started > config['maxSeconds']:
                raise TimeoutError('Budget exhausted; partial evidence retained')
            images = [dict(view, id=row['id']) for view in row['views']]
            vectors = matcher.encode(images)
            if ordinal in queries:
                eligible = history[:max(0, ordinal - config['recentExclusionObservations'] - 1)]
                scores = [float(np.max(vectors @ h['vectors'].T)) for h in eligible]
                selected = []
                for index in sorted(range(len(scores)), key=lambda i: (-scores[i], i)):
                    h = eligible[index]
                    if all(abs(h['ordinal'] - x['ordinal']) >= config['candidateTemporalSeparation'] for x in selected):
                        selected.append(h)
                    if len(selected) == config['candidateCount']:
                        break
                candidates = []
                diagnostics = []
                forced = [h for h in eligible if h['ordinal'] in negative_controls.get(ordinal, [])] if args.final_check else []
                selected_ids = {h['ordinal'] for h in selected}
                for h in selected + [h for h in forced if h['ordinal'] not in selected_ids]:
                    if time.perf_counter() - started > config['maxSeconds']:
                        raise TimeoutError('Budget exhausted; partial evidence retained')
                    similarity = vectors @ h['vectors'].T
                    checks = []
                    for i, j in select_direction_pairs(similarity, config['pairsPerCandidate']):
                        result = matcher.verify(images[i], h['images'][j])
                        checks.append({**result, 'currentDirection': images[i]['direction'],
                                       'historicalDirection': h['images'][j]['direction'],
                                       'currentSHA256': images[i]['sha256'],
                                       'historicalSHA256': h['images'][j]['sha256']})
                    result = {'referenceOrdinal': h['ordinal'],
                                       'similarity': float(similarity.max()), 'directionChecks': checks,
                                       'multiViewSupported': independent_view_support(checks, 60, .35),
                                       'singleViewSupported': any(x['inliers'] >= 60 and x['ratio'] >= .35 for x in checks)}
                    if h['ordinal'] in selected_ids:
                        candidates.append(result)
                    if h['ordinal'] in negative_controls.get(ordinal, []) and args.final_check:
                        diagnostics.append(result)
                record = {'ordinal': ordinal, 'eligibleHistoryCount': len(eligible), 'candidates': candidates,
                          'forcedNegativeDiagnostics': diagnostics,
                          'supportedHistoricalObservations': [x['referenceOrdinal'] for x in candidates if x['multiViewSupported']]}
                reports.append(record)
                stream.write(json.dumps(record) + '\n')
                stream.flush()
                print(json.dumps(record), flush=True)
            # Only previously processed observations can be retrieved.
            history.append({'ordinal': ordinal, 'images': images, 'vectors': vectors})
    report = {'completed': len(reports) == len(queries), 'queryCount': len(reports),
              'totalSeconds': time.perf_counter() - started, 'queries': reports,
              'interpretation': 'Supported image correspondences require image/map audit before certifying occupied-place identity. No hit is not a new-place decision.'}
    (out / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
