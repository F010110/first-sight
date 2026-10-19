"""Video-priority queue: reuse captures, collect missing scenes, no VLM calls."""
import json
import subprocess
import sys
import time
from pathlib import Path
from sim.hssd.download_hssd import SCENES


def main():
    root = Path('run/hssd-six-v1'); root.mkdir(exist_ok=True)
    cwd = '/mnt/'+str(Path.cwd())[0].lower()+str(Path.cwd()).replace('\\','/')[2:]
    failures = []
    subprocess.run([sys.executable,'-m','sim','build_hssd_video_review'],check=True)
    for scene in SCENES:
        work = root/scene; work.mkdir(exist_ok=True)
        if list(work.glob('attempt-*/capture/manifest.json')):
            continue
        attempt = work/f'attempt-video-{time.time_ns()}'; attempt.mkdir()
        capture = attempt/'capture'
        target = '/mnt/'+str(capture.resolve())[0].lower()+str(capture.resolve()).replace('\\','/')[2:]
        try:
            retry_args = ['--avoid-small-targets','--start-region-offset','1','--seed','20261013'] if list(work.glob('attempt-*/capture/capture-failure.json')) else []
            with (attempt/'capture.log').open('w',encoding='utf8') as log:
                subprocess.run(['wsl','-d','Ubuntu','--cd',cwd,'--','env','GALLIUM_DRIVER=d3d12','MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA','run/habitat-runtime/env/bin/python','-m','sim','record_hssd',scene,target,*retry_args],stdout=log,stderr=subprocess.STDOUT,check=True)
            subprocess.run([sys.executable,'-m','sim','audit_hssd_capture',str(capture),str(attempt/'capture-audit.json')],check=True)
            (attempt/'capture-complete.json').write_text(json.dumps({'log':str(attempt/'capture.log'),'scope':'capture-only; inference pending'}))
            (attempt/'capture-audit-complete.json').write_text(json.dumps({'passed':True}))
            # Full testing can resume later from this successful capture.
            (work/'attempt-path.json').write_text(json.dumps({'path':str(attempt)}))
        except Exception as error:
            failures.append({'sceneId':scene,'attempt':str(attempt),'exceptionType':type(error).__name__})
            (attempt/'failure.json').write_text(json.dumps(failures[-1]))
        subprocess.run([sys.executable,'-m','sim','build_hssd_video_review'],check=True)
    (root/'video-preparation.json').write_text(json.dumps({'failures':failures,'scope':'Video first; region inference queue paused'},indent=2))
    print(json.dumps({'videoQueueFinished':True,'failures':failures}))


if __name__ == '__main__':
    main()
