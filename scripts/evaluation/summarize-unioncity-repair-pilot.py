"""No-call paired pilot report, preserving failed attempts and provisional judging."""
import argparse
import json
from pathlib import Path


def load(p):
    return json.loads(Path(p).read_text(encoding='utf-8'))


def summarize(freeze, run, score, output):
    freeze, run, score, output = map(Path, [freeze, run, score, output])
    if output.exists():
        raise FileExistsError(output)
    plan, report = load(freeze / 'plan.json'), load(run / 'report.json')
    card, audit = load(score / 'summary.json'), load(run / 'input-audit.json')
    manual = load('data/evaluation/unioncity-repair-pilot-v2-assistant-review.json')
    results = [json.loads(line) for line in (run / 'results.jsonl').read_text(encoding='utf-8').splitlines()]
    grades = [json.loads(line) for line in (score / 'grades.jsonl').read_text(encoding='utf-8').splitlines()]
    usage = load(score / 'requests/usage.json')
    pilot_usd = audit['cumulativePilotAnswerUSD'] + usage['estimatedUSD']
    old_cost = load('run/unioncity-questions90-v2-summary1/cost.json')
    cost = {'pilotEstimatedUSD': pilot_usd, 'oldEvaluationEstimatedUSD': old_cost['estimatedUSD'],
            'allEstimatedUSD': pilot_usd + old_cost['estimatedUSD'], 'pilotCapUSD': .70,
            'pilotCalls': audit['thisAttemptUsage']['calls'] + sum(p['calls'] for p in plan.get('previousAttempts', [])) + usage['calls'],
            'unknownCallsReserved': usage['unknownCallsReserved'] + audit['thisAttemptUsage']['unknownCallsReserved'],
            'estimateNotInvoice': True}
    decision = {'full90Allowed': False, 'reason': manual['gateReview']['reason'],
                'predeclaredGatePreserved': True, 'automaticPreliminaryGate': card['preliminaryGatePassed'],
                'structuralAuditPassed': audit['passed'], 'assistantReview': manual,
                'completeBranches': report['completed'], 'plannedBranches': 37, 'cost': cost,
                'automaticReviewsValid': sum(g['reviewed'] for g in grades),
                'automaticReviewsInvalid': sum(not g['reviewed'] for g in grades),
                'finalSemanticAccuracy': None,
                'nextPriority': 'Temporal visit/referent evidence binding and ambiguity-aware questions; no full90 or unreviewed heldout run'}
    output.mkdir(parents=True)
    (output / 'decision.json').write_text(json.dumps(decision, ensure_ascii=False, indent=2), encoding='utf-8')
    (output / 'cost.json').write_text(json.dumps(cost, indent=2), encoding='utf-8')
    lines = ['# 三步修复与小样本对照结果', '',
             '**未通过预先门槛，不扩大90题。旧成功控制L01发生退步；工具调用恢复不等于找到正确历史。**', '',
             '- 第1版：37分支交付，但正常分支memory调用0，已判失败保留，未花费37次评分。',
             '- 第2版：37分支交付，正常9道长期题全部实际查库；输入隔离审计通过，旧快照/输入/答案未改。',
             '- 关键对照：L07能从memory找回旧柜台；L01查到了错误较晚候车区；L10用共同地砖误判同店；L13找对店但取错室内外对象。',
             '- 给旧图可改善部分问题，但还改变了指代明确程度；不是纯检索因果证明。L25即使给图仍错配早晚场所，L16还存在台面对象歧义。',
             '- C30本次没有再附加直接通行许可；单例改善不代表安全认证。',
             '- 自动审查26/37通过结构校验，11个审查无效；其中包括把诊断直接给的旧图误当持久memory证据。无效审查不是答题0分，不据此给新准确率。',
             '- 449项TypeScript测试通过，校准/预算Python测试2项通过；测试通过不等于语义门槛通过。',
             f"- 本轮累计估算USD{pilot_usd:.6f}，含旧正式评测共USD{cost['allEstimatedUSD']:.6f}；未追加完整90题。", '',
             '## 同一快照三分支原始回答', '',
             '自动实用分仅作开发参考；目标是对比检索、禁用与提供证据，不计算代表总体准确率的总分。', '',
             '|题目|分支|原始回答|自动实用分|审查状态|', '|---|---|---|---:|---|']
    def cell(value):
        return str(value).replace('|', '\\|').replace('\n', '<br>')
    order = {'normal': 0, 'memory-disabled': 1, 'supplied-evidence-diagnostic': 2}
    for ident in plan['normal']:
        for result in sorted([r for r in results if r['id'] == ident], key=lambda r: order[r['mode']]):
            grade = next(g for g in grades if g['id'] == ident and g['mode'] == result['mode'])
            answer = result.get('answer', {}).get('text', result.get('error', ''))
            score_text = str(grade['utility']) if grade['reviewed'] else '—'
            lines.append(f"|{ident}|{result['mode']}|{cell(answer)}|{score_text}|{'已自动审查（仍非人工真值）' if grade['reviewed'] else '审查失败/待核查，不是答题0分'}|")
    (output / 'report.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return {'output': str(output), 'full90Allowed': False, 'cost': cost}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['freeze', 'run', 'score', 'output']:
        p.add_argument('--' + name, required=True)
    a = p.parse_args()
    print(json.dumps(summarize(a.freeze, a.run, a.score, a.output), ensure_ascii=False))
