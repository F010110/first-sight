"""Independent execution receipts; no semantic grading or original report edits."""
import argparse
import collections
import hashlib
import json
from pathlib import Path


def audit(root):
    frozen = json.loads((root/'frozen.json').read_text(encoding='utf8'))
    events = [json.loads(line) for line in (root/'events.jsonl').read_text(encoding='utf8').splitlines() if line.strip()]
    tasks = [event['value'] for event in events if event['kind']=='task-settled']
    created = [event['value'] for event in events if event['kind']=='task-created']
    script = frozen['script']
    assert len(script)==90 and len(created)==len(tasks)==90
    assert len({row['id'] for row in tasks})==90
    assert all(actual['text']==step['text'] for actual,step in zip(created,script))
    source = [json.loads(line) for line in Path('run/inspect-repair-full90-v1/model-replay/observations.jsonl').read_text(encoding='utf8').splitlines()]
    tiers = collections.Counter(step['tier'] for step in script)
    assert tiers=={'current':30,'short':30,'long':30}
    assert len({step['index'] for step in script})==90
    assert [step['index'] for step in script]==sorted(step['index'] for step in script)
    by_tier = {tier:dict(collections.Counter(task['status'] for task,step in zip(tasks,script) if step['tier']==tier)) for tier in tiers}
    memory = Path(frozen['memoryRoot'])/'memory.sqlite'
    digest = hashlib.sha256(memory.read_bytes()).hexdigest()
    assert digest==frozen['memorySha256']
    usage = json.loads((root/'question-requests/usage.json').read_text())
    delivered = [e['value'] for e in events if e['kind']=='message-delivered']
    answers = [e for e in delivered if e.get('source') in ['visual','historical']]
    evidence = json.loads(Path('run/campus-assistant-questions90-v1/evaluation-only/evidence.json').read_text(encoding='utf8'))
    expected = {entry['id']:entry['evidenceObservationId'] for entry in evidence}
    delivered_by_task = {entry.get('taskId'):entry for entry in answers}
    reference_counts = collections.Counter()
    for task, step in zip(tasks,script):
        answer = delivered_by_task.get(task['id'])
        if answer and expected[step['id']] in answer.get('sourceIds',[]):
            reference_counts[step['tier']] += 1
    inspections = []
    for directory in sorted((root/'question-requests').iterdir()):
        if not directory.is_dir() or not (directory/'response.txt').exists():
            continue
        body = json.loads((directory/'response.txt').read_text(encoding='utf8'))
        try:
            value = json.loads(body['choices'][0]['message']['content'])
            if value.get('kind')=='inspect':
                inspections.append(value['ids'])
        except (KeyError,TypeError,ValueError):
            pass
    result = {'dataset':'assistant-questions90-v1','attempted':len(tasks),'tiers':dict(tiers),'taskStatuses':dict(collections.Counter(t['status'] for t in tasks)),
              'byTier':by_tier,'episodes':len({source[step['index']]['episodeNumber'] for step in script}),
              'deliveredAnswers':len(answers),'deliveredFailureNotices':sum(e.get('action')=='FAIL_NOTICE' for e in delivered),
              'inspections':len(inspections),'referenceObservationCitedByTier':dict(reference_counts),'memoryUnchanged':True,'memorySha256':digest,'spatialModelCalls':0,'usage':usage,
              'tasks':tasks,'grade':'Execution audit only; no independent semantic accuracy score.',
              'note':'Authoritative task counts reconstructed from append-only task-settled events. Runtime snapshots retain only the latest 50 tasks.'}
    (root/'validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({k:v for k,v in result.items() if k!='tasks'},ensure_ascii=True))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('root',type=Path)
    audit(parser.parse_args().root)
