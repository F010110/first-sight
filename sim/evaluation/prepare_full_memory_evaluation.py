"""Exact causal multimodal full-memory inputs; never silently truncate.

No private labels or reference IDs are read. Request-envelope estimates are NOT
provider tokenization or proof that the model itself cannot accept the input.
"""
import argparse
import json
import sqlite3
from pathlib import Path
from sim.spatial.salad_features import sha


def pack(question, rows, assignments):
    cutoff=question['queryAtMs']
    current=next(r for r in rows if r['id']==question['currentObservationId'])
    if current['atMs']>=cutoff:raise ValueError('Invalid cutoff')
    history=[]
    for row in rows:
        if row['atMs']>current['atMs']:continue
        visible=row['judgmentAvailableAtMs']<cutoff
        assignment=assignments.get(row['id']) if visible else None
        history.append({'id':row['id'],'atMs':row['atMs'],'sourceAtMs':row['sourceAtMs'],
                        'episodeNumber':row['episodeNumber'],'cameras':row['cameras'],'sha256':row['sha256'],
                        'placeId':assignment['placeId'] if assignment else None,
                        'reason':assignment['reason'] if assignment else '',
                        'judgmentAvailable':visible})
    return {'id':question['id'],'question':question['question'],'queryAtMs':cutoff,
            'currentObservationId':current['id'],'observations':history,
            'policy':'All causal original images and per-observation memory assignments. No retrieval, selection, summarization or truncation. Mutable end-of-replay place summaries excluded because they may contain future facts.'}


def prepare(a):
    root=a.output;root.mkdir(parents=True,exist_ok=False);(root/'inputs').mkdir()
    frozen=json.loads((a.prepared/'frozen.json').read_text(encoding='utf8'))
    source=a.prepared/'model-replay/observations.jsonl';questions_path=a.prepared/'model-questions.json'
    if sha(source)!=frozen['replaySha256'] or sha(questions_path)!=frozen['publicTasksSha256']:raise ValueError('Frozen inputs changed')
    rows=[json.loads(l) for l in source.read_text(encoding='utf8').splitlines()]
    questions=json.loads(questions_path.read_text(encoding='utf8'))
    memory=Path(frozen.get('memoryDirectory',a.prepared/'memory'))
    with sqlite3.connect((memory/'topology.sqlite').resolve().as_uri()+'?mode=ro',uri=True) as db:
        assignments={r[0]:{'placeId':r[1],'reason':r[2]} for r in db.execute('SELECT observation_id,place_id,reason FROM assignments')}
    if len(assignments)!=len(rows):raise ValueError('Incomplete spatial memory')
    sizes={str(path):Path(path).stat().st_size for r in rows for path in r['cameras'].values()}
    audit=[]
    for q in questions:
        data=pack(q,rows,assignments);out=root/'inputs'/f"{q['id']}.json"
        text=json.dumps(data,ensure_ascii=False);out.write_text(text,encoding='utf8')
        images=sum(len(r['cameras']) for r in data['observations'])
        # Conservative planning reservation, not actual billed/tokenized input.
        text_reservation=len(text.encode('utf8'))
        token_estimate=images*a.image_token_reservation+text_reservation+4096
        bytes_estimate=sum((sizes[str(p)]+2)//3*4 for r in data['observations'] for p in r['cameras'].values())+text_reservation
        reasons=[]
        if images>a.max_images:reasons.append('configured-image-envelope')
        if token_estimate>a.max_input_tokens:reasons.append('planning-token-reservation')
        if bytes_estimate>a.max_payload_mib*1024*1024:reasons.append('configured-payload-envelope')
        audit.append({'id':q['id'],'observations':len(data['observations']),'images':images,'estimatedInputTokenReservation':token_estimate,
                      'estimatedBase64PayloadBytes':bytes_estimate,'inputSha256':sha(out),'status':'blocked' if reasons else 'prepared-not-executed','reasons':reasons})
    manifest={'group':'full-memory','role':'control','tasks':len(questions),'inputs':'Exact causal multimodal memory, not text-only memory',
              'publicTasksSha256':sha(questions_path),'replaySha256':sha(source),'memorySha256':sha(memory/'topology.sqlite'),
              'requestEnvelope':{'maxImages':a.max_images,'maxInputTokens':a.max_input_tokens,'maxPayloadMiB':a.max_payload_mib,'imageTokenReservation':a.image_token_reservation},
              'estimateCaveat':'Planning reservations, not measured provider tokens or verified provider limits. Blocked tasks are unexecuted, never zero-scored model answers.',
              'blocked':sum(t['status']=='blocked' for t in audit),'paidRequests':0,'audit':audit}
    (root/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
    print(json.dumps({k:v for k,v in manifest.items() if k!='audit'},indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('prepared',type=Path);p.add_argument('output',type=Path)
    p.add_argument('--max-images',type=int,default=256);p.add_argument('--max-input-tokens',type=int,default=120000)
    p.add_argument('--max-payload-mib',type=int,default=64);p.add_argument('--image-token-reservation',type=int,default=512)
    prepare(p.parse_args())
