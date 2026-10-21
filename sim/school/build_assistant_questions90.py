"""Freeze new tiered assistant questions, without importing old answers or truth."""
import json
import hashlib
from pathlib import Path


def build():
    source = Path('run/inspect-repair-full90-v1/model-replay/observations.jsonl')
    rows = [json.loads(line) for line in source.read_text(encoding='utf8').splitlines()]
    output = Path('run/campus-assistant-questions90-v1')
    output.mkdir(exist_ok=False)
    groups = {}
    for index, row in enumerate(rows):
        groups.setdefault(row['episodeNumber'], []).append((index, row))
    current = ['我看不清现在的环境，请简短说说这里大致是什么地方；看不确定就直说。',
               '帮我看看左侧有什么明显的物体或边界，只描述画面能确认的内容。',
               '帮我看看右侧有什么明显的物体或边界，不要推断看不到的区域。']
    history = ['我想回想{time}那次记录，当时大致是什么环境？请查看那时的原图。',
               '请回看{time}的记录，当时是在室内还是室外？证据不清楚就说明。',
               '我想确认{time}那次记录里可见的地面是什么样的，请根据过去原图描述，不要判断是否安全通行。']
    tasks, evidence = [], []
    for episode, group in groups.items():
        slots = [(tier, variant) for variant in range(3) for tier in (['current', 'short'] if episode == 1 else ['current', 'short', 'long'])]
        if episode >= 8:
            slots.append(('long', 0))
        end = group[-1][1]['sourceAtMs']
        for slot, (tier, variant) in enumerate(slots):
            desired = 24000 + (end - 30000) * slot / max(1, len(slots)-1)
            index, row = min(group, key=lambda item: abs(item[1]['sourceAtMs'] - desired))
            target = row
            if tier == 'short':
                target = min(group, key=lambda item: abs(item[1]['atMs'] - (row['atMs'] - 20000)))[1]
            elif tier == 'long':
                previous = groups[episode-1]
                target = previous[min(len(previous)-1, int((variant+1)*len(previous)/4))][1]
            lag = row['atMs']-target['atMs']
            assert tier == 'current' or (20000 <= lag <= 180000 if tier == 'short' else lag >= 1200000)
            seconds = target['atMs']//1000
            time = f'{seconds//3600:02d}:{seconds//60%60:02d}:{seconds%60:02d}'
            task_id = f'assistant90-{episode:02d}-{slot+1:02d}'
            tasks.append({'id': task_id, 'index': index, 'tier': tier, 'episodeNumber': episode,
                          'queryAtMs': row['atMs'], 'text': current[variant] if tier == 'current' else history[variant].format(time=time),
                          'capability': 'visual.current' if tier == 'current' else 'memory.query'})
            evidence.append({'id': task_id, 'evidenceObservationId': target['id'], 'evidenceAtMs': target['atMs'],
                             'historicalLagMs': lag, 'paths': target['cameras'],
                             'sha256': target['sha256'], 'reviewStatus': 'source-bound-not-independently-reviewed',
                             'acceptance': 'Describe only visible evidence, or explicitly abstain. Historical claims require inspecting original evidence at the requested time. No safe-passage or unseen-area claims.'})
    assert len(tasks) == 90
    assert all(sum(t['tier']==tier for t in tasks)==30 for tier in ['current','short','long'])
    assert len({t['queryAtMs'] for t in tasks}) == 90
    (output/'tasks.json').write_text(json.dumps(tasks,ensure_ascii=False,indent=2),encoding='utf8')
    (output/'evaluation-only').mkdir()
    (output/'evaluation-only/evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf8')
    (output/'frozen.json').write_text(json.dumps({'schema':'assistant-questions90-v1','tasks':90,'tiers':{'current':30,'short':30,'long':30},'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'tasksSha256':hashlib.sha256((output/'tasks.json').read_bytes()).hexdigest(),'construction':'New visible-environment and time-referenced recall templates, no old answers/labels imported. Synthetic intermittent clock. Not an independently graded benchmark.'},indent=2),encoding='utf8')
    print(output)


if __name__ == '__main__':
    build()
