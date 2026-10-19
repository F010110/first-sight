"""Image-only native-frame cohorts; preserve sparse query inventory/timestamps.

Positive old/new two-frame cohorts plus four explicit bidirectional departures.
No simulator pose/labels; low texture, gaps and missing images never create cuts.
"""
import argparse
import importlib.util
import json
import time
from pathlib import Path
import cv2


def second(values):
    return sorted(values,reverse=True)[1] if len(values)>1 else 0


def propose_contexts(ticks,tick_ms,confidence,policy='updating-context-v2'):
    if policy=='multi-context-v1':
        from sim.context.multi_context_evidence import propose_multi_contexts
        return propose_multi_contexts(ticks,tick_ms,confidence)
    if policy in ['legacy-first-pair','recover-weak-anchors','unconditional-first-pair']:
        events=[];start=0
        for i in range(1,len(ticks)):
            if ticks[i]!=ticks[i-1]+1 or tick_ms>4000:start=i;continue
            if i<start+3:continue
            anchor=start
            if policy=='recover-weak-anchors':
                while anchor<=i-3 and (confidence(anchor,anchor+1) or 0)<.4:anchor+=1
                if anchor>i-3:continue
            old=confidence(anchor,anchor+1);new=confidence(i-1,i)
            if new is None or new<.4:continue
            if policy!='unconditional-first-pair' and (old is None or old<.4):continue
            cross=[confidence(a,b) for a in [anchor,anchor+1] for b in [i-1,i]]
            if any(v is None or v>.1 for v in cross):continue
            events.append({'beforeTick':ticks[i-1],'confirmedTick':ticks[i],'oldTicks':[ticks[anchor],ticks[anchor+1]],'newTicks':[ticks[i-1],ticks[i]],'oldSupport':old,'newSupport':new,'crossSupport':cross});start=i-1
        return events,[]
    anchor=None; events=[]; diagnostics=[]
    for i in range(1,len(ticks)):
        if ticks[i]!=ticks[i-1]+1 or tick_ms>4000:
            anchor=None; continue
        recent=i-1; support=confidence(recent,i)
        if support is None or support<.4: continue
        if anchor is None:
            anchor=recent; diagnostics.append({'atTick':ticks[i],'kind':'positive-anchor-acquired'}); continue
        if anchor+1>=recent:
            agreement=confidence(anchor,i)
            if agreement is not None and agreement>=.4: anchor=recent
            continue
        cross=[confidence(a,b) for a in [anchor,anchor+1] for b in [recent,i]]
        if all(value is not None and value>.1 for value in cross) and max(cross[0],cross[2])>=.4 and max(cross[1],cross[3])>=.4:
            anchor=recent; continue
        if any(value is None or value>.1 for value in cross): continue
        events.append({'beforeTick':ticks[recent],'confirmedTick':ticks[i],'oldTicks':[ticks[anchor],ticks[anchor+1]],'newTicks':[ticks[recent],ticks[i]],'oldSupport':confidence(anchor,anchor+1),'newSupport':support,'crossSupport':cross})
        anchor=recent
    return events,diagnostics


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('dataset',type=Path); parser.add_argument('output',type=Path)
    parser.add_argument('--tick-ms',type=int,required=True)
    parser.add_argument('--all-policies',action='store_true')
    parser.add_argument('--policy',choices=['updating-context-v2','multi-context-v1'],default='updating-context-v2')
    args=parser.parse_args()
    if args.tick_ms<=0: raise ValueError('Invalid original capture cadence')
    if not 500<=args.tick_ms<=1000: raise ValueError('Detection requires original 1–2 fps frames; do not invent or silently oversample frames')
    spec=importlib.util.spec_from_file_location('image_match',Path(__file__).resolve().parents[2]/'scripts/image_match.py')
    matcher=importlib.util.module_from_spec(spec); spec.loader.exec_module(matcher)
    cv2.setNumThreads(1); cv2.setRNGSeed(0); detector,norm=matcher.make_detector('sift')
    paths=sorted((args.dataset/'frames').glob('*.jpg')); features=[]; ticks=[]
    for path in paths:
        ticks.append(int(path.stem)); views=[]
        for directory in ['frames','left','right']:
            kp,desc,image=matcher.features(str(args.dataset/directory/path.name),detector,640)
            if image is None: raise ValueError('Missing original triple')
            views.append((kp,desc))
        features.append(views)
    cache={}; started=time.perf_counter()
    def confidence(a,b):
        key=tuple(sorted((a,b)))
        if key not in cache:
            forward=[[matcher.match(x,y,norm,.75)['inliers'] for y in features[b]] for x in features[a]]
            backward=[[matcher.match(y,x,norm,.75)['inliers'] for x in features[a]] for y in features[b]]
            cache[key]=min(second([min(max(row)/60,1) for row in forward]),second([min(max(row)/60,1) for row in backward]))
        return cache[key]
    events,diagnostics=propose_contexts(ticks,args.tick_ms,confidence,args.policy)
    variants={}
    if args.all_policies:
        for policy in ['legacy-first-pair','recover-weak-anchors','unconditional-first-pair','updating-context-v2']:
            e,d=propose_contexts(ticks,args.tick_ms,confidence,policy)
            variants[policy]={'protocol':'dense-coherent-context-evidence-v1','algorithm':policy,'tickMs':args.tick_ms,'events':e,'diagnostics':d}
    result={'protocol':'dense-coherent-context-evidence-v1','algorithm':'updating-context-v2','detectionFps':1000/args.tick_ms,'tickMs':args.tick_ms,'events':events,'diagnostics':diagnostics,'pairComparisons':len(cache),'elapsedMs':(time.perf_counter()-started)*1000,'scope':'Revisable visual context proposals only, not physical crossings. Original raw native frames, no poses/labels, full query directions, thresholds .4/.1 unchanged.'}
    result['variants']=variants
    result['algorithm']=args.policy
    result['pairEvidenceCache']=[{'aTick':ticks[a],'bTick':ticks[b],'confidence':value} for (a,b),value in cache.items()]
    with args.output.open('x',encoding='utf8') as file: json.dump(result,file,indent=2)
    print(json.dumps({'nativeFrames':len(paths),'events':len(events),'pairComparisons':len(cache)}))


if __name__=='__main__':main()
