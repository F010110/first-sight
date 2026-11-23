"""Encode actual timed GMod triplets, publish review derivatives in the existing video catalog.

No models, server restarts, invented frames or oracle fields in public manifests.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import shutil
import subprocess
import statistics

import cv2
import imageio_ffmpeg
from PIL import Image, ImageDraw

def load_validator():
    spec = importlib.util.spec_from_file_location('gmod_validate', Path(__file__).with_name('validate-gmod-capture.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

def timeline(rows):
    times = [float(r['sim_time_s']) for r in rows]
    gaps = [b-a for a,b in zip(times,times[1:])]
    if not gaps or any(not math.isfinite(t) for t in times) or min(gaps) <= 0:
        raise ValueError('At least two strictly timed real samples required')
    return gaps + [statistics.median(gaps)]

def main(episode, output, publish_root=None):
    validator = load_validator()
    report = validator.validate(episode, minimum=30)
    if not report['structural_checks_passed']: raise ValueError(report['errors'])
    if shutil.disk_usage(episode).free < 20_000_000_000: raise RuntimeError('20GB space reserve required')
    output.mkdir(parents=True, exist_ok=False)
    (output/'validation.json').write_text(json.dumps(report, indent=2), encoding='utf8')
    rows = [json.loads(line) for line in (episode/'trajectory.jsonl.txt').read_text().splitlines() if line.strip()]
    durations = timeline(rows)
    composites = output/'composites'; composites.mkdir()
    paths = {view: [] for view in ['all','front','left','right']}
    for i,row in enumerate(rows):
        image = Image.new('RGB',(1920,512),'black'); draw=ImageDraw.Draw(image)
        for j,view in enumerate(['front','left','right']):
            path = validator.safe_image(episode, row['cameras'][view]['path'])
            paths[view].append(path)
            with Image.open(path) as frame: image.paste(frame.convert('RGB'),(640*j,32))
            draw.text((640*j+12,8),f'{view.upper()} | source t={row["sim_time_s"]-rows[0]["sim_time_s"]:.3f}s',fill='white')
        path = composites/f'{i:06d}.jpg'; image.save(path,quality=92); paths['all'].append(path)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    scope = ('Garry’s Mod · gm_construct 自带空地图技术测试；脚本正常步行与转向，非生活任务。'
             '三路同回调采集，动态对象严格同步未认证；实际约4.6组三摄/秒，预览10fps按原时间保持画面，无插帧。'
             '无枪/HUD、无模型调用，不展示位姿/答案。')
    titles = {'all':'三摄并排','front':'前摄','left':'左摄','right':'右摄'}
    products = []
    for view,files in paths.items():
        concat = output/f'{view}.ffconcat'
        lines = ['ffconcat version 1.0']
        for path,duration in zip(files,durations):
            text = str(path.resolve()).replace('\\','/')
            if "'" in text: raise ValueError('Unsupported quote in source path')
            lines.extend([f"file '{text}'", f'duration {duration:.9f}'])
        lines.append(f"file '{str(files[-1].resolve()).replace(chr(92), '/')}'")
        concat.write_text('\n'.join(lines)+'\n', encoding='utf8')
        video = output/f'{view}.mp4'
        command = [ffmpeg,'-nostdin','-v','error','-n','-f','concat','-safe','0','-i',str(concat),
                   '-t',f'{sum(durations):.9f}','-r','10','-c:v','libx264','-preset','fast','-crf','20',
                   '-pix_fmt','yuv420p','-movflags','+faststart','-an',str(video)]
        subprocess.run(command,check=True,timeout=120)
        subprocess.run([ffmpeg,'-nostdin','-v','error','-i',str(video),'-f','null','-'],check=True,timeout=60)
        cap = cv2.VideoCapture(str(video)); fps=cap.get(cv2.CAP_PROP_FPS); frames=cap.get(cv2.CAP_PROP_FRAME_COUNT);cap.release()
        if fps <= 0 or frames < 1: raise ValueError('Encoded video metadata unavailable')
        products.append({'view':view,'file':str(video),'title':'Garry’s Mod · '+titles[view]+' · 步行转向测试',
                         'scope':scope,'fps':fps,'frames':int(frames),'durationSeconds':frames/fps,
                         'sha256':hashlib.sha256(video.read_bytes()).hexdigest()})
    receipt = {'episode':str(episode),'source_groups':len(rows),'source_span_s':rows[-1]['sim_time_s']-rows[0]['sim_time_s'],
               'last_frame_hold_s':durations[-1],'products':products,'modelCalls':0,'published':False}
    if publish_root:
        manifest_path = publish_root/'complete.json'
        original = manifest_path.read_bytes(); manifest=json.loads(original)
        if manifest.get('schema') != 'campus-native-video-v1': raise ValueError('Unknown catalog preserved')
        (output/'catalog-before.json').write_bytes(original)
        next_id = max([int(e['episodeNumber']) for e in manifest['episodes']]+[0])+1
        for product in products:
            filename = f'episode-{next_id:02d}.mp4'
            destination = publish_root/filename
            with destination.open('xb') as dest, Path(product['file']).open('rb') as src: shutil.copyfileobj(src,dest)
            manifest['episodes'].append({k:v for k,v in product.items() if k not in ['file','view']} | {
                'episodeNumber':next_id,'src':filename,'source':'GarrysMod','cameraCount':3 if product['view']=='all' else 1,
                'reviewView':product['view'],'sourceGroups':len(rows),'nativeSampleRateClaimed':False})
            product['episodeNumber']=next_id; next_id+=1
        if manifest_path.read_bytes() != original: raise RuntimeError('Catalog changed concurrently; existing catalog not replaced')
        temp = publish_root/'complete.gmod-pending.json'
        with temp.open('x',encoding='utf8') as dest: json.dump(manifest,dest,ensure_ascii=False,indent=2)
        temp.replace(manifest_path)
        receipt['published']=True
    (output/'receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(receipt,ensure_ascii=False,indent=2))

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('episode',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--publish-root',type=Path)
    args=parser.parse_args();main(args.episode,args.output,args.publish_root)
