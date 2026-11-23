"""Bounded provided-caption QA pilot. NOT native First-Sight RGB accuracy.

Public official captions/transcripts only; no video uploads. Fixed hash-stratified
questions, causal end-time filtering, deterministic lexical retrieval, no retries.
"""
import argparse
from collections import Counter
import datetime
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('egolife_audit', Path(__file__).with_name('inspect-egolife-integration.py'))
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)
ARTIFACT_URL = 'https://drive.usercontent.google.com/download?id=1H0kKcf4ZMXLU_-ybMjjHOcv0OX7_Z0Ak&export=download'
MAX_BYTES = 40_000_000
STOP = set('the a an to of in on at for with and or is are was were be been being do did does what which who whom when where why how i me my we our you your he she they them this that these those it its'.split())

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf8')

def tokens(text):
    return [w for w in re.findall(r'[a-z0-9]+', text.lower()) if w not in STOP]

def load_env():
    # Read local configuration without logging credentials or changing files.
    p = ROOT / '.env'
    if p.exists():
        for line in p.read_text(encoding='utf-8-sig').splitlines():
            m = re.match(r'^\s*(QWEN_API_KEY|QWEN_BASE_URL)\s*=\s*(.*?)\s*$', line)
            if m:
                os.environ.setdefault(m[1], m[2].strip('\"\''))

