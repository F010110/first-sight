"""Validate/freeze/run/score the answer-first Tartan QA benchmark. Gold never enters inference."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import zipfile

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def load(path):
    return json.loads(path.read_text(encoding='utf8'))

def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf8')

def path_between(edges, start, goal):
    queue = [[start]]
    while queue:
        path = queue.pop(0)
        if path[-1] == goal:
            return path
        queue.extend(path+[e['to']] for e in edges if e['from'] == path[-1] and e['to'] not in path)
    return []

def validate(root):
    public, gold = load(root/'public.json'), load(root/'gold.json')
    if public['schema'] != 'tartan-route-qa-public-v1' or gold['schema'] != 'tartan-route-qa-gold-v1':
        raise ValueError('Wrong schema')
    tasks, answers = public['tasks'], gold['answers']
    ids = [t['id'] for t in tasks]
    if not tasks or len(set(ids)) != len(ids) or len(answers) != len(ids) or {a['id'] for a in answers} != set(ids):
        raise ValueError('Every question requires exactly one pre-authored answer')
    nodes = {n['id']: n for n in public['nodes']}
    if len(nodes) != len(public['nodes']):
        raise ValueError('Duplicate nodes')
    images = public['images']
    metadata = Path(gold['source']['metadataPath'])
    if sha(metadata) != gold['source']['metadataSha256']:
        raise ValueError('Changed independent pose ground truth')
    with zipfile.ZipFile(metadata) as archive:
        poses = {v:[[float(x) for x in line.split()] for line in archive.read(f'pose_lcam_{v}.txt').decode().splitlines()] for v in ['front','left','right']}
    def heading(row):
        x,y,z,w = row[3:]
        return int(round(math.degrees(math.atan2(2*(w*z+x*y), 1-2*(y*y+z*z)))/15)*15)%360
    def expected_turn(start, target):
        d = (target-start+180)%360-180
        return 'straight' if abs(d)<=25 else 'reverse' if abs(d)>=155 else 'right' if d>0 else 'left'
    for token, image in images.items():
        if sha(Path(image['path'])) != image['sha256'] or not isinstance(image['headingDeg'], int) or not 0 <= image['headingDeg'] < 360:
            raise ValueError('Changed image or invalid camera heading')
        src = gold['imageSources'][token]
        if image['headingDeg'] != heading(poses[src['view']][src['frame']]):
            raise ValueError('Image heading disagrees with independent quaternion')
    for node in nodes.values():
        if not node['images'] or any(i not in images for i in node['images']):
            raise ValueError('Missing node evidence')
    for e in public['edges']:
        if e['from'] not in nodes or e['to'] not in nodes or any(i not in images for i in e['evidenceImages']):
            raise ValueError('Invalid edge/evidence')
    for t, a in zip(tasks, answers):
        if t['id'] != a['id'] or not a.get('basis') or a['turn'] not in ['unknown','straight','left','right','reverse'] or type(a['abstain']) is not bool:
            raise ValueError('Invalid or unordered answer')
        if not t['queryImages'] or any(i not in images for i in t['queryImages']) or any(n not in nodes for n in t['candidates']):
            raise ValueError('Invalid query')
        if a['placeId'] not in t['candidates'] or any(n not in nodes for n in a['path']):
            raise ValueError('Invalid answer nodes')
        query_source = gold['imageSources'][t['queryImages'][0]]
        if t['kind'] not in ['localization','cross_view_localization','localized_route','unrecorded_reverse','heading_alignment','missing_body_heading']:
            raise ValueError('Unknown task kind')
        # Re-derive location truth from privileged geometry, not from predictions or prose.
        if t['kind'] in ['localization','cross_view_localization','localized_route','unrecorded_reverse']:
            distances = {label:math.dist(poses['front'][query_source['frame']][:2], poses['front'][frame][:2]) for label,frame in gold['anchorFrames'].items()}
            matches = [label for label,d in distances.items() if d<=2]
            if matches != [a['placeId']] or min(d for label,d in distances.items() if label!=a['placeId'])<8:
                raise ValueError('Wrong or ambiguous localization answer')
        if t['kind'] in ['localization','cross_view_localization']:
            if a['basis']['distanceM'] > 2 or sum(d <= 2 for d in a['basis']['allAnchorDistancesM']) != 1:
                raise ValueError('Ambiguous localization truth')
        if t['kind'] in ['localized_route','unrecorded_reverse']:
            path = path_between(public['edges'], a['placeId'], t['goalPlaceId'])
            if a['path'] != path or a['abstain'] != (not path):
                raise ValueError('Route answer inconsistent with graph')
            expected = 'unknown' if not path else expected_turn(images[t['queryImages'][0]]['headingDeg'], next(e for e in public['edges'] if e['from']==path[0] and e['to']==path[1])['departureHeadingDeg'])
            if a['turn'] != expected:
                raise ValueError('Wrong initial route heading answer')
        if t['kind'] == 'heading_alignment' and a['turn'] == 'unknown':
            raise ValueError('Missing heading answer')
        if t['kind'] == 'heading_alignment' and a['turn'] != expected_turn(images[t['queryImages'][0]]['headingDeg'], images[t['targetImageId']]['headingDeg']):
            raise ValueError('Wrong camera alignment answer')
        if t['kind'] == 'missing_body_heading' and (not a['abstain'] or a['turn'] != 'unknown'):
            raise ValueError('Body heading must remain unknown')
    return public, gold

def freeze(root, note):
    public, gold = validate(root)
    if not note.strip():
        raise ValueError('Visual design review note required')
    target = root/'frozen.json'
    with target.open('x', encoding='utf8') as out:
        json.dump({'schema':'tartan-route-qa-freeze-v1', 'publicSha256':sha(root/'public.json'), 'goldSha256':sha(root/'gold.json'), 'tasks':len(public['tasks']), 'review':note, 'answerPolicy':'answers-before-inference', 'scorerSha256':sha(Path(__file__))}, out, ensure_ascii=False, indent=2)
    return load(target)

def verify_frozen(root):
    frozen = load(root/'frozen.json')
    if frozen['publicSha256'] != sha(root/'public.json') or frozen['goldSha256'] != sha(root/'gold.json') or frozen['scorerSha256'] != sha(Path(__file__)):
        raise ValueError('Frozen dataset/scorer changed; create a new version')
    return frozen

def score(root, run):
    frozen = verify_frozen(root)
    public, gold = validate(root)
    manifest = load(run/'manifest.json')
    if manifest['publicSha256'] != frozen['publicSha256'] or manifest['freezeSha256'] != sha(root/'frozen.json'):
        raise ValueError('Run bound to another benchmark')
    rows = load(run/'predictions.json')['predictions']
    if len({p['id'] for p in rows}) != len(rows) or any(p['id'] not in {t['id'] for t in public['tasks']} for p in rows):
        raise ValueError('Duplicate/unknown predictions')
    predicted = {p['id']: p for p in rows}
    details = []
    for task, answer in zip(public['tasks'], gold['answers']):
        p = predicted.get(task['id'], {'status':'not_run'})
        v = p.get('answer', {}) if p.get('status') == 'completed' else {}
        fields = {k: v.get(k) == answer[k] for k in ['placeId','path','turn','abstain']}
        correct = p.get('status') == 'completed' and all(fields.values())
        details.append({'id':task['id'], 'kind':answer.get('category',task['kind']), 'status':p['status'], 'correct':correct, 'fields':fields, 'expected':{k:answer[k] for k in fields}, 'predicted':v, 'error':p.get('error')})
    def stats(items):
        return {'total':len(items), 'correct':sum(d['correct'] for d in items), 'accuracy':sum(d['correct'] for d in items)/len(items), 'completed':sum(d['status']=='completed' for d in items), 'notRun':sum(d['status']=='not_run' for d in items), 'failed':sum(d['status'] not in ['not_run','completed'] for d in items)}
    usage_path = run/'requests/usage.json'
    report = {'schema':'tartan-route-qa-score-v1', 'mode':manifest['mode'], 'publicSha256':frozen['publicSha256'], 'goldSha256':frozen['goldSha256'], 'overall':stats(details), 'byKind':{k:stats([d for d in details if d['kind']==k]) for k in sorted({d['kind'] for d in details})}, 'fieldAccuracy':{k:sum(d['status']=='completed' and d['fields'][k] for d in details)/len(details) for k in ['placeId','path','turn','abstain']}, 'usage':load(usage_path) if usage_path.exists() else None, 'details':details, 'limitations':['Development set, one simulated robot trajectory; adjacent-frame queries are not revisits.', 'Metric anchor labels are not semantic room labels.', 'Supplied authored topology; does not evaluate autonomous map building.', 'Language fluency, factual grounding and human safety are NOT scored by exact structured answers.', 'Known heading and camera alignment are privileged experimental inputs, not raw IMU.']}
    save(run/'report.json', report)
    lines = ['# Tartan路线QA评测', '', f"模式：{manifest['mode']}；总分 {report['overall']['correct']}/{len(details)} = {report['overall']['accuracy']:.1%}", '', '|题型|正确/总数|完成|', '|---|---:|---:|']
    lines += [f"|{k}|{v['correct']}/{v['total']}|{v['completed']}|" for k,v in report['byKind'].items()]
    lines += ['', '全部题目作分母；语言说明未做自动正确性评分；不是视障安全导航验收。']
    (run/'report.md').write_text('\n'.join(lines), encoding='utf8')
    return {k:report[k] for k in ['mode','overall','byKind','usage']}

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['validate','freeze','score','run'])
    p.add_argument('dataset', type=Path)
    p.add_argument('--output', type=Path)
    p.add_argument('--review-note', default='')
    p.add_argument('--confirm-paid', action='store_true')
    p.add_argument('--scripted', type=Path)
    a = p.parse_args()
    if a.command == 'validate':
        public, _ = validate(a.dataset); result = {'valid':True,'tasks':len(public['tasks'])}
    elif a.command == 'freeze':
        result = freeze(a.dataset, a.review_note)
    elif a.command == 'score':
        if not a.output: p.error('--output required')
        result = score(a.dataset, a.output)
    else:
        if not a.output or (a.confirm_paid == bool(a.scripted)):
            p.error('Specify --output and exactly one of --confirm-paid / --scripted FILE')
        verify_frozen(a.dataset); validate(a.dataset)
        cmd = ['node', 'dist/current/evaluation/tartan-route-qa.js', str(a.dataset), str(a.output)]
        cmd += ['--confirm-paid'] if a.confirm_paid else ['--scripted', str(a.scripted)]
        completed = subprocess.run(cmd, check=False)
        result = score(a.dataset, a.output)  # Score even if stopped: never discard pending items.
        print(json.dumps(result, ensure_ascii=False))
        if completed.returncode: sys.exit(completed.returncode)
        return
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__': main()
