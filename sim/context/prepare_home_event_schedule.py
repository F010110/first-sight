"""Event-driven causal prefix scheduling, no labels or final grouping used."""
import json
from pathlib import Path


def events(windows,snapshots,min_ms=5000,max_ms=30000):
    calls=[];last_call=None;confirmed=None;candidate=None;count=0;pending=[]
    for index,w in enumerate(windows):
        oid=f'observation-{index+1}';at=w['endTick']*1000
        prefix=max((s for s in snapshots if s['atMs']<=at),key=lambda s:s['atMs'])
        group=prefix['assignments'][oid]
        pending.append((oid,group))
        if group==candidate:count+=1
        else:candidate=group;count=1
        reason='first' if last_call is None else ('group-change' if group!=confirmed and count>=2 else ('maximum-silence' if at-last_call>=max_ms else None))
        if reason is None or (last_call is not None and at-last_call<min_ms):continue
        # Retain each pending episode's first/latest, rather than only the latest view.
        episodes=[]
        for item in pending:
            if not episodes or episodes[-1][-1][1]!=item[1]:episodes.append([])
            episodes[-1].append(item)
        selected=list(dict.fromkeys(oid for episode in episodes for oid,_ in [episode[0],episode[-1]]))
        calls.append({'id':oid,'atMs':at,'scheduledAtMs':at,'selectedIds':selected,'groupId':group,'trigger':reason,'pendingObservationIds':[x[0] for x in pending]})
        last_call=at;confirmed=group;pending=[]
    return calls,[oid for oid,_ in pending]


def main():
    root=Path('run/home-vlm-event-v1');root.mkdir(exist_ok=False)
    from sim.context.prepare_home_vlm_schedule import schedule
    for home,capture in [('val4','run/sim/region-val4-multiview'),('val5','run/sim/multiview-val5-clean-20261007')]:
        windows=[json.loads(s) for s in (Path(capture)/'windows.jsonl').read_text().splitlines()]
        snapshots=json.loads((Path('run/frozen-grouping-confirmation')/home/'replay.json').read_text())['online']['snapshots']
        for arm in ['fixed-10s','event']:
            if arm=='event':calls,pending=events(windows,snapshots)
            else:
                calls=schedule(windows,snapshots,False)
                submitted={c['id'] for c in calls}
                pending=[f'observation-{i+1}' for i in range(len(windows)) if f'observation-{i+1}' not in submitted]
            for call in calls:
                call['frames']=[str((Path(capture)/'triple'/Path(windows[int(oid.split('-')[1])-1]['frame']).name).resolve()) for oid in call['selectedIds']]
                call['evidence']=[{'id':oid,'atMs':windows[int(oid.split('-')[1])-1]['endTick']*1000,'path':frame} for oid,frame in zip(call['selectedIds'],call['frames'])]
            payload={'home':home,'arm':arm,'originalObservations':len(windows),'minimumIntervalMs':5000,'maximumSilenceMs':30000,'calls':calls,'terminalPendingIds':pending,'note':'Causal observation-time schedule, NOT busy-aware real-time throughput. Group episodes are evidence organization, not physical identity. Unsubmitted observations remain pending.'}
            (root/f'{home}-{arm}.json').write_text(json.dumps(payload,indent=2),encoding='utf8')
            print(home,arm,'calls',len(calls),'queryImages',sum(len(c['frames']) for c in calls),'terminalPending',len(pending))


if __name__=='__main__':main()
