"""Causal ULVN-only window budget benchmark. No VLM, grouping or map input."""
import argparse
from collections import OrderedDict
import hashlib
import json
from pathlib import Path
import sys
import time
from ulvn_continuity_policy import farthest_representatives


def independent(pairs):
    passed = [p for p in pairs if p['inliers'] >= 60 and p['ratio'] >= .35]
    return any(a['currentDirection'] != b['currentDirection']
               and a['historicalDirection'] != b['historicalDirection']
               and a['currentSHA256'] != b['currentSHA256']
               and a['historicalSHA256'] != b['historicalSHA256']
               for i, a in enumerate(passed) for b in passed[i+1:])


def main():
    process_started=time.perf_counter()
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--candidates', type=int, choices=[5, 20], required=True)
    parser.add_argument('--pilot', action='store_true')
    parser.add_argument('--keypoints', type=int, choices=[512,1024], default=1024)
    parser.add_argument('--continuity', action='store_true')
    parser.add_argument('--local-domains', action='store_true')
    parser.add_argument('--observations',type=int,default=813)
    parser.add_argument('--history-catalog',type=Path)
    parser.add_argument('--max-seconds',type=int,default=None)
    args = parser.parse_args()
    if not 1<=args.observations<=813:
        parser.error('--observations must be 1..813')
    if args.max_seconds is not None and not 1<=args.max_seconds<=2400:
        parser.error('--max-seconds must be 1..2400')
    if args.local_domains:
        args.continuity=True
    root = Path(__file__).resolve().parents[2]
    out = args.output
    out.mkdir(parents=True, exist_ok=False)
    source = root / 'run/gmod-annotated-rerender-v2-final/public-source.json'
    rows = json.loads(source.read_text(encoding='utf-8'))['observations']
    config = {'candidateObservations': args.candidates, 'windowObservations': 20,
              'windowBudgetSeconds': 40, 'recentExclusionObservations': 30,
              'minInliers': 60, 'minRatio': .35, 'gpuFeatureCacheImages': 512,
              'maxKeypoints': args.keypoints,
              'maxRunSeconds': 2400 if not args.pilot else 600,
              'pilot': args.pilot}
    config['plannedObservations']=700 if args.pilot else args.observations
    if args.max_seconds is not None:
        config['maxRunSeconds']=args.max_seconds
    if args.continuity:
        config.update(representativesPerPlace=8, maxInvestigationsPerPlacePerWindow=3,
                      mode='farthest-representatives-window-shared-investigation')
    if args.local_domains:
        config.update(mode='bounded-representative-domain-refinement',domainRadiusObservations=4,
                      maxDomainsPerQuery=3,maxLocalCandidatesPerDomain=3,maxGeometryPairsPerQuery=24,
                      cacheScope='exact-pixel-pairs-only',maxInvestigationsPerPlacePerWindow=None)
    controls = [220, 380, 388, 460, 473, 595, 660, 680, 698]
    plan = {'configuration': config, 'sourceSHA256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'scriptSHA256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'method': 'ULVN MegaLoc/SuperPoint/LightGlue adaptation; not full upstream BPL.',
            'scope': 'No VLM, place-ID mapping or map truth. Only historical observation correspondence.',
            'optimizations': ['Encode/hash each incoming image once; durable raw files remain untouched.',
                              'Keep historical descriptors in an incremental matrix, vectorized ranking.',
                              'Keep bounded local features on device rather than CPU-to-GPU copies per pair.',
                              'Stop a candidate immediately after two independent passing camera correspondences; same acceptance predicate as all 9 pairs.'],
            'tradeoff': '5 vs 20 candidates is a separate recall-budget arm, not a semantics-preserving optimization.',
            'pilotQueries': controls if args.pilot else None,
            'pilotFullWindow': [381,400] if args.pilot else None,
            'timing': 'Sum cold/current encoding, retrieval and verification for each 20-observation window; no VLM. Initialization separately, first-window total also includes it. Not a live delivery test.'}
    (out / 'plan.json').write_text(json.dumps(plan, indent=2), encoding='utf-8')
    sys.path.insert(0, str(root / 'scripts/media'))
    from ulvn_match import Matcher
    import numpy as np
    from lightglue.utils import load_image
    started = time.perf_counter()
    matcher = Matcher('auto')
    if args.keypoints != 1024:
        from lightglue import SuperPoint
        matcher.extractor = SuperPoint(max_num_keypoints=args.keypoints).eval().to(matcher.device)
    load_seconds = time.perf_counter() - started
    device_cache = OrderedDict()
    counters = {'geometryPairs': 0, 'featureExtractions': 0, 'featureHits': 0}

    def local(image):
        key = image['_key']
        if key not in device_cache:
            with matcher.torch.inference_mode():
                value = matcher.extractor.extract(load_image(image['path']).to(matcher.device), resize=640)
            device_cache[key] = value
            counters['featureExtractions'] += 1
            while len(device_cache) > config['gpuFeatureCacheImages']:
                device_cache.popitem(last=False)
        else:
            counters['featureHits'] += 1
        device_cache.move_to_end(key)
        return device_cache[key]

    matcher.local = local
    # Frozen OLD production history, not map truth. Only already committed prior
    # window records may populate the index. No current-window VLM result enters.
    catalog = []
    if args.continuity:
        snapshot = args.history_catalog or root / 'run/vlm-ulvn-direct-813-v1/interrupted-review/states.json'
        catalog = json.loads(snapshot.read_text(encoding='utf-8'))
        plan.update(historyCatalog=str(snapshot), historyCatalogSHA256=hashlib.sha256(snapshot.read_bytes()).hexdigest(),
                    historyScope='Frozen prior production place IDs only; available as an index at source-prefix boundaries, not independently rebuilt places. No map labels. Control queries beyond committed prefix use only that prefix.')
        (out/'plan.json').write_text(json.dumps(plan,indent=2),encoding='utf-8')
    images, vectors, observations, windows, answers = [], [], [], [], []
    with (out / 'queries.jsonl').open('x', encoding='utf-8') as query_stream, (out / 'windows.jsonl').open('x', encoding='utf-8') as window_stream:
        last = 700 if args.pilot else min(args.observations,len(rows))
        for start in range(0, last, 20):
            if time.perf_counter() - process_started > config['maxRunSeconds']:
                raise TimeoutError('Finite benchmark budget exceeded; partial windows retained')
            tick = time.perf_counter()
            batch = rows[start:min(start+20,last)]
            batch_images = [dict(view, id=row['id']) for row in batch for view in row['views']]
            before = dict(counters)
            encoded = matcher.encode(batch_images)
            encode_seconds = time.perf_counter() - tick
            # Only prior windows enter retrieval; camera encoding itself is independent.
            history_vectors = np.stack(vectors) if vectors else None
            memberships, reps = {}, None
            attempts, verified, unresolved = {}, {}, set()
            pair_memo={};budget_exhausted_queries=0;local_probes=0;pair_memo_hits=0
            if args.continuity:
                for state in catalog:
                    members = state.get('window',{}).get('observations',[])
                    # A whole published batch is available only after its tail.
                    cutoff = state.get('window',{}).get('batch',{}).get('knowledgeCutoffMs',state['atMs'])
                    source_prefix_ms = (start-1)*2000
                    if cutoff > source_prefix_ms or not state['assessment']['location']['placeId']:
                        continue
                    for member in members:
                        index = int(member['id'][-6:])-1
                        if index < start:
                            memberships[index] = state['assessment']['location']['placeId']
                grouped = {}
                for index, place in sorted(memberships.items()):
                    grouped.setdefault(place,[]).append(index)
                def distance(a,b):
                    x,y=history_vectors[a*3:a*3+3],history_vectors[b*3:b*3+3]
                    # Each view must have a corresponding appearance; cross directions allowed.
                    sims=x@y.T
                    return 1.-float((sims.max(axis=0).mean()+sims.max(axis=1).mean())/2)
                reps = sorted(i for members in grouped.values() for i in farthest_representatives(members,8,distance))
            retrieval_seconds, geometry_seconds = 0., 0.
            for offset, row in enumerate(batch):
                ordinal = start + offset + 1
                if args.pilot and ordinal not in controls and not 381 <= ordinal <= 400:
                    continue
                current_images = batch_images[offset*3:offset*3+3]
                current_vectors = encoded[offset*3:offset*3+3]
                eligible_count = min(len(observations), max(0, ordinal - 31))
                rt = time.perf_counter()
                if eligible_count:
                    scores = (current_vectors @ history_vectors[:eligible_count*3].T).reshape(3,eligible_count,3).max(axis=(0,2))
                    ordered = np.argsort(-scores,kind='stable')
                    if args.continuity:
                        allowed=set(reps)
                        ordered=[i for i in ordered if int(i) in allowed]
                    selected = ordered[:args.candidates]
                else:
                    selected = []
                retrieval_seconds += time.perf_counter() - rt
                gt = time.perf_counter()
                candidates = []
                continued = []
                investigated_now = set()
                local_result=None
                if args.local_domains:
                    from ulvn_local_domains import investigate
                    local_result=investigate(matcher,current_images,current_vectors,images,history_vectors,
                                             memberships,selected,eligible_count,pair_memo,
                                             deadline=process_started+config['maxRunSeconds'])
                    counters['geometryPairs']+=local_result['geometryPairs']
                    candidates=local_result['candidates']
                    local_probes+=sum(c['channel']=='representative-probe' for c in candidates)
                    pair_memo_hits+=local_result['pairMemoHits']
                    budget_exhausted_queries+=int(local_result['budgetExhausted'])
                    selected=[]
                for index in selected:
                    index = int(index)
                    place = memberships.get(index)
                    if args.continuity:
                        if place in verified:
                            continued.append({'placeId':place,'historicalOrdinal':verified[place],
                                              'status':'previously-supported-in-this-window-not-freshly-verified'})
                            continue
                        if place in investigated_now:
                            continue
                        if attempts.get(place,0)>=3:
                            unresolved.add(place)
                            continue
                        attempts[place]=attempts.get(place,0)+1
                        investigated_now.add(place)
                    historical = images[index*3:index*3+3]
                    similarity = current_vectors @ history_vectors[index*3:index*3+3].T
                    order = sorted(((float(similarity[i,j]),i,j) for i in range(3) for j in range(3)), reverse=True)
                    checks = []
                    for score,i,j in order:
                        result = matcher.verify(current_images[i],historical[j])
                        counters['geometryPairs'] += 1
                        checks.append({**result,'currentDirection':current_images[i]['direction'],
                                       'historicalDirection':historical[j]['direction'],
                                       'currentSHA256':current_images[i]['sha256'],
                                       'historicalSHA256':historical[j]['sha256'],'similarity':score})
                        if independent(checks):
                            break
                    candidates.append({'historicalOrdinal': index+1, 'supported':independent(checks), 'pairs':checks})
                    if args.continuity and independent(checks):
                        verified[place]=index+1
                geometry_seconds += time.perf_counter() - gt
                answer = {'ordinal':ordinal,'eligibleObservations':eligible_count,'candidates':candidates,
                          'accepted':[c['historicalOrdinal'] for c in candidates if c['supported']]}
                if args.continuity:
                    answer.update(continuityCandidates=continued,unresolvedPlaceIds=sorted(unresolved),
                                   note='Only accepted contains fresh geometric support. Continuity candidates are cached hypotheses, not new confirmed revisits.')
                if args.local_domains:
                    answer.update(localDomains=local_result['domains'],budgetExhausted=local_result['budgetExhausted'],
                                  pairMemoHits=local_result['pairMemoHits'],
                                  note='Fresh matches are observation-pair evidence only. Finite source domains are not entire-place identity or inferred metric coverage. Budget exhaustion is unresolved, never a negative identity verdict.')
                answers.append(answer)
                query_stream.write(json.dumps(answer)+'\n');query_stream.flush()
            # Append after the whole window, never expose later evidence to older queries.
            images.extend(batch_images);vectors.extend(encoded);observations.extend(batch)
            elapsed = time.perf_counter() - tick
            full_window = not args.pilot or start == 380
            record = {'firstOrdinal':start+1,'lastOrdinal':start+len(batch),'fullWindowQueried':full_window,
                      'encodeSeconds':encode_seconds,'retrievalSeconds':retrieval_seconds,'geometrySeconds':geometry_seconds,
                      'totalSeconds':elapsed,'coldTotalSeconds':elapsed+(load_seconds if start==0 else 0),
                      'within40Seconds':elapsed<=40 if full_window else None,
                      **{k:counters[k]-before[k] for k in counters}}
            if args.continuity:
                record.update(indexedPlaces=len(set(memberships.values())),representativeObservations=len(reps),
                              investigations=sum(attempts.values()),unresolvedPlaceCount=len(unresolved))
            if args.local_domains:
                record.update(investigations=local_probes,budgetExhaustedQueries=budget_exhausted_queries,pairMemoHits=pair_memo_hits)
            windows.append(record);window_stream.write(json.dumps(record)+'\n');window_stream.flush()
            if full_window or args.pilot and start+20 in [220,380,460,480,600,660,680,700]:
                print(json.dumps(record),flush=True)
    full = [w for w in windows if w['fullWindowQueried']]
    report = {'completed':True,'observationsEncoded':len(observations),'observationsQueried':len(answers),
              'loadSeconds':load_seconds,'totalSeconds':time.perf_counter()-started,'configuration':config,
              'endToEndSeconds':time.perf_counter()-process_started,
              'within30Minutes':time.perf_counter()-process_started<=1800,
              'windowCount':len(full),'windowsOver40Seconds':sum(w['totalSeconds']>40 for w in full),
              'maxWindowSeconds':max(w['totalSeconds'] for w in full),
              'p95WindowSeconds':float(np.percentile([w['totalSeconds'] for w in full],95)),
              'controls':[{'ordinal':r['ordinal'],'accepted':r['accepted'],**({'continuityCandidates':r['continuityCandidates'],'unresolvedPlaceIds':r['unresolvedPlaceIds']} if args.continuity else {})} for r in answers if r['ordinal'] in controls],
              'budgetExhaustedQueries':sum(bool(r.get('budgetExhausted')) for r in answers),
              'budgetExhaustedWithoutFreshMatch':sum(bool(r.get('budgetExhausted')) and not r['accepted'] for r in answers),
              'freshMatchQueries':sum(bool(r['accepted']) for r in answers),
              'counters':counters,'peakCudaAllocatedBytes':matcher.torch.cuda.max_memory_allocated() if matcher.device=='cuda' else None,
              'limitations':['Image correspondence support is not occupied-place identity.','Pilot controls are development cases; no ground truth enters inference.','GPU-only latency does not certify full-system realtime.']}
    (out/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report),flush=True)


if __name__=='__main__':
    main()
