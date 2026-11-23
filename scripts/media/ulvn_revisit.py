"""Persistent direct-revisit worker. Same frozen frontend/gate, no VLM."""
import contextlib
import json
import sys
import hashlib
import numpy as np
from ulvn_match import Matcher


def match(matcher, request):
    queries = request['queries']
    old = [{**m, 'placeId': p['placeId']} for p in request['places'] for m in p['members']]
    if len(queries) > 60 or len(old) > 50000:
        raise ValueError('Direct revisit capacity exceeded')
    if not old:
        return {'ok': True, 'results': [], 'best': None, 'nearest': None}
    vectors = matcher.encode(queries + old)
    history = {}
    for index, image in enumerate(old):
        history.setdefault((image['placeId'], image['observationId']), []).append(index)
    current = {}
    for index, image in enumerate(queries):
        current.setdefault(image['id'], []).append(index)
    results = []
    for query_id, indexes in current.items():
        ranked = sorted(history.items(), key=lambda item: -float(np.max(vectors[indexes] @ vectors[[len(queries)+i for i in item[1]]].T)))[:20]
        for (place_id, old_id), historical in ranked:
            for i in indexes:
                for j in historical:
                    q, h = queries[i], old[j]
                    result = matcher.verify(q, h)
                    results.append({'id': place_id, 'path': h['path'], 'queryPath': q['path'],
                                    'queryObservationId': query_id, 'queryDirection': q['direction'],
                                    'historicalDirection': h['direction'],
                                    'querySHA256': q.get('sha256') or hashlib.sha256(open(q['path'], 'rb').read()).hexdigest(),
                                    'historicalSHA256': h.get('sha256') or hashlib.sha256(open(h['path'], 'rb').read()).hexdigest(),
                                    'similarity': float(vectors[i] @ vectors[len(queries)+j]), **result})
    results.sort(key=lambda r: (-r['inliers'], -r['similarity']))
    return {'ok': True, 'results': results, 'best': results[0] if results else None,
            'nearest': max(results, key=lambda r: r['similarity']) if results else None}


def main():
    matcher = None
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            if request.get('op') == 'close':
                break
            if request.get('op') != 'match':
                raise ValueError('Unsupported operation')
            with contextlib.redirect_stdout(sys.stderr):
                matcher = matcher or Matcher('auto')
                response = match(matcher, request)
            print(json.dumps({'id': request['id'], **response}), flush=True)
        except Exception as error:
            print(json.dumps({'id': request.get('id'), 'ok': False, 'results': [], 'error': str(error)}), flush=True)


if __name__ == '__main__':
    main()
