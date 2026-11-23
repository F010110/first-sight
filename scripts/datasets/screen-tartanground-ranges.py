"""Bounded ZIP-range visual screening, not a complete downloaded trajectory or evaluation."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile
import time

class RemoteZip(io.RawIOBase):
    def __init__(self, url, size, budget):
        self.url, self.size, self.budget = url, size, budget
        self.pos, self.transferred = 0, 0
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos+offset if whence == 1 else self.size+offset
        if not 0 <= self.pos <= self.size: raise ValueError('Invalid ZIP seek')
        return self.pos
    def read(self, count=-1):
        count = self.size-self.pos if count < 0 else min(count, self.size-self.pos)
        if count == 0: return b''
        if self.transferred+count > self.budget: raise ValueError('Range budget exceeded')
        start, end = self.pos, self.pos+count-1
        request = urllib.request.Request(self.url+f'?screen_range={start}-{end}', headers={'Range':f'bytes={start}-{end}', 'Accept-Encoding':'identity'})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{self.size}':
                        raise ValueError('Server did not honor exact range; refusing full download')
                    data = response.read(count+1)
                break
            except OSError:
                if attempt == 2: raise
                time.sleep(2)
        if len(data) != count: raise ValueError('Range length mismatch')
        self.pos += count; self.transferred += count
        return data

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-index', type=Path, required=True)
    p.add_argument('--trajectory', default='P0002')
    p.add_argument('--environment', default='ModularNeighborhoodIntExt')
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    from PIL import Image, ImageDraw
    index = json.loads(args.source_index.read_text())
    root = args.output; root.mkdir(parents=True, exist_ok=False)
    rows = []; sheet = Image.new('RGB', (1280, 4*270), '#17201c')
    # First screen front only; do not fetch large three-view packages before suitability review.
    name = f'{args.environment}/Data_omni/{args.trajectory}/image_lcam_front.zip'
    source = next(r for r in index['files'] if r.get('path') == name)
    remote = RemoteZip(f'https://huggingface.co/datasets/theairlabcmu/TartanGround/resolve/{index["revision"]}/{name}', source['size'], 24*1024*1024)
    try:
        with zipfile.ZipFile(remote) as archive:
            files = sorted(n for n in archive.namelist() if n.lower().endswith(('.png','.jpg','.jpeg')))
            if not files: raise ValueError('No images')
            for i in range(16):
                frame = round(i*(len(files)-1)/15); member = files[frame]
                info = archive.getinfo(member)
                if info.file_size > 8*1024*1024: raise ValueError('Unexpected image size')
                data = archive.read(member)  # ZIP member CRC verified, not whole-archive SHA verification.
                image = Image.open(io.BytesIO(data)); image.load()
                filename = f'{frame:06d}-front.png'; (root/filename).write_bytes(data)
                thumb = image.convert('RGB'); thumb.thumbnail((320,240)); x,y = (i%4)*320,(i//4)*270
                sheet.paste(thumb,(x,y)); ImageDraw.Draw(sheet).text((x+5,y+243),f'{args.trajectory} index {frame} / {len(files)}',fill='white')
                rows.append({'index':frame,'member':member,'file':filename,'sha256':hashlib.sha256(data).hexdigest(),'dimensions':list(image.size)})
                print(json.dumps({'frame':frame,'transferred':remote.transferred}),flush=True)
        sheet.save(root/'contact-sheet.jpg')
        (root/'receipt.json').write_text(json.dumps({'revision':index['revision'],'source':name,'sourceBytes':source['size'],'sourceLfsSha256':source['lfs']['oid'],'wholeArchiveVerified':False,'memberCrcVerified':True,'totalImageCount':len(files),'rangeBytes':remote.transferred,'screened':rows,'scoreEligible':False,'modelCalls':0,'notice':'Sparse visual screening only. No full trajectory, route continuity, indoor/outdoor transition or revisit claim.'},indent=2))
    except Exception as error:
        (root/'failure.json').write_text(json.dumps({'error':str(error),'rangeBytes':remote.transferred,'completed':rows},indent=2))
        raise

if __name__ == '__main__': main()
