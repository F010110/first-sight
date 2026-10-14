"""Freeze existing answers and compare existing arms, without new API calls."""
import hashlib
import json
from pathlib import Path
from single_observation_vlm_trial import usage


def main():
    baseline=Path('run/single-observation-vlm-1791942042733665700')
    earlier=Path('run/hssd-chunking-trial-1791899137179507700')
    files=[baseline/'summary.json',Path('docs/research/group-identity-annotations-v3-1.json'),Path('sim/vlm_group_identity_annotations_trial.py'),Path('sim/hssd_chunking_trial.py')]
    files.extend(sorted(baseline.glob('*/single-observation/atlases/*')))
    files.extend(sorted(baseline.glob('*/single-observation/inference/*.json')))
    inventory={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.is_file()}
    contract={'protocol':'pure-vlm-offline-baseline-v1','model':'qwen3.8-flash','source':str(baseline),'policy':'One original observation triple per unit, all units in one scene-wide request. First valid answer, at most two protocol repairs. No labels or simulator poses in inference. No claim of online readiness. Historical household default and predictions unchanged.','filesSha256':inventory,'plannedHomeScenes':2,'plannedHssdScenes':6,'validHssdScenes':5,'knownLimitations':['One scene merges distinct regions; retain failure','Open-space granularity and boundary uncertainty','Same-model reference labels are not accepted ground truth','Single-run variability; no favorable-repeat selection']}
    target=Path('docs/research/pure-vlm-offline-baseline-v1.json')
    if target.exists():
        if json.loads(target.read_text(encoding='utf8'))!=contract:raise ValueError('Frozen baseline changed; do not overwrite')
    else:target.write_text(json.dumps(contract,ensure_ascii=False,indent=2),encoding='utf8')
    current=json.loads((baseline/'summary.json').read_text(encoding='utf8'))
    old=json.loads((earlier/'summary.json').read_text(encoding='utf8'))
    rows=[]
    for arm in ['single-observation','time-2','time-4','visual-cap-4']:
        selected=[]
        if arm in current['arms']:
            selected=[r['arms'][arm] for n,r in current['cases'].items() if n.startswith('hssd-') and 'arms' in r]
        else:selected=[r['arms'][arm] for r in old['cases'].values() if 'arms' in r]
        if len(selected)!=5 or any(r['status']!='completed' for r in selected):raise ValueError('Missing valid scene; preserve denominator')
        budgets=[r.get('budget') or usage(Path(r['inferenceDirectory'])) for r in selected]
        rows.append({'arm':arm,'batch':'latest' if arm in current['arms'] else 'earlier','validScenes':5,'plannedScenes':6,'requests':sum(b['requests'] for b in budgets),'promptTokens':sum(b['promptTokens'] for b in budgets),'completionTokens':sum(b['completionTokens'] for b in budgets),'totalTokens':sum(b['totalTokens'] for b in budgets),'elapsedSeconds':sum(r['elapsedMs'] for r in selected)/1000,'usageComplete':all(b['usagePresentInAllResponses'] for b in budgets)})
    out=Path('run/pure-vlm-baseline-comparison');out.mkdir(exist_ok=True)
    (out/'comparison.json').write_text(json.dumps({'rows':rows,'newApiCalls':0,'caveat':'All arms show all original images: grouping is not image compression. Earlier arms are cross-batch comparisons, not controlled repeated trials. No AI-label accuracy ranking.'},indent=2),encoding='utf8')
    lines=['# 纯VLM离线基线冻结与快速对比','','冻结清单：`docs/research/pure-vlm-offline-baseline-v1.json`，包括原答案、输入图册、提示与实现SHA256。复用已有实验，新增API调用0次。','','|HSSD五有效场景累计|批次|输入token|输出token|总token|请求|秒|','|---|---|---:|---:|---:|---:|---:|']
    for r in rows:lines.append(f"|{r['arm']}|{r['batch']}|{r['promptTokens']}|{r['completionTokens']}|{r['totalTokens']}|{r['requests']}|{r['elapsedSeconds']:.1f}|")
    lines.extend(['','## 决策','','采用逐观察全图VLM作为离线地点组织基线，不再以复杂预分组为默认研究前提。所有方案展示全部原图，不能验证代表图压缩的节省；分块减少单元并不等于减少视觉输入。旧批次不能用于精确质量/耗时因果比较。保留第六例采集失败、明确区域误合并、原始答案和重复波动，不以AI标签一致率排胜负。','','暂不追加预算网格实验。视觉分组省预算的优势目前未证明；若产品实际token/延迟成为瓶颈，再将均匀采样与代表图压缩按相同预算比较。','','## 转向产品（未宣称已上线）','','1. 梳理当前采集→地点记忆→RequestAgent链路，明确离线基线如何作为后台整理而非阻塞每次请求。','2. 小规模真实设备验收：采集可靠、保存/重启恢复、历史图像可追溯、新轨迹重访。','3. 未知/失败拒绝，区域候选创建、误合并可逆拆分，用户纠正能持久化。','4. 配置API预算、调用限流、超时和失败降级，记录实际成本和请求延迟。','5. 家庭旧成功数据保持回归；真实新增轨迹确认后再切换默认，不自动覆盖历史。'])
    Path('docs/research/pure-vlm-baseline-quick-comparison.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
    print(json.dumps(rows,indent=2))


if __name__=='__main__':main()
