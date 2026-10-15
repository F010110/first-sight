"""Pinned public archives; resumable partials, hashes, no credentials or installation."""
import hashlib
import json
import urllib.request
from pathlib import Path
import zipfile
import argparse

REV='8dd4f01dbf787c3bb2eac07a48fb42b5b32ac3ce'
FILES={'mansionworld.zip':(3123600013,'af709465dca28ad533f00af9c60dcf259fbf32ef76cc83c3c6566e3f80d378e0'),'mansion_patch.zip':(827054435,'4e0b82d0e2db9aafb68b976ad7dabce080f358f1d2b4f0ff97a51db4ac26776f')}

def main(root):
    root.mkdir(parents=True,exist_ok=True)
    for name,(size,digest) in FILES.items():
        dest=root/name;partial=root/(name+'.partial')
        if not dest.exists():
            offset=partial.stat().st_size if partial.exists() else 0
            request=urllib.request.Request(f'https://huggingface.co/datasets/superbigsaw/MansionWorld/resolve/{REV}/{name}',headers={'Range':f'bytes={offset}-','User-Agent':'spatial-memory-dataset-download'})
            with urllib.request.urlopen(request,timeout=120) as response:
                if response.status==206:
                    if not response.headers.get('Content-Range','').startswith(f'bytes {offset}-'):raise ValueError('Invalid resume response')
                else:offset=0
                with partial.open('ab' if offset else 'wb') as output:
                    while True:
                        block=response.read(4*1024*1024)
                        if not block:break
                        output.write(block)
            if partial.stat().st_size!=size:raise ValueError(f'Unexpected size: {name}')
            check=hashlib.file_digest(partial.open('rb'),'sha256').hexdigest()
            if check!=digest:raise ValueError(f'Hash mismatch: {name}')
            partial.rename(dest)
        with dest.open('rb') as stream:check=hashlib.file_digest(stream,'sha256').hexdigest()
        if dest.stat().st_size!=size or check!=digest:raise ValueError(f'Existing archive mismatch: {name}')
        print(f'Verified {name}',flush=True)
        with zipfile.ZipFile(dest) as archive:
            entries=[{'name':i.filename,'bytes':i.file_size} for i in archive.infolist()]
        (root/(name+'.index.json')).write_text(json.dumps(entries,indent=2),encoding='utf8')
    (root/'download.json').write_text(json.dumps({'revision':REV,'files':FILES,'verified':True,'installed':False,'terms':'Unresolved research-only / CC-BY statements retained; downloading does not resolve permission for cloud processing or redistribution.'},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('output',type=Path);main(p.parse_args().output)
