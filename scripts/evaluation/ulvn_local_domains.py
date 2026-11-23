"""Bounded representative discovery -> local evidence refinement. No VLM vote."""
from ulvn_continuity_policy import bounded_domain
import time


def independent(pairs):
    passed=[p for p in pairs if p['inliers']>=60 and p['ratio']>=.35]
    return any(a['currentDirection']!=b['currentDirection'] and a['historicalDirection']!=b['historicalDirection']
               and a['currentSHA256']!=b['currentSHA256'] and a['historicalSHA256']!=b['historicalSHA256']
               for i,a in enumerate(passed) for b in passed[i+1:])


def investigate(matcher,current_images,current_vectors,history_images,history_vectors,
                memberships,selected,eligible_count,memo,pair_budget=24,deadline=None):
    results=[];calls=0;memo_hits=0;remaining=pair_budget;examined=set();domains=[];exhausted=False
    def check(index,limit,channel,representative):
        nonlocal calls,memo_hits,remaining,exhausted
        historical=history_images[index*3:index*3+3]
        similarity=current_vectors@history_vectors[index*3:index*3+3].T
        order=sorted(((float(similarity[i,j]),i,j) for i in range(3) for j in range(3)),reverse=True)
        checks=[]
        for score,i,j in order[:limit]:
            if deadline is not None and time.perf_counter()>deadline:
                raise TimeoutError('ULVN total wall-clock budget exceeded; partial windows retained')
            key=(current_images[i]['sha256'],historical[j]['sha256'])
            if key in memo:
                outcome=memo[key];memo_hits+=1
            else:
                if remaining<=0:
                    exhausted=True;break
                outcome=matcher.verify(current_images[i],historical[j]);memo[key]=outcome
                remaining-=1;calls+=1
            checks.append({**outcome,'currentDirection':current_images[i]['direction'],
                           'historicalDirection':historical[j]['direction'],
                           'currentSHA256':current_images[i]['sha256'],'historicalSHA256':historical[j]['sha256'],
                           'similarity':score})
            if independent(checks):break
        result={'historicalOrdinal':index+1,'supported':independent(checks),'pairs':checks,
                'channel':channel,'representativeOrdinal':representative+1}
        results.append(result)
        return result
    # A few representative domains, NOT every historical group. Overlapping
    # domains are allowed; this is not a learned/exclusive spatial partition.
    for item in selected:
        center=int(item)
        domain=[i for i in bounded_domain(center,memberships,4) if i<eligible_count]
        if not domain or any(center in previous for previous in domains):continue
        domains.append(domain)
        if len(domains)>3:break
        probe=check(center,1,'representative-probe',center)
        partial=any(p['inliers']>=60 and p['ratio']>=.35 for p in probe['pairs'])
        if not partial:continue
        # Partial one-camera support merely opens local refinement; it NEVER
        # authenticates identity. Representative itself can be the best source.
        scores={i:float((current_vectors@history_vectors[i*3:i*3+3].T).max()) for i in domain}
        ranked=sorted(domain,key=lambda i:(-scores[i],i))
        for index in ranked[:3]:
            if index in examined:continue
            examined.add(index)
            candidate=check(index,9,'local-refinement',center)
            if candidate['supported']:break
            if remaining<=0:break
        if remaining<=0:break
    return {'candidates':results,'geometryPairs':calls,'pairMemoHits':memo_hits,
            'budgetExhausted':exhausted or remaining<=0,
            'domains':[[i+1 for i in domain] for domain in domains[:3]]}
