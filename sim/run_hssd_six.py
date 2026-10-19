"""Six-scene resumable integration queue; failures retained, never scored as passes."""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from download_hssd import SCENES, ROOT as ASSETS


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,default=Path('run/hssd-six-v1'))
    parser.add_argument('--scene', choices=SCENES, action='append')
    parser.add_argument('--offline-only',action='store_true')
    parser.add_argument('--require-existing-captures',action='store_true',help='Test reviewed raw videos only; do not silently collect replacement trajectories')
    args = parser.parse_args()
    manifest = json.loads((ASSETS/'download-manifest.json').read_text())
    if not manifest['complete']:
        raise ValueError('Assets incomplete; finish download first')
    args.output.mkdir(parents=True,exist_ok=True)
    summary = {'protocol':'hssd-six-integration-v1','scenes':{},'correctness':'unmeasured-awaiting-human-review','originalDenominator':len(args.scene or SCENES),'frozenInference':'test.5 prompt unchanged; qwen3.8-flash; at most 2 protocol repairs','limitations':'Synthetic collection; no hardware latency certification or independently accepted labels.'}
    def save():
        (args.output/'summary.json').write_text(json.dumps(summary,indent=2))
    def run(stage, command, work):
        marker = work/(stage+'-complete.json')
        if marker.exists():
            return
        started = time.perf_counter()
        log = work/(stage+f'-{time.time_ns()}.log')
        with log.open('w',encoding='utf8') as sink:
            subprocess.run(command,stdout=sink,stderr=subprocess.STDOUT,check=True,env={**os.environ,'VLM_PYTHON':sys.executable})
        marker.write_text(json.dumps({'elapsedSeconds':time.perf_counter()-started,'log':str(log)}))
    for scene in args.scene or SCENES:
        work = args.output/scene; work.mkdir(exist_ok=True)
        status = {'status':'running','stage':'capture'}; summary['scenes'][scene] = status; save()
        try:
            if args.require_existing_captures and not list(work.glob('attempt-*/capture/manifest.json')):
                capture_failures = list(work.glob('attempt-*/capture/capture-failure.json'))
                status.update(status='failed' if capture_failures else 'awaiting-capture',stage='capture-not-ready',captureFailureFiles=[str(p) for p in capture_failures],inferencePerformed=False); save(); continue
            # Failed stage outputs are immutable; retries use a new attempt root.
            state_file = work/'attempt-path.json'
            if state_file.exists():
                attempt = Path(json.loads(state_file.read_text())['path'])
                if (attempt/'failure.json').exists():
                    previous_failure = json.loads((attempt/'failure.json').read_text())
                    if previous_failure.get('stage') not in ['independent-prelabels', 'review-package']:
                        attempt = work/f'attempt-{time.time_ns()}'
            else:
                attempt = work/f'attempt-{time.time_ns()}'
            attempt.mkdir(exist_ok=True)
            state_file.write_text(json.dumps({'path':str(attempt)})); status['attempt'] = str(attempt)
            dataset = attempt/'capture'; pipeline = attempt/'pipeline'; online = attempt/'online'
            wsl_output = '/mnt/'+str(dataset.resolve()).replace('\\','/')[0].lower()+str(dataset.resolve()).replace('\\','/')[2:]
            wsl_cwd = '/mnt/'+str(Path.cwd())[0].lower()+str(Path.cwd()).replace('\\','/')[2:]
            run('capture',['wsl','-d','Ubuntu','--cd',wsl_cwd,'--','env','GALLIUM_DRIVER=d3d12','MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA','run/habitat-runtime/env/bin/python','sim/record_hssd.py',scene,wsl_output],attempt)
            status['stage'] = 'capture-audit'; save()
            run('capture-audit',[sys.executable,'sim/audit_hssd_capture.py',str(dataset),str(attempt/'capture-audit.json')],attempt)
            status['stage'] = 'image-memory'; save()
            run('image-memory',[sys.executable,'sim/run_visual_memory_pipeline.py',str(dataset),str(pipeline)],attempt)
            run('online-restart',['node','dist/sim/hssd-memory-replay.js',str(dataset),str(pipeline/'baseline'),str(pipeline/'vo.json'),str(online)],attempt)
            status['stage'] = 'freeze-vlm-evidence'; save()
            run('atlases',[sys.executable,'sim/vlm_group_aggregation_trial.py',str(online/'replay.json'),str(dataset),'unused',str(attempt/'atlases'),'--prepare-only'],attempt)
            if args.offline_only:
                status.update(status='offline-complete',stage='awaiting-vlm'); save(); continue
            status['stage'] = 'test5-inference'; save()
            run('inference',[sys.executable,'sim/vlm_group_identity_annotations_trial.py',str(attempt/'atlases'),str(online/'replay.json'),'unused','unused',str(attempt/'inference'),'--unscored'],attempt)
            status['stage'] = 'independent-prelabels'; save()
            prelabel_state = attempt/'prelabel-path.json'
            prelabels = Path(json.loads(prelabel_state.read_text())['path']) if prelabel_state.exists() else attempt/'prelabels'
            if not (attempt/'prelabels-complete.json').exists() and prelabels.exists():
                prelabels = attempt/f'prelabels-retry-{time.time_ns()}'
            prelabel_state.write_text(json.dumps({'path':str(prelabels)}))
            run('prelabels',[sys.executable,'sim/prelabel_hssd.py',str(dataset),str(prelabels)],attempt)
            status['stage'] = 'review-package'; save()
            site = Path('run/review-site')/f'hssd-{scene}-{attempt.name}'
            run('review',[sys.executable,'sim/build_region_review_site.py',str(dataset),str(attempt/'inference/report.json'),str(site),'--labels',str(prelabels/'labels.json'),'--dense-video',str(dataset/'motion-24fps.mp4'),'--dataset-id',f'hssd-{scene}'],attempt)
            subprocess.run([sys.executable,'sim/build_review_portal.py','run/review-site'],check=True)
            capture = json.loads((dataset/'manifest.json').read_text())
            report = json.loads((attempt/'inference/report.json').read_text(encoding='utf-8'))
            status.update(status='integration-complete-awaiting-human',stage='done',samples=capture['samples'],completedRoute=capture['completedRoute'],reportSha256=hashlib.sha256((attempt/'inference/report.json').read_bytes()).hexdigest(),score=report['score'],reviewDirectory=str(site))
            subprocess.run([sys.executable,'sim/build_hssd_video_review.py'],check=True)
        except Exception as error:
            status.update(status='failed',exceptionType=type(error).__name__)
            if 'attempt' in status:
                (Path(status['attempt'])/'failure.json').write_text(json.dumps(status,indent=2))
            print(f'{scene}: {status["stage"]} FAILED ({type(error).__name__})',flush=True)
        save()
        print(json.dumps({scene:status}),flush=True)
    summary['integrationCompleted'] = sum(s['status']=='integration-complete-awaiting-human' for s in summary['scenes'].values())
    summary['failed'] = sum(s['status']=='failed' for s in summary['scenes'].values())
    save()
    print(json.dumps(summary,indent=2))


if __name__ == '__main__':
    main()
