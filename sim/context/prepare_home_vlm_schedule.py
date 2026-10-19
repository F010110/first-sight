"""Causal 10s scheduling ablation. Group membership comes from arrived prefixes only."""
import json
from pathlib import Path


def schedule(windows,snapshots,grouped):
    ticks=list(range(10000,windows[-1]['endTick']*1000+1,10000))
    requests=[];last_group=None;last_call=None
    for at in ticks:
        arrived=[(i,w) for i,w in enumerate(windows) if w['endTick']*1000<=at]
        if not arrived:continue
        index,w=arrived[-1];oid=f'observation-{index+1}'
        prefix=max((s for s in snapshots if s['atMs']<=at),key=lambda s:s['atMs'])
        group=prefix['assignments'][oid]
        if grouped and group==last_group and last_call is not None and at-last_call<20000:continue
        selected=[oid]
        if grouped:
            members=[f'observation-{i+1}' for i,_ in arrived if prefix['assignments'].get(f'observation-{i+1}')==group]
            selected=list(dict.fromkeys([members[0],oid]))
        requests.append({'id':oid,'atMs':w['endTick']*1000,'scheduledAtMs':at,'selectedIds':selected,'groupId':group,'status':'pending-vlm'})
        last_group=group;last_call=at
    return requests


def main():
    root=Path('run/home-vlm-scheduling-v1');root.mkdir(exist_ok=False)
    for home,capture in [('val4','run/sim/region-val4-multiview'),('val5','run/sim/multiview-val5-clean-20261007')]:
        windows=[json.loads(s) for s in (Path(capture)/'windows.jsonl').read_text().splitlines()]
        snapshots=json.loads((Path('run/frozen-grouping-confirmation')/home/'replay.json').read_text())['online']['snapshots']
        for arm,grouped in [('fixed-10s',False),('group-gated-10s',True)]:
            calls=schedule(windows,snapshots,grouped)
            for call in calls:call['frames']=[str((Path(capture)/'triple'/Path(windows[int(oid.split('-')[1])-1]['frame']).name).resolve()) for oid in call['selectedIds']]
            payload={'home':home,'arm':arm,'intervalMs':10000,'maximumSilenceMs':20000 if grouped else 10000,'originalObservations':len(windows),'calls':calls,'unsubmittedPolicy':'pending, never inherit confirmed identity','note':'Offline causal prefix scheduler; not wall-clock throughput simulation. No terminal flush outside fixed ticks.'}
            (root/f'{home}-{arm}.json').write_text(json.dumps(payload,indent=2),encoding='utf8')
            print(home,arm,'calls',len(calls),'queryImages',sum(len(c['frames']) for c in calls))


if __name__=='__main__':main()
