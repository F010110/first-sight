"""Bounded temporal auxiliary-text retrieval for evidence archives.

Development adapter for EgoRAG-style temporal/semantic retrieval and Video-RAG
auxiliary channels, NOT either official inference pipeline. Text must already exist;
no audio, OCR, captions, or detections are invented. Local FTS5 is lexical, not CLIP.
"""
import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

CHANNELS={'caption','ocr','asr','detection'}

def build(archive: Path, documents: Path, output: Path):
    if not (archive/'complete.json').is_file():raise ValueError('Incomplete archive')
    if documents.stat().st_size>16*1024*1024:raise ValueError('Text input budget exceeded')
    evidence=sqlite3.connect((archive/'evidence.sqlite').resolve().as_uri()+'?mode=ro',uri=True)
    rows={json.loads(raw)['id']:json.loads(raw) for (raw,) in evidence.execute('SELECT raw FROM observations')};evidence.close()
    docs=[];seen=set()
    for line in documents.read_text(encoding='utf8').splitlines():
        doc=json.loads(line)
        if set(doc)!={'id','observationId','channel','text','producer','sourceImageSha256'}:raise ValueError('Unexpected document fields')
        row=rows.get(doc['observationId'])
        if row is None or doc['id'] in seen or doc['channel'] not in CHANNELS:raise ValueError('Unknown observation/channel or duplicate document')
        if not isinstance(doc['text'],str) or not 0<len(doc['text'].strip())<=4000 or not isinstance(doc['producer'],str) or not 0<len(doc['producer'])<=200:raise ValueError('Invalid text/provenance budget')
        # RGB-only binding cannot authenticate ASR; require a separate audio protocol.
        if doc['channel']=='asr':raise ValueError('ASR requires authenticated audio provenance; RGB archive is insufficient')
        if not doc['sourceImageSha256'] or not set(doc['sourceImageSha256']).issubset(set(row['sha256'].values())):raise ValueError('Unbound source image hashes')
        seen.add(doc['id']);docs.append((doc,row))
        if len(docs)>10000:raise ValueError('Document count budget exceeded')
    output.mkdir(parents=True,exist_ok=False);db=sqlite3.connect(output/'text.sqlite')
    db.execute('CREATE TABLE documents(id TEXT PRIMARY KEY,observation_id TEXT,recording TEXT,at_ms REAL,day INTEGER,hour INTEGER,channel TEXT,text TEXT,provenance TEXT)')
    db.execute('CREATE INDEX scope ON documents(recording,at_ms)')
    db.execute('CREATE VIRTUAL TABLE terms USING fts5(text,tokenize="unicode61")')
    for doc,row in docs:
        cursor=db.execute('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?)',(doc['id'],row['id'],row['sessionId'],row['atMs'],int(row['atMs']//86400000),int(row['atMs']//3600000),doc['channel'],doc['text'],json.dumps(doc)))
        db.execute('INSERT INTO terms(rowid,text) VALUES(?,?)',(cursor.lastrowid,doc['text']))
    db.commit();db.close()
    report={'documents':len(docs),'archiveSha256':hashlib.sha256((archive/'evidence.sqlite').read_bytes()).hexdigest(),'indexSha256':hashlib.sha256((output/'text.sqlite').read_bytes()).hexdigest(),'documentSha256':hashlib.sha256(documents.read_bytes()).hexdigest(),'modelCalls':0,'method':'bounded-temporal-fts5','note':'Lexical auxiliary adapter, not official EgoRAG/Video-RAG; source-relative day/hour buckets, not calendar days. Text is untrusted predicted evidence, never physical identity.'}
    (output/'complete.json').write_text(json.dumps(report,indent=2));return report

def search(index: Path, recording: str, as_of_ms: float, query: str, after_ms=0, limit=6, channels=None):
    import math
    if not recording or not math.isfinite(as_of_ms) or not math.isfinite(after_ms) or after_ms<0 or after_ms>=as_of_ms:raise ValueError('Recording and strict time scope required')
    if isinstance(limit,bool) or not isinstance(limit,int) or not 1<=limit<=24 or not 0<len(query)<=512:raise ValueError('Query budget exceeded')
    channels=CHANNELS if channels is None else set(channels)
    if not channels or not channels<=CHANNELS:raise ValueError('Unknown channel')
    if not (index/'complete.json').is_file():raise ValueError('Incomplete index')
    # Quote tokens so input is data, not FTS syntax. Bounded term count.
    import re
    tokens=re.findall(r'\w+',query,flags=re.UNICODE)[:16]
    if not tokens:return []
    match=' OR '.join('"'+t.replace('"','""')+'"' for t in tokens)
    db=sqlite3.connect((index/'text.sqlite').resolve().as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
    db.set_progress_handler(lambda:1,1_000_000)
    try:
        result=db.execute(f'SELECT d.id,d.observation_id,d.at_ms,d.day,d.hour,d.channel,d.text,d.provenance,bm25(terms) AS rank FROM terms JOIN documents d ON d.rowid=terms.rowid WHERE terms MATCH ? AND d.recording=? AND d.at_ms<? AND d.at_ms>=? AND d.channel IN ({",".join("?" for _ in channels)}) ORDER BY rank,d.at_ms DESC,d.id LIMIT ?', (match,recording,as_of_ms,after_ms,*sorted(channels),limit)).fetchall()
        return [dict(r) for r in result]
    finally:db.close()

if __name__=='__main__':
    p=argparse.ArgumentParser();sub=p.add_subparsers(dest='command',required=True)
    b=sub.add_parser('build');b.add_argument('archive',type=Path);b.add_argument('documents',type=Path);b.add_argument('output',type=Path)
    q=sub.add_parser('search');q.add_argument('index',type=Path);q.add_argument('recording');q.add_argument('as_of_ms',type=float);q.add_argument('query')
    a=p.parse_args()
    print(json.dumps(build(a.archive,a.documents,a.output) if a.command=='build' else search(a.index,a.recording,a.as_of_ms,a.query)))
