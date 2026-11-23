"""Read-only bounded GMA index inspection; never executes or mounts addon content."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import struct

def inspect(path):
    with path.open('rb') as f:
        def unpack(fmt):
            return struct.unpack(fmt, f.read(struct.calcsize(fmt)))[0]
        def text():
            data = bytearray()
            while True:
                b = f.read(1)
                if not b: raise ValueError('Truncated string')
                if b == b'\0': return data.decode('utf8', 'replace')
                data.extend(b)
                if len(data) > 1000000: raise ValueError('Oversize string')
        if f.read(4) != b'GMAD': raise ValueError('Not GMA')
        version = unpack('<B')
        if version not in (1, 2, 3): raise ValueError('Unsupported GMA version')
        steamid, timestamp = unpack('<Q'), unpack('<Q')
        if version > 1:
            if text(): raise ValueError('Required content present; inspect manually')
        title, description, author = text(), text(), text()
        addon_version = unpack('<I')
        entries = []
        while unpack('<I'):
            name, size, crc = text(), unpack('<q'), unpack('<I')
            p = PurePosixPath(name)
            if '\\' in name or ':' in name or p.is_absolute() or '..' in p.parts or size < 0:
                raise ValueError('Unsafe entry')
            entries.append(dict(path=name, bytes=size, crc32=crc))
            if len(entries) > 100000: raise ValueError('Too many entries')
        offset = f.tell()
        total = sum(e['bytes'] for e in entries)
        if total > 8000000000 or offset + total > path.stat().st_size: raise ValueError('Size budget/truncation')
        for e in entries:
            e['offset'] = offset
            offset += e['bytes']
    digest = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(8*1024*1024), b''): digest.update(chunk)
    suspicious = [e['path'] for e in entries if PurePosixPath(e['path']).suffix.lower() in ('.lua','.dll','.exe','.so','.vdf')]
    return dict(archive=str(path), sha256=digest.hexdigest(), version=version, title=title,
                description=description, author=author, extracted_bytes=total,
                suspicious=suspicious, entries=entries, mounted=False)

if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('archive',type=Path);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();result=inspect(a.archive)
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({k:v for k,v in result.items() if k!='entries'},ensure_ascii=False,indent=2))
