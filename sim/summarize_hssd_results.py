"""Explain frozen-input results; no unaccepted semantic labels as accuracy truth."""
import json
import html
from pathlib import Path
import cv2
import numpy as np
from download_hssd import SCENES


def main():
    root = Path('run/hssd-six-v1'); rows = []
    for scene in SCENES:
        work = root/scene
        captures = sorted(p.parent for p in work.glob('attempt-*/capture/manifest.json'))
        row = {'sceneId':scene,'captureAvailable':bool(captures),'regionAccuracy':None,'regionAccuracyStatus':'unmeasured-no-accepted-physical-region-ground-truth'}
        if not captures:
            row['captureFailures'] = [json.loads(p.read_text(encoding='utf8')) for p in work.glob('attempt-*/capture/capture-failure.json')]
            rows.append(row); continue
        capture = captures[-1]; attempt = capture.parent
        manifest = json.loads((capture/'manifest.json').read_text(encoding='utf8'))
        windows = [json.loads(line) for line in (capture/'windows.jsonl').read_text(encoding='utf8').splitlines() if line]
        means = []; sharpness = []
        for window in windows:
            image = cv2.imread(str(capture/'triple'/window['frame']),0)
            if image is None:
                raise ValueError('Missing raw sample image')
            means.append(float(image.mean())); sharpness.append(float(cv2.Laplacian(image,cv2.CV_64F).var()))
        row.update(samples=len(windows),denseFrames=manifest['denseFrames'],completedRoute=manifest['completedRoute'],
                   quality={'meanGray':float(np.mean(means)),'medianSampleGray':float(np.median(means)),
                            'samplesMeanGrayBelow50':sum(x<50 for x in means),'medianLaplacianVariance':float(np.median(sharpness)),
                            'note':'Raw 320px panels; gray<50 is a diagnostic cutoff only, not input acceptance or fidelity score. No enhancement applied.'})
        replay_path = attempt/'online/replay.json'; report_path = attempt/'inference/report.json'
        if replay_path.exists():
            replay = json.loads(replay_path.read_text(encoding='utf8'))
            row.update(localGroups=len(replay['grouping']['groups']),restartRoundtripPassed=replay['restartRoundtripPassed'])
            trace = json.loads((capture/'collector-trace.json').read_text(encoding='utf8'))
            annotations = {f'observation-{i+1}':trace[w['endTick']*12]['collectorRegionIndex'] for i,w in enumerate(windows)}
            row['localGroupsSpanningMultipleCollectorPolygons'] = sum(len({annotations[id] for id in group['observationIds'] if annotations[id] is not None})>1 for group in replay['grouping']['groups'])
            row['polygonDiagnosticWarning'] = 'Collector polygons may divide one continuous physical space into functional zones; this is only a review flag, NOT wrong-merge accuracy or accepted room truth.'
        if report_path.exists():
            report = json.loads(report_path.read_text(encoding='utf8'))
            assigned = report['finalAssignments']; unknown = sum(value is None for value in assigned.values())
            row.update(inferenceCompleted=True,unknownObservations=unknown,unknownFraction=unknown/len(assigned),
                       predictedRegions=len(report['answer']['regions']),uncertainLocalGroups=len(report['answer']['uncertainGroupIds']),
                       boundaryGroups=len(report['boundaryGroups']),imageAnnotations=report['annotationReview']['count'],
                       inferenceSeconds=report['elapsedMs']/1000,protocolAttempts=report['attempts'])
        else:
            row['inferenceCompleted'] = False
        rows.append(row)
    result = {'protocol':'hssd-six-explanatory-results-v1','originalPlannedScenes':6,'captureAvailableScenes':sum(r['captureAvailable'] for r in rows),
              'inferenceCompletedScenes':sum(r.get('inferenceCompleted',False) for r in rows),'rows':rows,
              'limitations':'Unknown rates/engineering completion are not correctness. Collector polygons and AI prelabels are not accepted physical-region truth. Input quality differs from THOR; no matched-quality comparison or hardware latency claim.'}
    (root/'explanatory-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    lines = ['# HSSD首六例：实际测试结果（非准确率验收）','',f"原计划6例，有效视频{result['captureAvailableScenes']}例，身份推理已有{result['inferenceCompletedScenes']}例结果；采集失败不从计划分母删除。",'',
             '|场景|观察点|局部组|预测区域|未知观察|灰度均值|完整回访|','|---|---:|---:|---:|---:|---:|---|']
    for r in rows:
        if not r['captureAvailable']:
            lines.append(f"|{r['sceneId']}|采集失败|—|—|—|—|—|"); continue
        unknown = f"{r['unknownObservations']}/{r['samples']}" if r.get('inferenceCompleted') else '待测'
        lines.append(f"|{r['sceneId']}|{r['samples']}|{r.get('localGroups','待测')}|{r.get('predictedRegions','待测')}|{unknown}|{r['quality']['meanGray']:.1f}|{'是' if r['completedRoute'] else '否'}|")
    lines += ['', '**解读边界**：未知是弃权，不是正确。跨采集polygon仅为人工核查提示，不自动等于跨房间错合并。灰度均值低是偏暗诊断，不是画质标准。', '', '当前渲染偏暗/细节与THOR有差异，不能归因于数据源本身质量或用不同画质比较算法优劣；未调整原图、模型prompt或分组阈值。', '', '尚无被接受的具体物理区域真值，因此正确率未测。AI功能名称与模拟标签只解释场景，不证明具体区域身份。']
    (root/'explanatory-results.md').write_text('\n'.join(lines),encoding='utf8')
    web = Path('run/review-site/hssd-videos'); web.mkdir(parents=True,exist_ok=True)
    body = []
    for r in rows:
        if not r['captureAvailable']:
            values = [r['sceneId'],'采集失败','—','—','—','—','—']
        else:
            unknown = f"{r['unknownObservations']}/{r['samples']}" if r.get('inferenceCompleted') else '待测'
            values = [r['sceneId'],r['samples'],r.get('localGroups','待测'),r.get('predictedRegions','待测'),unknown,f"{r['quality']['meanGray']:.1f}",'是' if r['completedRoute'] else '否']
        body.append('<tr>'+''.join('<td>'+html.escape(str(v))+'</td>' for v in values)+'</tr>')
    page = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>HSSD实际测试结果</title><style>body{font:16px system-ui;margin:24px;background:#111827;color:#e5e7eb}td,th{padding:12px;border-bottom:1px solid #4b5563}a{color:#93c5fd}table{border-collapse:collapse}</style><a href="./">返回视频审核</a><h1>HSSD实际测试：非准确率验收</h1><p>'+html.escape(lines[2])+'</p><table><tr>'+''.join('<th>'+x+'</th>' for x in ['场景','观察点','局部组','预测区域','未知观察','灰度均值','完整回访'])+'</tr>'+''.join(body)+'</table><p>未知是弃权，不是正确；预测一个区域也不代表整个视频确实属于一个房间。HSSD功能区标签和AI建议均未被接受为具体物理区域真值，准确率未测。</p><p>灰度均值仅为偏暗诊断。当前渲染与THOR画质不匹配，不据此比较算法优劣，也不把渲染问题归因于HSSD原始资源质量。测试使用未增强的原图、未改test.5提示词和分组阈值。</p></html>'
    (web/'results.html').write_text(page,encoding='utf8')
    print(json.dumps({k:result[k] for k in ['originalPlannedScenes','captureAvailableScenes','inferenceCompletedScenes']},indent=2))


if __name__ == '__main__':
    main()
