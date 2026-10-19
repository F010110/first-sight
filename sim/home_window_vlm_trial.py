"""Bounded causal home windows, multiple place identities allowed within each block."""
import argparse
import base64
import json
import os
import time
from pathlib import Path

PROMPT='''根据已到达的室内三视图建立具体物理区域身份。每图左/前/右是一个位置。标注观察者所在区域，不是隔门可见区域。开放连通客餐厨不按功能拆分；共享家具不证明同一房间。当前时间块只是证据组织，块内可以跨多个区域，必须逐观察判断。不推测未来。历史地点目录是候选不是标准答案。保留历史ID；新区域使用未用过的R数字ID。证据不足unknown。仅输出JSON：{"places":[{"id":"R1","summary":"可见布局与实例"}],"assignments":[{"observationId":"observation-1","placeId":"R1或null","reason":"所在侧/墙体/实例证据"}]}。places只列本次确实用到的区域，每个当前观察恰好一次。不要自动把整个块归同一区域。'''


def blocks(windows,snapshots,visual=False):
    result=[];pending=[];start=None;last_group=None;last_cut=None
    for i,w in enumerate(windows):
        at=w['endTick']*1000;oid=f'observation-{i+1}'
        prefix=max((s for s in snapshots if s['atMs']<=at),key=lambda s:s['atMs'])
        group=prefix['assignments'][oid]
        if start is None:start=at
        changed=visual and last_group is not None and group!=last_group
        if pending and (at-start>=10000 or (changed and (last_cut is None or at-last_cut>=5000))):
            result.append({'ids':pending,'closedAtMs':at,'trigger':'visual' if changed and at-start<10000 else 'time-limit'})
            last_cut=at;pending=[];start=at
        pending.append(oid);last_group=group
    if pending:result.append({'ids':pending,'closedAtMs':windows[-1]['endTick']*1000,'trigger':'end-of-recording'})
    return result


def validate(answer,ids,catalog):
    places=answer['places'];rows=answer['assignments']
    if len(rows)!=len(ids) or {r['observationId'] for r in rows}!=set(ids):raise ValueError('Each current observation exactly once')
    pids=[p['id'] for p in places]
    if len(pids)!=len(set(pids)) or any(not isinstance(p['summary'],str) or not p['summary'].strip() for p in places):raise ValueError('Unique place IDs and nonempty summaries required')
    import re
    if any(not re.fullmatch(r'R[1-9][0-9]*',pid) for pid in pids):raise ValueError('Place IDs must be R followed by positive integer')
    if any((r['placeId'] is not None and r['placeId'] not in pids) or not isinstance(r['reason'],str) or not r['reason'].strip() for r in rows):raise ValueError('Each identity needs declared place and reason')


