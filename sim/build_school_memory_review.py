"""Publish original school observations + frozen residual-task review, no paid calls."""
import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path

ISSUES = {
 'memq-8f1596a6b34e16bdb65b': ('easy', '检索控制', '源地址缺少秒数；完整地址离线可取回正确图。修接口与纠错提示，不改记忆。'),
 'memq-42c2ac7529cc9c3b9990': ('easy', '协议漏检', '正文拒答但flag=false；旧失败名单漏选，应重新运行公共协议校验。'),
 'memq-b299e86e332ee7b577ff': ('human', '视觉／用途推断', '核查仓库／工业用途是否无依据，以及走廊参考是否合理。'),
 'memq-d975c597399fedaa4fe0': ('human', '分类精度', '室内空间描述过泛；核查多视角是否足以明确走廊。'),
 'memq-7907dfd3c65b14c20eae': ('human', '用途／标签边界', '地下通道与走廊可能重叠；地铁站用途不能凭装饰推断。'),
 'memq-0571a67173c9f63aa6d3': ('human', '结构／功能标签', '正确历史图已取得；更衣区、储物间与走廊的边界需人工核查。'),
 'memq-5757dcd30a28ea6972f9': ('human', '标签边界', '正确历史图已取得；大厅与宽走廊是否应兼容。'),
 'memq-ed20bdf1225098a28263': ('hard', '楼层证据链', '同一路线26–80秒上下文供审查；端点图不一定能证明楼层，私有Z不能当模型输入。'),
}


def read(path):
    return json.loads(path.read_text(encoding='utf8'))


def jsonl(path):
    return [json.loads(s) for s in path.read_text(encoding='utf8').splitlines()]


def build(group, repaired, bank, output):
    if output.exists():
        raise ValueError('Require NEW output directory; never overwrite review packages')
    observations = jsonl(group / 'model-replay/observations.jsonl')
    frozen = read(group / 'frozen.json')
    if hashlib.sha256((group / 'model-replay/observations.jsonl').read_bytes()).hexdigest() != frozen['replaySha256']:
        raise ValueError('Replay hash mismatch')
    tasks = {t['id']: t for t in read(bank / 'evaluation-only/tasks.json')}
    predictions = {p['id']: p for p in jsonl(repaired / 'results.jsonl')}
    grades = {g['id']: g for g in jsonl(group / 'full-grading/grades.jsonl')}
    output.mkdir(parents=True)
    (output / 'images').mkdir()
    samples = []
    for index, row in enumerate(observations):
        cameras = {}
        for camera in ['front', 'left', 'right']:
            source = Path(row['cameras'][camera])
            if hashlib.sha256(source.read_bytes()).hexdigest() != row['sha256'][camera]:
                raise ValueError('Original image hash mismatch: ' + row['id'])
            target = output / 'images' / (row['id'] + '-' + camera + source.suffix)
            try:
                os.link(source, target)
            except OSError:
                shutil.copy2(source, target)
            cameras[camera] = target.relative_to(output).as_posix()
        samples.append({'id': row['id'], 'index': index, 'episode': row['episodeNumber'],
                        'sourceAtMs': row['sourceAtMs'], 'activityAtMs': row['atMs'],
                        'cameras': cameras, 'sha256': row['sha256']})
    issues = []
    for key, (difficulty, category, diagnosis) in ISSUES.items():
        task, prediction, grade = tasks[key], predictions[key], grades[key]
        raw = prediction.get('result', {}).get('raw')
        parsed = json.loads(raw) if raw else {}
        issues.append({'id': key, 'question': task['question'], 'tier': task['memoryTier'],
                       'difficulty': difficulty, 'category': category, 'diagnosis': diagnosis,
                       'reference': task['expectedAnswer'], 'labelBasis': task['labelBasis'],
                       'answer': parsed.get('answer'), 'abstained': parsed.get('abstained'),
                       'error': prediction.get('error'), 'utility': grade['utility'],
                       'gradeReason': grade.get('reason'), 'currentId': task['currentObservationId'],
                       'referenceIds': list(dict.fromkeys(sum(task['validEvidenceSets'], []))),
                       'inspectedIds': prediction.get('inspectedIds', []),
                       'citationIds': parsed.get('historicalEvidenceIds', [])})
    identity = hashlib.sha256(json.dumps({'replay': frozen['replaySha256'], 'issues': issues}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    payload = {'protocol': 'school-memory-review-v1', 'datasetId': 'school-memory-v4-locked',
               'title': '学校空间记忆 · 8题诊断', 'source': '学校原始录像 / 空间记忆评测',
               'reviewKind': 'memory', 'model': 'qwen3.8-flash', 'frameCount': len(samples)*3,
               'samples': samples, 'issues': issues, 'fingerprint': identity,
               'warning': 'AI辅助审核，非盲审。原参考并非独立人工真值；保存意见不会改标签、算法或冻结分数。不同段之间不构成连续运动。图像只读，勿修改hardlink文件。'}
    (output / 'data.json').write_text(json.dumps(payload, ensure_ascii=False), encoding='utf8')
    shutil.copy2(Path(__file__).with_name('school_memory_review.html'), output / 'index.html')
    return {'directory': str(output), 'observations': len(samples), 'images': len(samples)*3, 'issues': len(issues), 'fingerprint': identity}


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('group', type=Path); p.add_argument('repaired', type=Path)
    p.add_argument('bank', type=Path); p.add_argument('output', type=Path)
    a = p.parse_args()
    print(json.dumps(build(a.group, a.repaired, a.bank, a.output), ensure_ascii=True))
