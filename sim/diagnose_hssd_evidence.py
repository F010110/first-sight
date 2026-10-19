"""Read-only evidence diagnostic. No model calls, threshold changes or result replacement."""
import importlib.util
import json
from pathlib import Path
import cv2
import numpy as np
from download_hssd import SCENES

spec = importlib.util.spec_from_file_location('image_match',Path('scripts/image_match.py'))
matcher = importlib.util.module_from_spec(spec); spec.loader.exec_module(matcher)
cv2.setNumThreads(1); cv2.setRNGSeed(0)


def second(values):
    return sorted(values,reverse=True)[1] if len(values)>1 else 0


def main():
    root = Path('run/hssd-six-v1'); rows = []
    for scene in SCENES:
        captures = sorted(p.parent for p in (root/scene).glob('attempt-*/capture/manifest.json'))
        if not captures:
            continue
        capture = captures[-1]; attempt = capture.parent
        windows = [json.loads(line) for line in (capture/'windows.jsonl').read_text().splitlines()]
        pairs_path = attempt/'pipeline/baseline/experience-directional-evidence.json'
        if not pairs_path.exists():
            continue
        pairs = json.loads(pairs_path.read_text())
        cached = {tuple(sorted((p['a'],p['b']))):p for p in pairs}
        detector,norm = matcher.make_detector('sift'); features = []; keypoints = []
        for window in windows:
            views = []
            for directory in ['frames','left','right']:
                kp,desc,_ = matcher.features(str(capture/directory/window['frame']),detector,640)
                views.append((kp,desc)); keypoints.append(len(kp))
            features.append(views)
        adjacent = []
        for i in range(len(windows)-1):
            a,b = features[i],features[i+1]
            forward = [[matcher.match(x,y,norm,.75)['inliers'] for y in b] for x in a]
            backward = [[matcher.match(y,x,norm,.75)['inliers'] for x in a] for y in b]
            full_forward = [min(max(r)/60,1) for r in forward]
            full_backward = [min(max(r)/60,1) for r in backward]
            pair = cached[tuple(sorted((f'observation-{i+1}',f'observation-{i+2}')))]
            original = min(second(pair['bearings']),second(pair['backwardBearings']))
            corrected = min(second(full_forward),second(full_backward))
            adjacent.append({'a':f'observation-{i+1}','b':f'observation-{i+2}','cachedConfidence':original,
                             'allQueryDirectionsConfidence':corrected,'forwardInlierMatrix':forward,'backwardInlierMatrix':backward})
        vo = json.loads((attempt/'pipeline/vo.json').read_text())
        row = {'sceneId':scene,'observations':len(windows),'siftKeypointsMedian':float(np.median(keypoints)),
               'siftKeypointsMin':min(keypoints),'allPairCount':len(pairs),
               'cachedPositivePairs':sum(min(second(p['bearings']),second(p['backwardBearings']))>=.4 for p in pairs),
               'cachedAdjacentPositivePairs':sum(p['cachedConfidence']>=.4 for p in adjacent),
               'allQueryDirectionsAdjacentPositivePairs':sum(p['allQueryDirectionsConfidence']>=.4 for p in adjacent),
               'oldAnchorPairBelowThreshold':adjacent[0]['cachedConfidence']<.4,
               'fullQueryOldAnchorPairBelowThreshold':adjacent[0]['allQueryDirectionsConfidence']<.4,
               'vo':vo['counts'],'adjacentDiagnostics':adjacent,
               'note':'Full-query matrix is diagnostic only. Candidate-best-query compression can discard other valid query directions. No baseline assignments, cached evidence or VLM predictions changed.'}
        rows.append(row)
    output = {'protocol':'hssd-evidence-readonly-diagnostic-v1','rows':rows,'threshold':.4,'scoring':'Not physical region truth or acceptance. Same SIFT/inlier normalization used, only revealing discarded query direction scores.'}
    (root/'evidence-diagnostic.json').write_text(json.dumps(output,indent=2))
    print(json.dumps([{k:v for k,v in r.items() if k not in ['adjacentDiagnostics','note']} for r in rows],indent=2))


if __name__ == '__main__':
    main()
