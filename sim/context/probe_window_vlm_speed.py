"""Six fixed historical inputs: disable thinking only; no favorable-repeat selection."""
import base64
import json
import os
import time
from pathlib import Path
from sim.context.home_window_vlm_trial import validate


def main():
    from openai import OpenAI
    source=Path('run/home-window-vlm-1791967361392572500')
    root=Path(f'run/window-vlm-speed-{time.time_ns()}');root.mkdir();print(root,flush=True)
    client=OpenAI(api_key=os.environ['QWEN_API_KEY'],base_url=os.environ['QWEN_BASE_URL'],timeout=120,max_retries=0)
    results=[]
    for home,capture in [('val4',Path('run/sim/region-val4-multiview')),('val5',Path('run/sim/multiview-val5-clean-20261007'))]:
        windows=[json.loads(s) for s in (capture/'windows.jsonl').read_text().splitlines()]
        for block in [0,1,3]:
            prior=source/home/'mechanical-10s'/f'block-{block:03d}'
            original=json.loads((prior/'input.json').read_text(encoding='utf8'))
            work=root/f'{home}-{block:03d}';work.mkdir()
            content=[{'type':'text','text':original['prompt']+'\nHISTORY_CATALOG '+json.dumps(original['catalog'],ensure_ascii=False)}]
            def image(oid):
                path=capture/'triple'/Path(windows[int(oid.split('-')[1])-1]['frame']).name
                return {'type':'image_url','image_url':{'url':'data:image/jpeg;base64,'+base64.b64encode(path.read_bytes()).decode('ascii')}}
            for pid,oid in list(original['representatives'].items())[-3:]:content.extend([{'type':'text','text':f'HISTORICAL_REFERENCE {pid} {oid}'},image(oid)])
            for oid in original['block']['ids']:content.extend([{'type':'text','text':f'CURRENT_TARGET {oid} atMs={windows[int(oid.split("-")[1])-1]["endTick"]*1000}'},image(oid)])
            row={'home':home,'block':block,'enableThinking':False,'source':str(prior),'status':'running'};started=time.perf_counter()
            try:
                response=client.chat.completions.create(model='qwen3.8-flash',messages=[{'role':'user','content':content}],temperature=0,max_tokens=1800,extra_body={'enable_thinking':False})
                (work/'response.json').write_text(response.model_dump_json(indent=2),encoding='utf8')
                import re
                answer=json.loads(re.sub(r'^```(?:json)?\s*|\s*```$','',response.choices[0].message.content or '').strip());validate(answer,original['block']['ids'],original['catalog'])
                old=json.loads((prior/'answer.json').read_text(encoding='utf8'))
                row.update(status='valid',usage=response.usage.model_dump() if response.usage else None,reasoningReturned=bool(getattr(response.choices[0].message,'reasoning_content',None)),sameAssignmentsAsPrior={r['observationId']:r['placeId'] for r in answer['assignments']}=={r['observationId']:r['placeId'] for r in old['assignments']})
                (work/'answer.json').write_text(json.dumps(answer,ensure_ascii=False,indent=2),encoding='utf8')
            except Exception as error:row.update(status='failed',exceptionType=type(error).__name__)
            row['elapsedMs']=(time.perf_counter()-started)*1000;results.append(row)
            (root/'summary.json').write_text(json.dumps({'results':results,'note':'Same historical inputs, prompt and output cap. Six nonthinking requests, no repairs. Old timing is cross-batch, not matched repeated latency measurement; agreement is not correctness.'},indent=2),encoding='utf8')
            print(json.dumps(row),flush=True)


if __name__=='__main__':main()
