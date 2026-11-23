"""Collect one pinned, bounded complete TartanGround triple for existing simulation replay."""
import argparse
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
import shutil
import time
import urllib.request
import zipfile

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for part in iter(lambda:stream.read(4*1024*1024),b''): h.update(part)
    return h.hexdigest()

def fetch(row, revision, target):
    partial=target.with_suffix('.zip.partial')
    url=f'https://huggingface.co/datasets/theairlabcmu/TartanGround/resolve/{revision}/{row["path"]}'
    for attempt in range(4):
        offset=partial.stat().st_size if partial.exists() else 0
        try:
            if offset<row['size']:
                headers={'Accept-Encoding':'identity'}
                if offset:headers['Range']=f'bytes={offset}-'
                request=urllib.request.Request(url+f'?resume={offset}',headers=headers)
                with urllib.request.urlopen(request,timeout=60) as response:
                    if offset and (response.status!=206 or not response.headers.get('Content-Range','').startswith(f'bytes {offset}-')):
                        raise ValueError('Resume range rejected')
                    with partial.open('ab') as output:
                        while True:
                            part=response.read(1024*1024)
                            if not part:break
                            offset+=len(part)
                            if offset>row['size']:raise ValueError('Response exceeds pinned size')
                            output.write(part)
            if partial.stat().st_size!=row['size']:raise OSError('Incomplete download')
            if sha(partial)!=row['lfs']['oid']:raise ValueError('Pinned SHA256 mismatch')
            partial.rename(target)
            print(json.dumps({'downloaded':target.name,'bytes':row['size']}),flush=True)
            return target
        except (OSError,TimeoutError) as error:
            if attempt==3:raise
            print(json.dumps({'retry':target.name,'attempt':attempt+1,'error':type(error).__name__}),flush=True)
            time.sleep(2)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-index',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--replay',type=Path,required=True)
    p.add_argument('--trajectory',default='P0001',choices=['P0001','P0006'])
    p.add_argument('--metadata',type=Path,required=True)
    p.add_argument('--max-download-mib',type=int,default=2048)
    args=p.parse_args()
    from PIL import Image
    index=json.loads(args.source_index.read_text())
    environment,trajectory='ModernCityDowntown',args.trajectory
    prefix=f'{environment}/Data_omni/{trajectory}/'
    rows=[next(r for r in index['files'] if r.get('path')==prefix+f'image_lcam_{view}.zip') for view in ['front','left','right']]
    if not 1<=args.max_download_mib<=3072:raise ValueError('Download cap must be at most 3GiB')
    if sum(r['size'] for r in rows)>args.max_download_mib*1024**2:raise ValueError('Explicit download cap exceeded')
    metadata_row=next(r for r in index['files'] if r.get('path')==prefix+'metadata.zip')
    if args.metadata.stat().st_size!=metadata_row['size'] or sha(args.metadata)!=metadata_row['lfs']['oid']:raise ValueError('Metadata pinned hash/size mismatch')
    with zipfile.ZipFile(args.metadata) as metadata_archive:
        metadata=json.loads(metadata_archive.read(trajectory+'_metadata.json'))
    expected_frames=metadata['num_poses'];step=metadata['time_step']
    if not isinstance(expected_frames,int) or expected_frames<2 or step!=0.1:raise ValueError('Unexpected frame schedule')
    root=args.output;root.mkdir(parents=True,exist_ok=False)
    replay=args.replay;replay.mkdir(parents=True,exist_ok=False)
    public=replay/'public';(public/'frames').mkdir(parents=True)
    (replay/'private').mkdir()
    plan={'revision':index['revision'],'environment':environment,'trajectory':trajectory,'files':rows,'bytes':sum(r['size'] for r in rows),'modelCalls':0,'complete':False}
    (root/'receipt.json').write_text(json.dumps(plan,indent=2))
    archives=[]
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            paths=list(pool.map(lambda row:fetch(row,index['revision'],root/Path(row['path']).name),rows))
        for path in paths:archives.append(zipfile.ZipFile(path))
        names=[sorted(n for n in archive.namelist() if n.lower().endswith('.png')) for archive in archives]
        counts=[len(n) for n in names]
        if len(set(counts))!=1 or counts[0]!=expected_frames:raise ValueError('Image count does not match screened metadata')
        # Match source frame numbers, not just archive order.
        numbers=[[Path(n).name.split('_')[0] for n in files] for files in names]
        if numbers[0]!=numbers[1] or numbers[0]!=numbers[2] or len(set(numbers[0]))!=counts[0]:raise ValueError('Camera source indices mismatch')
        with (public/'observations.jsonl').open('w',encoding='utf8') as out:
            for i in range(counts[0]):
                frames=[]
                for view,archive,files in zip(['front','left','right'],archives,names):
                    info=archive.getinfo(files[i])
                    if info.file_size>8*1024*1024:raise ValueError('Oversized frame')
                    data=archive.read(files[i])  # verifies member CRC
                    image=Image.open(io.BytesIO(data));image.load()
                    if image.size!=(640,640):raise ValueError('Unexpected image dimensions')
                    name=f'{i:06d}-{view}.png';(public/'frames'/name).write_bytes(data)
                    frames.append({'view':view,'path':'frames/'+name,'sha256':hashlib.sha256(data).hexdigest()})
                out.write(json.dumps({'id':f'frame-{i:06d}','sourceAtMs':i*100,'frames':frames})+'\n')
                if i%200==0:print(json.dumps({'verifiedTripleFrames':i+1,'total':counts[0]}),flush=True)
        # Render a standard browser video too, without interpolation or duration fabrication.
        import imageio_ffmpeg,subprocess,re
        ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
        for view in ['front','left','right']:
            video=root/(view+'-10fps.mp4')
            with (root/(view+'-video-encode.log')).open('wb') as log:
                subprocess.run([ffmpeg,'-nostdin','-n','-framerate','10','-i',str(public/('frames/%06d-'+view+'.png')),'-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(video)],stderr=log,stdout=subprocess.DEVNULL,check=True)
            result=subprocess.run([ffmpeg,'-hide_banner','-xerror','-i',str(video),'-map','0:v:0','-f','null','-'],capture_output=True,text=True)
            (root/(view+'-video-full-decode.log')).write_text(result.stderr,encoding='utf8')
            decoded=re.findall(r'frame=\s*(\d+)',result.stderr)
            if result.returncode or not decoded or int(decoded[-1])!=counts[0]:raise ValueError('MP4 full decode/frame count failed')
        plan['complete']=True;plan['observations']=counts[0];plan['imageCount']=counts[0]*3
        (root/'receipt.json').write_text(json.dumps(plan,indent=2))
        shutil.copyfile(root/'receipt.json',replay/'private/source-receipt.json')
        seconds=counts[0]/10;span=(counts[0]-1)/10;average=metadata['path_length']/span
        manifest={'schema':'three-view-render-input-v1','title':f'TartanGround · 现代市区 {trajectory} · 连续三摄 {int(seconds)//60}分{round(seconds%60)}秒','scope':f'原始仿真三方向图像640×640/10Hz，{counts[0]}组，首末帧跨度{span:.1f}秒（帧数时长{seconds:.1f}秒），元数据平均速度约{average:.2f}米/秒；完整三路ZIP SHA256、逐帧CRC/解码、源索引对齐和三路MP4完整解码通过。机器人轨迹，非视障真人步行；不展示位姿/标签/答案，无模型结果或准确率。来源theairlabcmu/TartanGround，CC BY 4.0；Patel et al., TartanGround, IROS 2025。','observations':counts[0],'scoreEligible':False,'source':'TartanGround'}
        (public/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps({'ready':str(public),'observations':counts[0],'images':counts[0]*3,'video':str(root/'front-10fps.mp4')}),flush=True)
    except Exception as error:
        (root/'failure.json').write_text(json.dumps({'error':str(error),'complete':False},indent=2));raise
    finally:
        for archive in archives:archive.close()

if __name__=='__main__':main()