def remember_reference(representatives,pid,oid):
    # Updating an existing dict value does not change insertion order.
    # Explicitly move revisited identities to the recent end.
    representatives.pop(pid,None)
    representatives[pid]=oid


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--prepare-only',action='store_true');parser.add_argument('--no-thinking',action='store_true');parser.add_argument('--mechanical-only',action='store_true');parser.add_argument('--home',choices=['val4','val5']);args=parser.parse_args()
    root=Path(f'run/home-window-vlm-{time.time_ns()}');root.mkdir();print(root,flush=True)
    summary={'status':'running','cases':{},'prompt':PROMPT,'model':'qwen3.8-flash','enableThinking':False if args.no_thinking else 'provider-default','scope':'Observation-time causal blocks; sequential processing, not busy-aware realtime simulation. All original observations scored; terminal flush explicitly distinct.'}
    def save():(root/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
    for home,capture in [('val4',Path('run/sim/region-val4-multiview')),('val5',Path('run/sim/multiview-val5-clean-20261007'))]:
        if args.home and home!=args.home:continue
        windows=[json.loads(s) for s in (capture/'windows.jsonl').read_text().splitlines()]
        snapshots=json.loads((Path('run/frozen-grouping-confirmation')/home/'replay.json').read_text(encoding='utf8'))['online']['snapshots']
        for arm in (['mechanical-10s'] if args.mechanical_only else ['mechanical-10s','visual-capped-10s']):
            work=root/home/arm;work.mkdir(parents=True);plan=blocks(windows,snapshots,arm.startswith('visual'))
            row={'status':'prepared','originalObservations':len(windows),'blocks':plan,'results':[],'requests':0,'promptTokens':0,'completionTokens':0,'totalTokens':0,'elapsedMs':0};summary['cases'][home+'-'+arm]=row;save()
            if args.prepare_only:continue
            from openai import OpenAI
            client=OpenAI(api_key=os.environ['QWEN_API_KEY'],base_url=os.environ['QWEN_BASE_URL'],timeout=120,max_retries=0)
            catalog={};representatives={};row['status']='running'
            def image(oid):
                w=windows[int(oid.split('-')[1])-1];path=capture/'triple'/Path(w['frame']).name
                return {'type':'image_url','image_url':{'url':'data:image/jpeg;base64,'+base64.b64encode(path.read_bytes()).decode('ascii')}}
            for index,block in enumerate(plan):
                request=work/f'block-{index:03d}';request.mkdir();content=[{'type':'text','text':PROMPT+'\nHISTORY_CATALOG '+json.dumps(catalog,ensure_ascii=False)}]
                # At most three recent identities, one image each; summaries never overwritten by current guess.
                for pid,oid in list(representatives.items())[-3:]:content.extend([{'type':'text','text':f'HISTORICAL_REFERENCE {pid} {oid}'},image(oid)])
                for oid in block['ids']:content.extend([{'type':'text','text':f'CURRENT_TARGET {oid} atMs={windows[int(oid.split("-")[1])-1]["endTick"]*1000}'},image(oid)])
                (request/'input.json').write_text(json.dumps({'block':block,'catalog':catalog,'representatives':representatives,'prompt':PROMPT,'enableThinking':False if args.no_thinking else 'provider-default','referencePolicy':'last-visited-three'},ensure_ascii=False,indent=2),encoding='utf8')
                messages=[{'role':'user','content':content}];started=time.perf_counter()
                try:
                    for attempt in range(2):
                        row['requests']+=1
                        options={'extra_body':{'enable_thinking':False}} if args.no_thinking else {}
                        response=client.chat.completions.create(model='qwen3.8-flash',messages=messages,temperature=0,max_tokens=1800,**options)
                        (request/f'response-{attempt}.json').write_text(response.model_dump_json(indent=2),encoding='utf8')
                        usage=response.usage
                        if usage:
                            row['promptTokens']+=usage.prompt_tokens;row['completionTokens']+=usage.completion_tokens;row['totalTokens']+=usage.total_tokens
                        text=response.choices[0].message.content or ''
                        try:
                            import re
                            answer=json.loads(re.sub(r'^```(?:json)?\s*|\s*```$','',text.strip()));validate(answer,block['ids'],catalog);break
                        except (ValueError,KeyError,TypeError) as error:
                            if attempt==1:raise
                            messages.extend([{'role':'assistant','content':text},{'role':'user','content':f'修正协议错误：{error}。不增加证据，返回完整JSON。'}])
                    for place in answer['places']:catalog.setdefault(place['id'],place['summary'])
                    for assignment in answer['assignments']:
                        if assignment['placeId']:remember_reference(representatives,assignment['placeId'],assignment['observationId'])
                    row['results'].extend(answer['assignments'])
                    (request/'answer.json').write_text(json.dumps(answer,ensure_ascii=False,indent=2),encoding='utf8')
                except Exception as error:
                    row['status']='failed';row['failureType']=type(error).__name__
                    (request/'execution-failure.json').write_text(json.dumps({'exceptionType':type(error).__name__,'block':index,'hasValidAnswer':False}),encoding='utf8')
                    break
                finally:row['elapsedMs']+=(time.perf_counter()-started)*1000;save()
            if row['status']=='running':row['status']='finished'
            row['catalog']=catalog;save();print(json.dumps({'case':home+'-'+arm,'status':row['status'],'assigned':len(row['results']),'planned':len(windows),'requests':row['requests'],'tokens':row['totalTokens']}),flush=True)
    summary['status']='prepared' if args.prepare_only else 'finished';save()


if __name__=='__main__':main()
