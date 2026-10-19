"""Validate local manifest, GLB framing and pinned upstream stage LFS hashes."""
import hashlib
import json
import struct
from pathlib import Path

STAGE_SHA256 = {
    '108736779_177263484':'1cb83d3f015e251ff4491f07262a049af9e8c0d27b99aa5e8a4fd1983503e7bd',
    '107734188_176000034':'03d6ffc9010d1abd04f40c13a222ffb01e45496fe77dbab9daf2fe86336264f9',
    '105515151_173104068':'fbf0fca88df7facb1661c27b0fe1b1151a5e839d8af705fd071ea18fed34b16a',
    '105515184_173104128':'57b662197aeb69e41bfb42dc2655b6019b1cd644e8e6d2e70462f583c5c2355a',
    '103997445_171030492':'2b6495ffc1b311bc2312b44cb33a74b55f937b6885c778cea751f4de03d5cb56',
    '102816051':'b05827534eaf69cb3aad10e29f252a945e76fbf68994885dd6889bce6143ce5c'}


def main():
    root = Path('run/hssd-data'); manifest = json.loads((root/'download-manifest.json').read_text())
    if not manifest['complete']:
        raise ValueError('Incomplete dependency closure')
    glbs = 0
    for row in manifest['files']:
        path = root/row['path']; raw = path.read_bytes()
        if len(raw) != row['bytes'] or hashlib.sha256(raw).hexdigest() != row['sha256']:
            raise ValueError('Local hash changed: '+row['path'])
        if path.suffix == '.glb':
            magic,version,size = struct.unpack('<4sII',raw[:12])
            if magic != b'glTF' or version != 2 or size != len(raw):
                raise ValueError('Invalid GLB framing: '+row['path'])
            glbs += 1
        else:
            json.loads(raw)
    for scene,sha in STAGE_SHA256.items():
        if hashlib.sha256((root/f'stages/{scene}.glb').read_bytes()).hexdigest() != sha:
            raise ValueError('Upstream stage LFS SHA mismatch: '+scene)
    report = {'protocol':'hssd-assets-audit-v1','passed':True,'filesVerified':len(manifest['files']),'glbsVerified':glbs,'stageUpstreamHashesVerified':6,'upstreamHashSource':f"https://huggingface.co/api/datasets/hssd/hssd-hab/paths-info/{manifest['revision']}",'objectUpstreamHashesVerified':False,'note':'All local file SHA256 verified; six stages match upstream LFS SHA256. Object files only local download hashes + valid GLB framing, not independent upstream hash verification.'}
    (root/'assets-audit.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))


if __name__ == '__main__':
    main()
