"""Post-run evidence audit only. Map positions never enter producer inference."""
import argparse
import hashlib
import json
import math
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('run', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    complete = json.loads((args.run / 'complete.json').read_text(encoding='utf-8'))
    states = [json.loads(p.read_text(encoding='utf-8'))['state'] for p in sorted((args.run / 'contexts').glob('*.json'))]
    assignments = {o['id']: s for s in states for o in s.get('window', {}).get('observations', [])}
    decisions = [d for p in (args.run / 'ulvn-decisions').glob('*.json') for d in json.loads(p.read_text(encoding='utf-8'))['decisions']]
    root = Path(__file__).resolve().parents[2]
    reference = root / 'run/gmod-annotated-rerender-v2-final/sample-human-confirmed.json'
    frames = json.loads(reference.read_text(encoding='utf-8'))['frames']
    by_id = {r['id']: r for r in frames}
    rows = []
    for d in decisions:
        current, old = by_id[d['observationId']], by_id[d['historicalObservationId']]
        state = assignments.get(d['observationId'])
        rows.append({'currentId': d['observationId'], 'historicalId': d['historicalObservationId'],
                     'placeId': d['placeId'], 'applied': bool(state and state['assessment']['location']['placeId'] == d['placeId']),
                     'historicalSourceCited': bool(state and d['historicalObservationId'] in state['assessment']['location']['sourceIds']),
                     'xyDistance': math.dist(current['position'][:2], old['position'][:2]),
                     'heightDifference': abs(current['position'][2] - old['position'][2]),
                     'note': 'Distance/height are review signals, not semantic error verdicts.'})
    controls = []
    for a, b, category in [(65,380,'return'),(68,388,'return'),(138,220,'return'),(163,473,'different'),(237,460,'different'),(163,698,'different'),(547,595,'different'),(580,660,'different'),(100,680,'different'),(440,680,'different')]:
        aid, bid = [f'rerender-v2-{n:06}' for n in (a,b)]
        x, y = assignments.get(aid), assignments.get(bid)
        controls.append({'a':a,'b':b,'category':category,'covered':bool(x and y),
                         'placeA':x['assessment']['location']['placeId'] if x else None,
                         'placeB':y['assessment']['location']['placeId'] if y else None,
                         'sameId':bool(x and y and x['assessment']['location']['placeId'] and x['assessment']['location']['placeId']==y['assessment']['location']['placeId']),
                         'explicitUlvnAtB':[d['historicalObservationId'] for d in decisions if d['observationId']==bid],
                         'note':'Same/different ID alone does not adjudicate granularity or physical identity.'})
    report = {'completed':complete['completed'],'observations':complete['observations'],
              'coveredObservations':complete['coveredObservations'],'elapsedMs':complete['elapsedMs'],
              'states':len(states),'ulvnDecisions':len(rows),'authorityMismatches':sum(not r['applied'] for r in rows),
              'uncitedMatchedSources':sum(not r['historicalSourceCited'] for r in rows),
              'usage':complete['usage'],'controls':controls,
              'mapReferenceSHA256':hashlib.sha256(reference.read_bytes()).hexdigest(),
              'reviewSignals':sorted(rows,key=lambda r:-(r['xyDistance']+r['heightDifference']))}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with args.output.open('x',encoding='utf-8') as stream:
        json.dump(report,stream,ensure_ascii=False,indent=2)
    print(json.dumps({k:v for k,v in report.items() if k not in ['reviewSignals','usage']},ensure_ascii=False))


if __name__ == '__main__':
    main()
