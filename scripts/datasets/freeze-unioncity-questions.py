"""Freeze approved question text separately from private references; no model calls."""
import argparse
import hashlib
import json
import re
from pathlib import Path


def digest(data):
    return hashlib.sha256(data).hexdigest()


def freeze(draft, bundle, output):
    draft, bundle, output = Path(draft), Path(bundle), Path(output)
    if output.exists():
        raise FileExistsError(output)
    raw = draft.read_bytes()
    rows = [[x.strip() for x in line.strip('|').split('|')] for line in raw.decode('utf-8').splitlines()
            if re.match(r'\| [CSL]\d{2} \|', line)]
    if len(rows) != 90 or len({r[0] for r in rows}) != 90:
        raise ValueError('Need exactly 90 unique approved questions')
    public = json.loads((bundle / 'public-presentation.json').read_text(encoding='utf-8'))
    by_time = {r['atMs']: r for r in public['observations']}
    tasks, private = [], []
    for tier in 'CSL':
        selected = [r for r in rows if r[0][0] == tier]
        if [r[0] for r in selected] != [f'{tier}{i:02d}' for i in range(1, 31)]:
            raise ValueError('Incorrect tier IDs')
    for row in rows:
        ident, when, question = row[:3]
        seconds = int(when)
        current = by_time[seconds * 1000]
        reference_times = [seconds] if ident[0] == 'C' else [int(v) for v in re.findall(r'\d+', row[3])]
        if any(t > seconds for t in reference_times):
            raise ValueError('Future reference')
        if ident[0] == 'S' and any(not 0 < seconds - t <= 60 for t in reference_times):
            raise ValueError('Short reference outside candidate context window')
        if ident[0] == 'L' and any(seconds - t < 180 for t in reference_times if t != seconds):
            raise ValueError('Long reference too recent')
        tasks.append({'id': ident, 'queryAtMs': seconds * 1000, 'sourceQueryAtMs': seconds * 500,
                      'question': question, 'currentObservationId': current['id']})
        private.append({'id': ident, 'tier': ident[0], 'expected': row[-1],
                        'referenceObservations': [{'id': by_time[t * 1000]['id'], 'atMs': t * 1000,
                                                   'views': by_time[t * 1000]['views']} for t in reference_times],
                        'status': 'approved-question-with-assistant-reference-not-independent-human-gold'})
    tasks.sort(key=lambda r: (r['queryAtMs'], r['id']))
    output.mkdir(parents=True)
    (output / 'evaluation-only').mkdir()
    for name, value in [('tasks.json', tasks), ('evaluation-only/references.json', private)]:
        (output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    (output / 'approved-draft.md').write_bytes(raw)
    hashes = {name: digest((output / name).read_bytes()) for name in ['tasks.json', 'evaluation-only/references.json', 'approved-draft.md']}
    frozen = {'schema': 'unioncity-questions90-freeze-v1', 'questions': 90, 'tiers': {'C': 30, 'S': 30, 'L': 30},
              'hashes': hashes, 'publicInputPath': str((bundle / 'public-presentation.json').resolve()),
              'publicInputSHA256': digest((bundle / 'public-presentation.json').read_bytes()),
              'sampleSHA256': digest((bundle / 'sample.json').read_bytes()), 'recentContextMs': 60000,
              'longCandidateGapMs': 180000, 'questionsApproved': True,
              'referenceAuthority': 'Assistant visual evidence draft, user approved questions; not independent human grading',
              'publicTaskRule': 'IDs are scheduler-only. Answer model receives question text, current images and causal context, no tier or private reference.',
              'runMode': 'Causal paused replay, independent question branches; not realtime',
              'costCapsUSD': {'extractionSlot0': .30, 'extractionSlot1': .30, 'questions': .60, 'grading': .30}}
    (output / 'frozen.json').write_text(json.dumps(frozen, ensure_ascii=False, indent=2), encoding='utf-8')
    return frozen


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--draft', required=True)
    p.add_argument('--bundle', required=True)
    p.add_argument('--output', required=True)
    args = p.parse_args()
    print(json.dumps(freeze(args.draft, args.bundle, args.output), ensure_ascii=False))
