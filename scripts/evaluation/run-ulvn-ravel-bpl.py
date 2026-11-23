"""Run pinned official RAVEL graph scripts + official BPL, with no VLM.

Uses a pinned MegaLoc encoder already installed for the frontend experiments.
Map/poses are evaluation-only. No production database or architecture is changed.
"""
import argparse
import gc
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time


PIN = 'e2f47fe3e2757a1ebdc041f4364dddd26a19f9f5'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command(args, log, cwd):
    started = time.perf_counter()
    with log.open('x', encoding='utf-8') as stream:
        result = subprocess.run([str(a) for a in args], cwd=cwd, stdout=stream,
                                stderr=subprocess.STDOUT, timeout=1200)
    if result.returncode:
        raise RuntimeError(f'Official command failed ({result.returncode}); see {log}')
    return time.perf_counter() - started


def score(predictions, positions):
    import numpy as np
    summary = []
    for radius in [100, 200, 400]:
        eligible = [r for r in predictions if r['nearestReferenceXY'] <= radius
                    and r['nearestReferenceDZ'] <= 48]
        summary.append({'radiusSourceUnits': radius, 'eligible': len(eligible),
                        'bplCorrect': sum(r['bplXY'] <= radius and r['bplDZ'] <= 48 for r in eligible),
                        'vprCorrect': sum(r['vprXY'] <= radius and r['vprDZ'] <= 48 for r in eligible),
                        'outsideReferenceCoverage': len(predictions) - len(eligible)})
    return {'physicalLocalization': summary,
            'bplMedianMs': float(np.median([r['bplMs'] for r in predictions])),
            'bplP95Ms': float(np.percentile([r['bplMs'] for r in predictions], 95)),
            'allPredictions': len(predictions)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--upstream', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[2]
    upstream, out = args.upstream.resolve(), args.output.resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=upstream, text=True).strip()
    if head != PIN:
        raise ValueError('Upstream commit mismatch')
    out.mkdir(parents=True, exist_ok=False)
    bundle_path = project / 'run/unioncity-batch40-realtime813-v1-grounded-review-v1/bundle.json'
    reference_path = project / 'run/gmod-annotated-rerender-v2-final/sample-human-confirmed.json'
    bundle = json.loads(bundle_path.read_text(encoding='utf-8'))
    if sha(reference_path) != bundle['hashes']['reference']:
        raise ValueError('Evaluation map binding mismatch')
    rows = bundle['observations']
    if len(rows) != 813:
        raise ValueError('Expected frozen 813 observations')
    # Selection depends only on chronological ordinal, not image labels or poses.
    modes = [
        {'name': 'prebuilt-heldout', 'references': list(range(0, 813, 8)),
         'queries': [i for i in range(813) if i % 8],
         'scope': 'Reference traversal/map available in advance; heldout observations were not map nodes. NOT online exploration.'},
        {'name': 'causal-prefix', 'references': list(range(0, 321, 8)),
         'queries': list(range(321, 813)),
         'scope': 'Only observations <=321 build map; later observations include unmapped territory. Official fixed-node BPL has no new-node/rejection action.'},
    ]
    source_files = ['RAVEL/scripts/build_matrix.py', 'RAVEL/scripts/analyze_parameters.py',
                    'RAVEL/scripts/prune_topomap_nx.py', 'ulvn_core/navigation.py']
    plan = {'upstreamCommit': head, 'sourceHashes': {f: sha(upstream / f) for f in source_files},
            'bundleSHA256': sha(bundle_path), 'referenceSHA256': sha(reference_path), 'modes': modes,
            'referenceStride': 8, 'camera': 'front only, official single-image BPL; no invented multi-camera fusion',
            'encoder': 'pinned MegaLoc source/weights from existing worker, 320x320/ImageNet/L2',
            'ravel': 'Official unmodified build_matrix.py and prune_topomap_nx.py; 2-cluster calibration on reference set only, one GPU thread, RANSAC enabled, add-back threshold300',
            'bpl': 'Official unmodified PlaceRecognition(max_steps=3,delta=5); sequential heldout query images, no GT initialization',
            'limits': 'At most two graph builds, each subprocess <=1200 seconds; finite selected sets; no paid model calls or VLM',
            'evaluation': 'Map/poses read only after building/inference; radius100/200/400 XY source units,dz<=48; not semantic region or old Agent-ID equality',
            'decision': 'Report known-map localization separately from online new-place coverage. Forced mapped-node assignment outside map cannot count as correct grouping. Do not use connected components as semantic places.'}
    (out / 'plan.json').write_text(json.dumps(plan, indent=2), encoding='utf-8')
    (out / 'environment-freeze.txt').write_text(subprocess.check_output([sys.executable, '-m', 'pip', 'freeze'], text=True), encoding='utf-8')
    images = []
    for row in rows:
        view = next(v for v in row['views'] if v['direction'] == 'front')
        if sha(Path(view['path'])) != view['sha256']:
            raise ValueError('Source image changed')
        images.append({**view, 'id': row['id']})
    import numpy as np
    import torch
    import faiss
    spec = importlib.util.spec_from_file_location('pinned_frontend', project / 'scripts/media/ulvn_match.py')
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    started = time.perf_counter()
    encoder = worker.Matcher('auto')
    descriptors = encoder.encode(images)
    np.save(out / 'all_front_descriptors.npy', descriptors)
    encoder_seconds = time.perf_counter() - started
    encoder_info = {'seconds': encoder_seconds, 'device': encoder.device,
                    'weightsSHA256': encoder.weights_sha256, 'weightsRevision': worker.MEGALOC_WEIGHTS_REVISION}
    del encoder
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    (out / 'encoder.json').write_text(json.dumps(encoder_info, indent=2), encoding='utf-8')
    print(json.dumps({'stage': 'encoded', 'images': len(images), **encoder_info}), flush=True)
    sys.path.insert(0, str(upstream))
    from ulvn_core.navigation import PlaceRecognition
    mode_results = []
    for mode in modes:
        folder = out / mode['name']
        folder.mkdir()
        refs = mode['references']
        features = descriptors[refs].copy()
        np.save(folder / 'features.npy', features)
        paths = folder / 'paths.txt'
        paths.write_text('\n'.join(images[i]['path'] for i in refs) + '\n', encoding='utf-8')
        index = faiss.IndexFlatL2(features.shape[1])
        index.add(features)
        faiss.write_index(index, str(folder / 'index.faiss'))
        graph_dir = folder / 'graph'
        build_seconds = command([
            sys.executable, upstream / 'RAVEL/scripts/build_matrix.py',
            '--features_path', folder / 'features.npy', '--index_path', folder / 'index.faiss',
            '--paths_txt', paths, '--result_dir', graph_dir,
            '--out_plot_path', folder / 'calibration.png', '--num_threads', '1',
            '--lightglue_weights', 'outdoor', '--num_clusters', '2', '--base_query_idx', '0',
        ], folder / 'ravel-build.log', upstream / 'RAVEL')
        prune_seconds = command([
            sys.executable, upstream / 'RAVEL/scripts/prune_topomap_nx.py',
            '--weighted_matrix', graph_dir / 'adjacency_matrix.npy', '--paths_txt', paths,
            '--out_matrix_path', folder / 'pruned.npy', '--out_viz_path', folder / 'pruned.png',
            '--add_back_threshold', '300',
        ], folder / 'ravel-prune.log', upstream / 'RAVEL')
        adjacency = np.load(folder / 'pruned.npy')
        localizer = PlaceRecognition(features, adjacency, max_steps=3, delta=5.0)
        predictions = []
        for q in mode['queries']:
            started = time.perf_counter()
            node, confidence = localizer.match(descriptors[q])
            elapsed_ms = (time.perf_counter() - started) * 1000
            vpr = int(np.argmax(features @ descriptors[q]))
            predictions.append({'queryOrdinal': q + 1, 'queryId': rows[q]['id'],
                                'bplNode': node, 'referenceOrdinal': refs[node] + 1,
                                'referenceId': rows[refs[node]]['id'], 'confidence': confidence,
                                'beliefEntropy': localizer._compute_belief_entropy(),
                                'vprReferenceOrdinal': refs[vpr] + 1, 'bplMs': elapsed_ms})
        # Only now expose evaluation positions; not used for graph or localization.
        sample = json.loads(reference_path.read_text(encoding='utf-8'))
        positions = np.array([f['position'] for f in sample['frames']], dtype=float)
        reference_positions = positions[refs]
        for r in predictions:
            point = positions[r['queryOrdinal'] - 1]
            distances = np.linalg.norm(reference_positions[:, :2] - point[:2], axis=1)
            heights = abs(reference_positions[:, 2] - point[2])
            same_height = np.flatnonzero(heights <= 48)
            closest = int(same_height[np.argmin(distances[same_height])]) if len(same_height) else int(np.argmin(distances))
            bpl_point = positions[r['referenceOrdinal'] - 1]
            vpr_point = positions[r['vprReferenceOrdinal'] - 1]
            r.update({'nearestReferenceXY': float(distances[closest]), 'nearestReferenceDZ': float(heights[closest]),
                      'nearestReferenceOrdinal': refs[closest] + 1,
                      'bplXY': float(np.linalg.norm(bpl_point[:2] - point[:2])), 'bplDZ': float(abs(bpl_point[2] - point[2])),
                      'vprXY': float(np.linalg.norm(vpr_point[:2] - point[:2])), 'vprDZ': float(abs(vpr_point[2] - point[2]))})
        runs = []
        for r in predictions:
            if runs and runs[-1]['node'] == r['bplNode']:
                runs[-1]['queryOrdinals'].append(r['queryOrdinal'])
            else:
                runs.append({'node': r['bplNode'], 'referenceId': r['referenceId'], 'queryOrdinals': [r['queryOrdinal']]})
        (folder / 'predictions.json').write_text(json.dumps(predictions, indent=2), encoding='utf-8')
        (folder / 'visual-node-runs.json').write_text(json.dumps(runs, indent=2), encoding='utf-8')
        import networkx as nx
        graph = nx.from_numpy_array(np.where(adjacency > 0, adjacency, 0))
        result = {'mode': mode['name'], 'scope': mode['scope'], 'references': len(refs),
                  'edges': graph.number_of_edges(), 'components': nx.number_connected_components(graph),
                  'isolatedNodes': len(list(nx.isolates(graph))), 'ravelBuildSeconds': build_seconds,
                  'pruneSeconds': prune_seconds, 'visualNodeRuns': len(runs), **score(predictions, positions)}
        (folder / 'summary.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        mode_results.append(result)
        print(json.dumps(result), flush=True)
    (out / 'report.json').write_text(json.dumps({'completed': True, 'encoder': encoder_info, 'modes': mode_results,
        'limitations': ['Pure official RAVEL+BPL with no VLM; only front camera.',
                        'Prebuilt map evaluation is not online unseen-place discovery.',
                        'Node runs are visual partitions, not semantic rooms; graph components are not places.',
                        'No reference/query self-image leakage; no pose/GT used in inference.',
                        'Public implementation defaults fixed before results; no result-driven tuning.']}, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