def artifact(path):
    if not path.exists():
        req = urllib.request.Request(ARTIFACT_URL, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=90) as response:
            if response.status != 200:
                raise ValueError('Full artifact expected HTTP200; no partial input accepted')
            raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES or len(raw) != 39_037_176:
            raise ValueError('Artifact size exceeds cap or differs from inspected source')
        records = json.loads(raw)
        path.write_bytes(raw)
        save(path.with_suffix('.receipt.json'), {'url': ARTIFACT_URL, 'bytes': len(raw), 'sha256': digest(raw), 'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    raw = path.read_bytes()
    if len(raw) > MAX_BYTES:
        raise ValueError('Artifact exceeds cap')
    return json.loads(raw), digest(raw)

def evidence_records(records):
    result = []
    seen = set()
    for row in records:
        # Deliberately exclude fine_caption, semantic summaries, object inferences,
        # cross-event enrichment, raw_entries and keyframe-derived descriptions.
        try:
            start = AUDIT.clock(row['date'], row['start_time'])['cutoffMs']
            end = AUDIT.clock(row['date'], row['end_time'])['cutoffMs']
        except (KeyError, ValueError):
            continue
        text = '\n'.join(str(row.get(k) or '') for k in ['caption_text', 'transcript_text']).strip()
        if not text or start > end:
            continue
        identifier = str(row['doc_id'])
        if identifier in seen:
            raise ValueError('Duplicate evidence ID')
        seen.add(identifier)
        result.append({'id': identifier, 'startMs': start, 'endMs': end, 'text': text, 'terms': Counter(tokens(text))})
    return result

def retrieve(task, records, limit=32, char_limit=60000):
    eligible = [r for r in records if r['endMs'] <= task['cutoffMs']]
    query = set(tokens(task['question'] + ' ' + ' '.join(task['choices'].values())))
    frequencies = Counter(t for r in eligible for t in query if t in r['terms'])
    def score(r):
        return sum(math.log(1 + (len(eligible) + 1) / (frequencies[t] + 1)) * min(r['terms'][t], 3) for t in query if t in r['terms']) / (1 + .001 * len(r['text']))
    ranked = sorted(eligible, key=lambda r: (-score(r), r['startMs'], r['id']))
    selected = []
    size = 0
    for r in ranked[:limit]:
        if size + len(r['text']) > char_limit:
            continue
        selected.append({k: r[k] for k in ['id', 'startMs', 'endMs', 'text']})
        size += len(r['text'])
    return sorted(selected, key=lambda r: (r['startMs'], r['id']))

def freeze(output, record_path):
    if output.exists():
        raise FileExistsError('Use a fresh run directory; results are immutable')
    rows = json.loads(AUDIT.QA.read_text(encoding='utf8'))
    # Exactly five per official category, chosen without evidence/answer access.
    selected = []
    for category in sorted({r['type'] for r in rows}):
        group = [r for r in rows if r['type'] == category]
        selected.extend(sorted(group, key=lambda r: digest(('first-sight-text-pilot-v1:' + str(r['ID'])).encode()))[:5])
    tasks = [AUDIT.public_task(r) for r in selected]
    output.mkdir(parents=True)
    save(output / 'public-tasks.json', tasks)
    save(output / 'gold.json', {str(r['ID']): r['answer'] for r in selected})
    save(output / 'protocol.json', {'track': 'provided-caption-transcript-lexical-QA-adaptation', 'nativeFirstSightRGB': False, 'comparison': False, 'selection': '5 per category, smallest SHA256(first-sight-text-pilot-v1:ID)', 'questions': 25, 'model': 'qwen3.8-flash', 'maxCalls': 25, 'maxOutputTokensPerCall': 768, 'maxPromptUtf8Bytes': 100000, 'maxTotalTokens': 650000, 'maxEstimatedUSD': .15, 'retrieval': 'deterministic lexical TF/IDF, top32, max60000 characters', 'causality': 'record endMs <= query cutoff; only caption_text and transcript_text, no semantic enrichment', 'limitations': 'Upstream captions generated offline; source content provenance is not an independent certification of temporal leakage absence. Not native First-Sight memory building or retrieval.', 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    records, record_hash = artifact(record_path)
    evidence = evidence_records(records)
    for task in tasks:
        save(output / ('evidence-' + task['ID'] + '.json'), retrieve(task, evidence))
    files = [p for p in output.iterdir() if p.is_file()]
    save(output / 'frozen.json', {'sourceQA': digest(AUDIT.QA.read_bytes()), 'sourceRecord': record_hash, 'script': digest(Path(__file__).read_bytes()), 'files': {p.name: digest(p.read_bytes()) for p in sorted(files)}})

def run(output):
    load_env()
    key, base = os.environ.get('QWEN_API_KEY'), os.environ.get('QWEN_BASE_URL')
    if not key or not base:
        raise ValueError('Missing Qwen API configuration')
    frozen = json.loads((output / 'frozen.json').read_text(encoding='utf8'))
    for name, expected in frozen['files'].items():
        if digest((output / name).read_bytes()) != expected:
            raise ValueError('Frozen input changed: ' + name)
    if (output / 'started.json').exists():
        raise FileExistsError('Run already started; no silent rerun')
    tasks = json.loads((output / 'public-tasks.json').read_text(encoding='utf8'))
    save(output / 'started.json', {'at': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    calls = 0
    total_tokens = 0
    estimated = 0.0
    results = []
    for task in tasks:
        evidence = json.loads((output / ('evidence-' + task['ID'] + '.json')).read_text(encoding='utf8'))
        item = {'ID': task['ID'], 'type': task['type'], 'status': 'error', 'response': 'Error'}
        try:
            prompt = 'Answer the official egocentric-history multiple-choice question using ONLY supplied timestamped caption/transcript evidence. Evidence is historical, not proof of present state. Do not assume missing history means absence. Return JSON {"answer":"A|B|C|D|null", "abstained":boolean, "evidenceIds":["actually supplied id"], "reason":"brief evidence-grounded explanation"}. If evidence is insufficient, abstain with answer null. Otherwise cite supporting evidence. No external knowledge or invented names.\n' + json.dumps({'task': task, 'evidence': evidence}, ensure_ascii=False)
            # Conservative UTF8-byte token reservation, plus output. No retries.
            reserve_tokens = len(prompt.encode('utf8')) + 2048 + 768
            reservation = ((reserve_tokens - 768) * .1356 + 768 * .4584) / 1e6
            if len(prompt.encode('utf8')) > 100000 or calls >= 25 or total_tokens + reserve_tokens > 650000 or estimated + reservation > .15:
                item['status'] = 'budget_excluded'
                raise ValueError('Global pre-call budget limit')
            payload = {'model': 'qwen3.8-flash', 'enable_thinking': False, 'temperature': 0, 'max_tokens': 768, 'response_format': {'type': 'json_object'}, 'messages': [{'role': 'user', 'content': prompt}]}
            save(output / ('request-' + task['ID'] + '.json'), payload)
            calls += 1
            total_tokens += reserve_tokens
            estimated += reservation
            save(output / 'usage.json', {'calls': calls, 'tokensIncludingUnknownReservations': total_tokens, 'estimatedUSDIncludingUnknownReservations': estimated, 'isInvoice': False})
            request = urllib.request.Request(base.rstrip('/') + '/chat/completions', data=json.dumps(payload).encode(), headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
            with urllib.request.urlopen(request, timeout=120) as response:
                raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                raise ValueError('Response size cap')
            (output / ('response-' + task['ID'] + '.json')).write_bytes(raw)
            body = json.loads(raw)
            usage = body['usage']
            pt, ct = usage['prompt_tokens'], usage['completion_tokens']
            if not all(isinstance(x, int) and x >= 0 for x in [pt, ct]):
                raise ValueError('Invalid usage')
            total_tokens += pt + ct - reserve_tokens
            estimated += (pt * .1356 + ct * .4584) / 1e6 - reservation
            answer = json.loads(body['choices'][0]['message']['content'])
            item['rawAnswer'] = answer
            valid_ids = {r['id'] for r in evidence}
            ids = answer.get('evidenceIds')
            if not isinstance(answer.get('abstained'), bool) or not isinstance(ids, list) or any(not isinstance(i, str) or i not in valid_ids for i in ids):
                raise ValueError('Invalid citation/abstention protocol')
            if answer['abstained']:
                item['status'] = 'abstained'
            elif answer.get('answer') in ['A', 'B', 'C', 'D'] and ids:
                item.update(status='answered', response=answer['answer'])
            else:
                raise ValueError('Answer requires canonical letter and source citation')
        except Exception as error:
            item['error'] = str(error)
        results.append(item)
        save(output / 'results.json', results)
        save(output / 'usage.json', {'calls': calls, 'tokensIncludingUnknownReservations': total_tokens, 'estimatedUSDIncludingUnknownReservations': estimated, 'isInvoice': False})
        print(task['ID'], item['status'], flush=True)
    # Gold is opened only after all inference terminates.
    gold = json.loads((output / 'gold.json').read_text(encoding='utf8'))
    for r in results:
        r['correct'] = r['status'] == 'answered' and r['response'] == gold[r['ID']]
    save(output / 'scored-results.json', results)
    correct = sum(r['correct'] for r in results)
    save(output / 'summary.json', {'track': 'provided-caption-transcript-lexical-QA-adaptation', 'nativeFirstSightRGB': False, 'correct': correct, 'total': len(tasks), 'accuracy': correct / len(tasks), 'statusCounts': dict(Counter(r['status'] for r in results)), 'byType': {t: {'correct': sum(r['correct'] for r in results if r['type'] == t), 'total': sum(r['type'] == t for r in results)} for t in sorted({r['type'] for r in results})}, 'calls': calls, 'tokensIncludingUnknownReservations': total_tokens, 'estimatedUSDIncludingUnknownReservations': estimated, 'isInvoice': False})

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['freeze', 'run'])
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--record', type=Path, default=ROOT / 'run/egolife-official-A1_JAKE-record.json')
    args = parser.parse_args()
    if args.mode == 'freeze':
        freeze(args.output, args.record)
    else:
        run(args.output)
