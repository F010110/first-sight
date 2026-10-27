"""Four bounded generations + independent Plus judgments, no retries."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import time
import urllib.request
import urllib.error

ROOT=Path(__file__).resolve().parents[1]
REPORT=ROOT/'reports/direct-vlm-pilot-v1-results.json'
SYSTEM='You answer questions about an indoor environment using the provided observations. Base your answer on visual evidence, not typical room layouts. If the evidence is insufficient, say you cannot determine the answer. Give a concise direct answer.'


def call(model,messages,max_tokens):
    start=time.monotonic()
    payload=dict(model=model,messages=messages,temperature=.7 if model!='qwen3.7-plus-2026-05-26' else .2,
                 max_tokens=max_tokens)
    request=urllib.request.Request(os.environ['QWEN_BASE_URL'].rstrip('/')+'/chat/completions',
        data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+os.environ['QWEN_API_KEY'],'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(request,timeout=180) as response:
            data=json.load(response)
        return dict(text=data['choices'][0]['message']['content'],returnedModel=data.get('model'),
            usage=data.get('usage'),seconds=time.monotonic()-start)
    except urllib.error.HTTPError as e:
        return dict(errorType=type(e).__name__,httpStatus=e.code,seconds=time.monotonic()-start)
    except Exception as e:
        return dict(errorType=type(e).__name__,seconds=time.monotonic()-start)


def main():
    assert os.environ.get('QWEN_API_KEY') and os.environ.get('QWEN_BASE_URL')
    manifest=json.loads((ROOT/'reports/direct-vlm-pilot-v1-manifest.json').read_text())
    questions={q['question_id']:q for q in json.loads((ROOT/'data/hm3d-minival-eqa-subset/questions.json').read_text())}
    prompt=(ROOT/'vendor/3dmem-aeqa-eval/prompts/mmbench.txt').read_text()
    report=json.loads(REPORT.read_text()) if REPORT.exists() else dict(scope=manifest['scope'],rows=[])
    done={(r['questionId'],r['model']) for r in report['rows']}
    for item in manifest['questions']:
        content=[dict(type='text',text='Question: '+item['question']+'\nThe following images are chronological observations from the same exploration episode.')]
        for i,image in enumerate(item['images']):
            raw=Path(image['path']).read_bytes()
            assert hashlib.sha256(raw).hexdigest()==image['sha256']
            content.extend([dict(type='text',text=f'Observation {i+1}'),
                dict(type='image_url',image_url=dict(url='data:image/png;base64,'+base64.b64encode(raw).decode(),detail='high'))])
        for model in manifest['answerModels']:
            key=(item['questionId'],model)
            if key in done:continue
            print('START',*key,flush=True)
            answer=call(model,[dict(role='system',content=SYSTEM),dict(role='user',content=content)],4096)
            row=dict(questionId=item['questionId'],model=model,imageCount=len(item['images']),
                allRawRgbMatchSource=item['allRawRgbMatchSource'],generation=answer)
            if answer.get('text'):
                q=questions[item['questionId']]
                judge=call(manifest['judgeModel'],[dict(role='user',content=prompt.format(
                    question=q['question'],answer=q['answer'],prediction=answer['text']))],1024)
                m=re.fullmatch(r'(?:Your mark:\s*)?([1-5])\s*',judge.get('text','').strip())
                judge['score']=int(m.group(1)) if m else None
                row['judge']=judge
            report['rows'].append(row)
            REPORT.write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
            print('END',*key,'score',row.get('judge',{}).get('score'),'error',answer.get('errorType'),flush=True)
            if answer.get('errorType'):
                raise RuntimeError('API/backend failure; stop rather than silently replacing models or retrying')


if __name__=='__main__':
    main()
