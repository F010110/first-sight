"""Read-only Linux renderer diagnostics; never chmod/usermod or sudo automatically."""
import argparse
import importlib.util
import json
import os
import platform
from pathlib import Path
import sys


def diagnose():
    devices=[]
    for name in ['/dev/dxg','/dev/dri/renderD128','/dev/dri/card0']:
        path=Path(name)
        devices.append({'path':name,'exists':path.exists(),'read':os.access(path,os.R_OK),'write':os.access(path,os.W_OK),'mode':oct(path.stat().st_mode&0o777) if path.exists() else None})
    return {'platform':platform.platform(),'python':sys.executable,'uid':os.getuid() if hasattr(os,'getuid') else None,'groups':os.getgroups() if hasattr(os,'getgroups') else [],'devices':devices,'modules':{name:importlib.util.find_spec(name) is not None for name in ['habitat_sim','ai2thor','numpy','PIL']},'display':{name:os.environ.get(name) for name in ['DISPLAY','WAYLAND_DISPLAY','EGL_PLATFORM','GALLIUM_DRIVER','MESA_D3D12_DEFAULT_ADAPTER_NAME']},'renderDevicePermissionBlocked':any(row['exists'] and not(row['read'] and row['write']) for row in devices if '/dev/dri/' in row['path']),'note':'Permissions are a concrete blocker, not proof that all EGL/driver problems will disappear after repair. No privilege changes performed.'}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path);args=parser.parse_args();result=diagnose()
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        with args.output.open('x',encoding='utf8') as stream:json.dump(result,stream,indent=2)
    print(json.dumps(result,indent=2))
