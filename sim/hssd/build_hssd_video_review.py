"""Publish available real videos immediately; missing scenes stay explicit."""
import hashlib
import json
import shutil
from pathlib import Path
from sim.hssd.download_hssd import SCENES

NAMES = ['教室／办公混合候选','多办公区／休息区候选','会议／公共用途候选','图书／办公／住宅混合','吧台／多卧室候选','常规多卧室住宅']


def main():
    output = Path('run/review-site/hssd-videos'); output.mkdir(parents=True,exist_ok=True)
    rows = []
    for scene,name in zip(SCENES,NAMES):
        work = Path('run/hssd-six-v1')/scene
        valid = sorted(p.parent for p in work.glob('attempt-*/capture/manifest.json') if (p.parent.parent/'capture-audit.json').exists() and json.loads((p.parent.parent/'capture-audit.json').read_text(encoding='utf8')).get('passed'))
        row = {'sceneId':scene,'name':name,'ready':False}
        if valid:
            capture = valid[-1]; manifest = json.loads((capture/'manifest.json').read_text(encoding='utf8'))
            video = capture/'motion-24fps.mp4'
            sha = hashlib.sha256(video.read_bytes()).hexdigest()
            target = output/f'{scene}-{sha[:12]}.mp4'
            if not target.exists():
                shutil.copy2(video,target)
            windows = [json.loads(line) for line in (capture/'windows.jsonl').read_text(encoding='utf8').splitlines() if line]
            report_path = capture.parent/'inference/report.json'
            report = json.loads(report_path.read_text(encoding='utf8')) if report_path.exists() else {}
            labels = {}
            for path in sorted(capture.parent.glob('prelabels*/labels.json')):
                labels = {r['observationId']:r for r in json.loads(path.read_text(encoding='utf8'))['labels']}
            samples = [{'id':f'observation-{i+1}','seconds':w['timestampMs']/1000,'aiReview':labels.get(f'observation-{i+1}'),'prediction':report.get('finalAssignments',{}).get(f'observation-{i+1}')} for i,w in enumerate(windows)]
            row.update(ready=True,video=target.name,videoSha256=sha,sampleCount=manifest['samples'],samples=samples,completedRoute=manifest['completedRoute'],sourceCapture=str(capture),durationSeconds=manifest['denseFrames']/24)
        rows.append(row)
    (output/'catalog.json').write_text(json.dumps({'protocol':'hssd-six-video-catalog-v1','scenes':rows},ensure_ascii=False,indent=2),encoding='utf8')
    template = Path(__file__).with_name('hssd_video_review.html').read_text(encoding='utf8')
    template = template.replace('<button id="export">导出全部审核</button>', '<button id="export">导出全部审核</button><a href="results.html">测试结果</a>')
    (output/'index.html').write_text(template,encoding='utf8')
    home = output.parent/'index.html'
    backup = output.parent/'index-before-hssd-video-review.html'
    if home.exists() and not backup.exists():
        shutil.copy2(home,backup)
    from sim.review.build_review_portal import build_portal
    build_portal(output.parent)
    print(json.dumps({'url':'http://127.0.0.1:8879/hssd-videos/','ready':sum(r['ready'] for r in rows),'total':6},ensure_ascii=True))


if __name__ == '__main__':
    main()
