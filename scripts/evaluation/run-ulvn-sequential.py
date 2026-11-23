"""Finite, causal ULVN-based incremental grouping prototype. No VLM or GT input.

Official BPL update, sparse equivalent transition computation; incremental graph,
three-camera descriptor fusion, new-place gate and immutable group anchors are
explicit adaptations, not features claimed to exist in upstream static BPL.
"""
import argparse
import gc
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import time
from sequential_visual_policy import (select_direction_pairs, independent_view_support,
                                      continuous_sources, choose_supported_group)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--upstream', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    project = Path(__file__).resolve().parents[2]
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    bundle_path = project / 'run/unioncity-batch40-realtime813-v1-grounded-review-v1/bundle.json'
    bundle = json.loads(bundle_path.read_text(encoding='utf-8'))
    rows = bundle['observations']
    # Explicit frozen development configuration; not adjusted using this run's poses.
    config = {'candidateNodes': 3, 'pairsPerComparison': 4, 'minInliers': 60,
              'minRatio': 0.35, 'keyframeInterval': 8, 'maxSeconds': 1800,
              'continuityGraceObservations': 6, 'maxContinuityGapSourceMs': 2000,
              'revision': 'v2-continuity-multiview'}
    plan = {'task': 'Empty-map chronological 813-observation grouping, no VLM',
            'sourceSHA256': digest(bundle_path), 'scriptSHA256': digest(Path(__file__)),
            'configuration': config,
            'method': 'ULVN-based incremental adaptation, NOT unmodified official online mapping.',
            'adaptations': ['All three cameras: normalized mean MegaLoc descriptor for BPL, max pair cosine for geometric shortlist.',
                            'Insert keyframes after judging; never expose future images/descriptors.',
                            'Require geometric support to reuse immutable first-observation group anchor; prevents unlimited transitive group drift.',
                            'Official BPL posterior ranks supported group hypotheses; weak support creates a provisional visual group. Geometry-confirmed revisits reset belief onto that group when needed.',
                            'Graph edges are verified visual association, not certified traversability.',
                            'Sparse transition matrix is algebraically identical to upstream three-step adjacency-power normalization.'],
            'v2Changes': ['Always compare the immediately preceding actual observation, independent of map keyframe sampling.',
                          'Non-continuous revisit requires two distinct current/history camera correspondences, not a single best background pair.',
                          'Continuity supported by previous view and immutable anchor can remain confirmed; strong previous multi-view evidence without anchor is bounded provisional continuity, not certified identity.'],
            'limits': 'One frozen run, no paid calls, no pose/annotations/old Agent IDs used for inference; no threshold sweep.',
            'developmentWarning': 'Geometric gates are development settings informed by preceding frontend diagnostics, not independently calibrated probabilities.',
            'evaluation': 'After inference: inspect actual positions, exact recurrence controls, distinct-corner controls, group extents and runtime. Region/room semantics not inferred from anonymous IDs.'}
    (out / 'plan.json').write_text(json.dumps(plan, indent=2), encoding='utf-8')
    import numpy as np
    import scipy.sparse as sp
    sys.path.insert(0, str(args.upstream.resolve()))
    from ulvn_core.navigation import PlaceRecognition

    class SparseBPL(PlaceRecognition):
        def _build_transition_matrix(self):
            n = len(self.descriptors)
            binary = sp.csr_matrix((self.adjacency_matrix > 0).astype(np.float32))
            power = sp.eye(n, dtype=np.float32, format='csr')
            total = power.copy()
            for _ in range(self.max_steps):
                power = power @ binary
                total = total + power
            sums = np.asarray(total.sum(axis=1)).ravel()
            sums[sums == 0] = 1
            return sp.diags(1 / sums) @ total

    spec = importlib.util.spec_from_file_location('visual_worker', project / 'scripts/media/ulvn_match.py')
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    started = time.perf_counter()
    matcher = worker.Matcher('auto')
    load_seconds = time.perf_counter() - started
    nodes, groups, decisions = [], [], []
    adjacency = np.zeros((0, 0), dtype=np.float32)
    belief = None
    previous_group = None
    previous_observation = None
    comparisons = {}
    checks = 0

    def compare(current, reference):
        nonlocal checks
        key = (current['ordinal'], reference['ordinal'])
        if key in comparisons:
            return comparisons[key]
        similarities = current['vectors'] @ reference['vectors'].T
        chosen = select_direction_pairs(similarities, config['pairsPerComparison'])
        results = []
        for i, j in chosen:
            similarity = float(similarities[i, j])
            result = matcher.verify(current['images'][i], reference['images'][j])
            checks += 1
            results.append({**result, 'similarity': similarity,
                            'currentDirection': current['images'][i]['direction'],
                            'historicalDirection': reference['images'][j]['direction'],
                            'currentSHA256': current['images'][i]['sha256'],
                            'historicalSHA256': reference['images'][j]['sha256']})
            if independent_view_support(results, config['minInliers'], config['minRatio']):
                break
        best = max(results, key=lambda r: (r['inliers'], r['ratio'], r['similarity']))
        answer = {'supported': independent_view_support(results, config['minInliers'], config['minRatio']),
                  'localSupported': best['inliers'] >= config['minInliers'] and best['ratio'] >= config['minRatio'],
                  'referenceOrdinal': reference['ordinal'], 'best': best, 'directionChecks': results}
        comparisons[key] = answer
        return answer

    with (out / 'decisions.jsonl').open('x', encoding='utf-8') as stream:
        for ordinal, row in enumerate(rows, 1):
            if time.perf_counter() - started > config['maxSeconds']:
                raise TimeoutError('Finite sequential run exceeded time budget; partial decisions retained')
            tick = time.perf_counter()
            current_images = [dict(v, id=row['id']) for v in row['views']]
            if len(current_images) != 3:
                raise ValueError('Expected three cameras')
            vectors = matcher.encode(current_images)
            descriptor = vectors.mean(axis=0)
            descriptor = descriptor / max(float(np.linalg.norm(descriptor)), 1e-12)
            current = {'ordinal': ordinal, 'images': current_images, 'vectors': vectors,
                       'descriptor': descriptor, 'group': None,
                       'sourceTimeMs': row.get('sourceAtMs', row['atMs']), 'recordingId': row.get('recordingId')}
            candidates, supported = [], {}
            posterior = None
            if nodes:
                can_continue = continuous_sources(previous_observation, current, config['maxContinuityGapSourceMs'])
                if can_continue:
                    previous_check = compare(current, previous_observation)
                    previous_node = max(i for i, node in enumerate(nodes) if node['group'] == previous_group)
                    candidates.append({'node': previous_node, 'group': previous_group, 'channel': 'continuity',
                                       'graphEligible': nodes[previous_node]['ordinal'] == previous_observation['ordinal'], **previous_check})
                # Max over actual direction pairs; chronology and old place names are not visual scores.
                similarities = np.array([float(np.max(vectors @ n['vectors'].T)) for n in nodes])
                shortlist, seen_groups = [], set()
                for index in np.argsort(-similarities, kind='stable'):
                    candidate_group = nodes[int(index)]['group']
                    if (not can_continue or candidate_group != previous_group) and candidate_group not in seen_groups:
                        shortlist.append(int(index))
                        seen_groups.add(candidate_group)
                    if len(shortlist) == config['candidateNodes']:
                        break
                for index in shortlist:
                    result = compare(current, nodes[int(index)])
                    candidates.append({'node': int(index), 'group': nodes[int(index)]['group'], 'channel': 'historical', 'graphEligible': True, **result})
                model = SparseBPL(np.stack([n['descriptor'] for n in nodes]), adjacency, max_steps=3, delta=5)
                if belief is not None:
                    model.belief = belief.copy()
                    model.lambda1 = lambda_value
                model.match(descriptor)
                posterior = model.belief.copy()
                lambda_value = model.lambda1
                for c in candidates:
                    if not c['localSupported']:
                        continue
                    if c['channel'] == 'historical' and not c['supported']:
                        continue
                    group = c['group']
                    anchor = groups[group]['anchor']
                    anchor_check = compare(current, anchor)
                    confirmed = (anchor_check['supported'] and c['supported']) or (
                        c['channel'] == 'continuity' and c['localSupported'] and anchor_check['localSupported'])
                    provisional = (not confirmed and c['channel'] == 'continuity' and c['supported']
                                   and ordinal - groups[group]['lastAnchorConfirmed'] <= config['continuityGraceObservations'])
                    if confirmed or provisional:
                        supported[group] = {'group': group, 'anchorEvidence': anchor_check,
                                            'continuityEvidence': c if c['channel'] == 'continuity' else None,
                                            'identityConfirmed': confirmed,
                                            'belief': float(sum(posterior[i] for i, n in enumerate(nodes) if n['group'] == group))}
            if supported:
                choice = choose_supported_group(supported, previous_group)
                group = choice['group']
                identity_confirmed = choice['identityConfirmed']
                action = ('continue' if identity_confirmed else 'provisional-continue') if previous_group == group and can_continue else 'revisit'
                reference_ordinal = choice['anchorEvidence']['referenceOrdinal']
                evidence = choice['anchorEvidence']
                continuity_evidence = choice['continuityEvidence']
                if identity_confirmed:
                    groups[group]['lastAnchorConfirmed'] = ordinal
                if action == 'revisit':
                    mask = np.array([n['group'] == group for n in nodes], dtype=np.float32)
                    posterior = posterior * mask
                    if posterior.sum() <= 1e-20:
                        posterior = np.zeros(len(nodes), dtype=np.float32)
                        best_node = max((c for c in candidates if c['group'] == group), key=lambda c: c['best']['inliers'])['node']
                        posterior[best_node] = 1
                    else:
                        posterior /= posterior.sum()
            else:
                group = len(groups)
                action, reference_ordinal, evidence = 'new', None, None
                identity_confirmed, continuity_evidence = True, None
                groups.append({'anchor': current, 'members': [], 'lastAnchorConfirmed': ordinal})
            current['group'] = group
            groups[group]['members'].append(ordinal)
            insert = action == 'new' or ordinal - nodes[-1]['ordinal'] >= config['keyframeInterval']
            if insert:
                size = len(nodes)
                expanded = np.zeros((size + 1, size + 1), dtype=np.float32)
                expanded[:size, :size] = adjacency
                for c in candidates:
                    if c['localSupported'] and c['graphEligible']:
                        expanded[size, c['node']] = expanded[c['node'], size] = c['best']['inliers']
                adjacency = expanded
                nodes.append(current)
                if action == 'new':
                    belief = np.zeros(len(nodes), dtype=np.float32)
                    belief[-1] = 1
                    # Recalibrate only from currently available descriptors, with upstream initialization rule.
                    bootstrap = SparseBPL(np.stack([n['descriptor'] for n in nodes]), adjacency, max_steps=3, delta=5)
                    bootstrap.initialize_model(descriptor)
                    lambda_value = bootstrap.lambda1
                else:
                    belief = np.append(posterior, 0).astype(np.float32)
            else:
                belief = posterior
            previous_group = group
            previous_observation = current
            record = {'ordinal': ordinal, 'observationId': row['id'], 'group': group,
                      'action': action, 'anchorOrdinal': reference_ordinal,
                      'evidence': evidence, 'continuityEvidence': continuity_evidence,
                      'identityConfirmed': identity_confirmed, 'candidates': candidates, 'nodes': len(nodes),
                      'elapsedMs': (time.perf_counter() - tick) * 1000}
            decisions.append(record)
            stream.write(json.dumps(record, ensure_ascii=False) + '\n')
            stream.flush()
            if ordinal % 25 == 0 or ordinal == 813:
                print(json.dumps({'processed': ordinal, 'groups': len(groups), 'nodes': len(nodes),
                                  'elapsedSeconds': time.perf_counter() - started}), flush=True)
            # Request-local comparison memo needs no future retention.
            comparisons.clear()
    # Evaluation is deliberately loaded only after causal inference is complete.
    reference_path = project / 'run/gmod-annotated-rerender-v2-final/sample-human-confirmed.json'
    if digest(reference_path) != bundle['hashes']['reference']:
        raise ValueError('Evaluation map changed')
    sample = json.loads(reference_path.read_text(encoding='utf-8'))
    positions = np.array([f['position'] for f in sample['frames']], dtype=float)
    pair_specs = [('hardware-return', 65, 380, 'return-control'),
                  ('interior-return', 68, 388, 'return-control'),
                  ('park-return', 138, 220, 'return-control'),
                  ('rotation', 324, 325, 'continuity-control'),
                  ('different-intersections', 100, 680, 'distinct-corner-control'),
                  ('different-streets', 440, 680, 'distinct-corner-control'),
                  ('different-theatre-corner', 580, 660, 'distinct-corner-control'),
                  ('v1-porch-pawn-alias', 163, 473, 'known-false-merge-regression'),
                  ('v1-south-diner-alias', 237, 460, 'known-false-merge-regression'),
                  ('v1-apartment-pawn-alias', 163, 698, 'known-false-merge-regression'),
                  ('v1-theatre-gas-alias', 547, 595, 'known-false-merge-regression'),
                  ('door-boundary', 380, 388, 'granularity-review'),
                  ('shop-boundary', 280, 300, 'granularity-review'),
                  ('stairs-boundary', 320, 340, 'granularity-review')]
    pairs = [{'name': name, 'a': a, 'b': b, 'category': category,
              'sameGroup': decisions[a - 1]['group'] == decisions[b - 1]['group'],
              'bothIdentityConfirmed': decisions[a - 1]['identityConfirmed'] and decisions[b - 1]['identityConfirmed'],
              'groupA': decisions[a - 1]['group'], 'groupB': decisions[b - 1]['group'],
              'xy': float(np.linalg.norm(positions[a - 1, :2] - positions[b - 1, :2])),
              'dz': float(abs(positions[a - 1, 2] - positions[b - 1, 2]))}
             for name, a, b, category in pair_specs]
    extents = []
    for i, group in enumerate(groups):
        members = group['members']
        coords = positions[np.array(members) - 1]
        extents.append({'group': i, 'anchorOrdinal': group['anchor']['ordinal'], 'members': members,
                        'xyBoundingDiagonal': float(np.linalg.norm(np.ptp(coords[:, :2], axis=0))),
                        'zSpan': float(np.ptp(coords[:, 2]))})
    report = {'completed': len(decisions) == 813, 'observations': len(decisions),
              'groups': len(groups), 'keyframeNodes': len(nodes),
              'actions': {a: sum(r['action'] == a for r in decisions) for a in ['new', 'continue', 'provisional-continue', 'revisit']},
              'provisionalObservations': sum(not r['identityConfirmed'] for r in decisions),
              'loadSeconds': load_seconds, 'totalSeconds': time.perf_counter() - started,
              'perObservationMedianMs': float(np.median([r['elapsedMs'] for r in decisions])),
              'perObservationP95Ms': float(np.percentile([r['elapsedMs'] for r in decisions], 95)),
              'geometricPairChecks': checks, 'pairControls': pairs, 'groupExtents': extents,
              'limitations': ['Explicit ULVN-based online extension, not an upstream capability claim.',
                              'Anonymous visual partitions are not semantic room labels.',
                              'Development controls, not an independent dataset; no production certification.',
                              'new means unsupported anchor, not proof that this location has never been visited.']}
    np.save(out / 'visual-adjacency.npy', adjacency)
    (out / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k != 'groupExtents'}), flush=True)
    del matcher
    gc.collect()


if __name__ == '__main__':
    main()
