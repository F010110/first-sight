"""Publish a transparent, no-call summary without replacing original automatic grades."""
import argparse
import json
from pathlib import Path


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def summarize(run, score, review, output):
    run, score, review, output = map(Path, [run, score, review, output])
    if output.exists():
        raise FileExistsError(output)
    report, card, manual = load(run / 'report.json'), load(score / 'scorecard.json'), load(review)
    audit = load(run / 'input-audit-v2.json')
    grading_usage = load(score / 'requests/usage.json')
    results = [json.loads(line) for line in (run / 'results.jsonl').read_text(encoding='utf-8').splitlines()]
    grades = {r['id']: r for r in [json.loads(line) for line in (score / 'grades.jsonl').read_text(encoding='utf-8').splitlines()]}
    total = {'calls': audit['calls'] + grading_usage['calls'],
             'estimatedUSD': audit['estimatedUSD'] + grading_usage['estimatedUSD'],
             'unknownCallsReserved': audit['unknownCallsReserved'] + grading_usage['unknownCallsReserved'],
             'maxAuthorizedUSD': 1.50, 'estimateNotInvoice': True}
    output.mkdir(parents=True)
    (output / 'cost.json').write_text(json.dumps(total, indent=2), encoding='utf-8')
    (output / 'assistant-review.json').write_text(json.dumps(manual, ensure_ascii=False, indent=2), encoding='utf-8')
    overview = {'execution': report, 'cost': total, 'automaticScorecardProvisional': card,
                'inputAuditPassed': audit['passedStructuralChecks'], 'actualChannels': audit['tiers'],
                'assistantReview': str(review), 'verifiedSafetyEventsAtLeast': len(manual['reviewedSafetyEvents']),
                'finalSemanticAccuracy': None, 'certifiedMemorySuccessRate': None,
                'status': 'evaluation-completed-with-provisional-automatic-grades-and-targeted-assistant-review'}
    (output / 'summary.json').write_text(json.dumps(overview, ensure_ascii=False, indent=2), encoding='utf-8')
    lines = ['# UnionCity 90题评测结果', '',
             '**完成90题执行、87题交付、3题失败；自动分数仅供开发参考，不是最终正确率。**', '',
             '|类别|交付|自动初评分（暂定）|', '|---|---:|---:|']
    for tier in card['tiers']:
        lines.append(f"|{tier['tier']}|{tier['completed']}/30|{tier['developmentUtilityPercent']:.2f}/100|")
    lines += ['', f"总费用估算USD{total['estimatedUSD']:.6f}，{total['calls']}次调用，未知预留{total['unknownCallsReserved']}；非账单。", '',
              '## 机制审计与局限', '',
              '- 813/813事实提交；142次实际问答请求结构审计通过，无已发现的未来图/私有答案字段泄漏。',
              '- S：24题最终引用context；5个交付题仅引用原图；1题引用违规失败；1题还调用持久工具。不能直接把短期答对率称context使用成功率。',
              '- L：27题实际请求持久工具（含失败题），23个交付答案引用memory；调用、取回、正确使用不是一回事。',
              '- L03有近期重访context再暴露；自动“长期污染0”不成立。自动context覆盖22/30和两组路径合格19/30均不作认证机制成绩。',
              '- 助手复核至少发现1个无依据直接通行建议（C30），自动裁判却漏判；存在其他评分布尔值/理由矛盾。',
              '- 正式自动分数原样保留；针对性复核不是全题独立人工重评，因此不另造一个“最终准确率”。',
              '- 暂停式因果回放；问答p50/95/max约2.31/11.68/14.52秒，不是实时持续交互成绩。',
              '- 原事实生产者＋新增因果context问答策略；不含Planner/语音/UI或真实视障用户安全验收。', '',
              '## 已知关键问题', '',
              '- S03引用了未看过的历史原图；L07耗尽6轮；L10输出截断且候选有错误地点等同。',
              '- L09将当前洗衣店当成最早店铺；L13/L21错绑店铺；S27/S30错用门或历史朝向。',
              '- 工具提示示例123000ms被照抄，部分长期检索错误缩窄时间范围，是本轮提示/检索策略局限。', '',
              '## 全部问题与原始回答', '',
              '下表分数为未修改的自动初评；完整异议在assistant-review.json，不以这些分数作安全验收。', '',
              '|ID|播放秒|问题|原始交付回答/失败|自动实用分0–4|实际引用通道|', '|---|---:|---|---|---:|---|']
    def cell(value):
        return str(value).replace('|', '\\|').replace('\n', '<br>')
    for result in results:
        answer = result.get('answer', {})
        channels = []
        if answer.get('sourceIds'):
            channels.append('原图')
        if answer.get('contextRefs'):
            channels.append('context')
        if answer.get('memoryRefs'):
            channels.append('memory')
        value = answer.get('text') if result['status'] == 'completed' else '失败：' + result['error']
        lines.append(f"|{result['id']}|{result['queryAtMs']/1000:g}|{cell(result['question'])}|{cell(value)}|{grades[result['id']]['utility']}|{'＋'.join(channels) or '未交付'}|")
    (output / 'report.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return {'output': str(output), 'execution': {'questions': 90, 'delivered': report['finished'], 'failed': report['failed']},
            'totalCost': total, 'automaticScoresProvisional': True, 'finalSemanticAccuracy': None}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['run', 'score', 'review', 'output']:
        p.add_argument('--' + name, required=True)
    args = p.parse_args()
    print(json.dumps(summarize(args.run, args.score, args.review, args.output), ensure_ascii=False))
