"""Post-inference home core identity diagnostics and actual API budgets."""
import argparse
import itertools
import json
from pathlib import Path


def diagnostics(rows,labels):
    predictions={r['observationId']:r['placeId'] for r in rows}
    ids=[oid for oid,label in labels.items() if label is not None]
    available=[oid for oid in ids if oid in predictions]
    false_merge=false_split=same=different=0
    for a,b in itertools.combinations(available,2):
        if labels[a]==labels[b]:
            same+=1
            if predictions[a] is not None and predictions[b] is not None and predictions[a]!=predictions[b]:false_split+=1
        else:
            different+=1
            if predictions[a] is not None and predictions[a]==predictions[b]:false_merge+=1
    return {'coreTargets':len(ids),'processedCore':len(available),'unprocessedCore':len(ids)-len(available),'unknownCore':sum(predictions[oid] is None for oid in available),'sameRegionPairs':same,'differentRegionPairs':different,'falseSplitPairs':false_split,'falseMergePairs':false_merge,'interpretation':'Against existing home open-living core contract only; boundary/unreviewed excluded explicitly. Pair counts are dependent, not independent accuracy samples.'}


def budget(work,max_blocks=None):
    rows=[]
    for block in sorted(work.glob('block-*')):
        if max_blocks is not None and int(block.name.split('-')[1])>=max_blocks:continue
        for path in block.glob('response-*.json'):rows.append(json.loads(path.read_text(encoding='utf8')))
    usage=[r.get('usage') or {} for r in rows]
    return {'responses':len(rows),'promptTokens':sum(r.get('prompt_tokens',0) for r in usage),'completionTokens':sum(r.get('completion_tokens',0) for r in usage),'totalTokens':sum(r.get('total_tokens',0) for r in usage),'reasoningTokens':sum((r.get('completion_tokens_details') or {}).get('reasoning_tokens',0) or 0 for r in usage),'thinkingReturned':any(bool(r['choices'][0]['message'].get('reasoning_content')) for r in rows),'usagePresent':all(bool(u) for u in usage)}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('new',type=Path);args=parser.parse_args()
    old=Path('run/home-window-vlm-1791967361392572500')
    output={'old':str(old),'new':str(args.new),'homes':{},'note':'Only thinking flag changes; sequential new histories can diverge. Single cross-batch run, not repeated causal latency estimate. Old val5 incomplete; full budget ratio not a fair same-coverage comparison.'}
    for home,contract in [('val4','fixed-region-queries-open-living-val4-v1.json'),('val5','fixed-region-queries-val5-v1.json')]:
        labels=json.loads((Path('docs/experiments')/contract).read_text(encoding='utf8'))['labels']
        versions={}
        for name,root in [('thinking-default',old),('nonthinking',args.new)]:
            summary=json.loads((root/'summary.json').read_text(encoding='utf8'))['cases'][home+'-mechanical-10s']
            versions[name]={'status':summary['status'],'processed':len(summary['results']),'original':summary['originalObservations'],'elapsedMsIncludingFailures':summary['elapsedMs'],'budget':budget(root/home/'mechanical-10s'),'identityDiagnostics':diagnostics(summary['results'],labels),'assignments':{r['observationId']:r['placeId'] for r in summary['results']}}
        old_ids=set(versions['thinking-default']['assignments']);new_rows=json.loads((args.new/'summary.json').read_text(encoding='utf8'))['cases'][home+'-mechanical-10s']['results']
        versions['nonthinking']['commonPrefixDiagnostics']=diagnostics([r for r in new_rows if r['observationId'] in old_ids],{oid:label for oid,label in labels.items() if oid in old_ids})
        completed_blocks=len(list((old/home/'mechanical-10s').glob('block-*/answer.json')))
        versions['commonCompletedBlocks']=completed_blocks
        versions['commonPrefixBudget']={'thinking-default':budget(old/home/'mechanical-10s',completed_blocks),'nonthinking':budget(args.new/home/'mechanical-10s',completed_blocks)}
        output['homes'][home]=versions
    (args.new/'thinking-comparison.json').write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(output,ensure_ascii=True,indent=2))


if __name__=='__main__':main()
