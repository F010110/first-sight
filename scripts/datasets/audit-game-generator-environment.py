"""Read-only known Steam-library audit and bounded official documentation receipts.

No game purchases, downloads, launches, login inspection or addon installation.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import urllib.request

SOURCES = {
    'gmod-render-view.html': 'https://wiki.facepunch.com/gmod/render.RenderView',
    'gmod-capture.html': 'https://wiki.facepunch.com/gmod/render.Capture',
    'gmod-push-target.html': 'https://wiki.facepunch.com/gmod/render.PushRenderTarget',
    'gmod-view-data.html': 'https://wiki.facepunch.com/gmod/Structures/ViewData',
    'gmod-render-target.html': 'https://wiki.facepunch.com/gmod/Global.GetRenderTargetEx',
    'inzoi-lua.html': 'https://mod-docs.playinzoi.com/docs/modkit-docs/wiki/luaapi/',
    'inzoi-scene-capture.html': 'https://mod-docs.playinzoi.com/docs/modkit-docs/wiki/luaapi/b1/classes/ab1scenecapture2d/',
    'inzoi-cli.html': 'https://mod-docs.playinzoi.com/docs/modkit-docs/wiki/cli/',
    'inzoi-camera.html': 'https://mod-docs.playinzoi.com/docs/modkit-docs/wiki/cli/camera/camera-get-view',
    'inzoi-screenshot.html': 'https://mod-docs.playinzoi.com/docs/modkit-docs/wiki/cli/screenshot/screenshot-capture',
    'inzoi-screenshot-status.html': 'https://mod-docs.playinzoi.com/docs/modkit-docs/wiki/cli/screenshot/screenshot-get-last',
}

def steam_libraries(roots):
    found = set(Path(p) for p in roots if Path(p).is_dir())
    for root in list(found):
        file = root / 'steamapps/libraryfolders.vdf'
        if file.exists():
            for path in re.findall(r'"path"\s*"([^"]+)"', file.read_text(encoding='utf8')):
                found.add(Path(path.replace('\\\\', '\\')))
    return sorted(found, key=str)

def inspect_libraries(roots):
    libraries = steam_libraries(roots)
    games = []
    for app, name in [('4000', 'Garrys Mod'), ('2456740', 'inZOI')]:
        installs = []
        for library in libraries:
            manifest = library / f'steamapps/appmanifest_{app}.acf'
            if manifest.exists():
                text = manifest.read_text(encoding='utf8')
                folder = re.search(r'"installdir"\s*"([^"]+)"', text)
                build = re.search(r'"buildid"\s*"([^"]+)"', text)
                path = library / 'steamapps/common' / folder[1] if folder else None
                installs.append({'manifest': str(manifest), 'installPath': str(path) if path else None,
                                 'directoryExists': bool(path and path.is_dir()), 'buildId': build[1] if build else None})
        games.append({'appId': app, 'name': name, 'installs': installs,
                      'status': 'manifest-found-runtime-unverified' if installs else 'not-found-in-inspected-libraries'})
    return {'libraries': [str(p) for p in libraries], 'games': games,
            'coverage': 'Known Steam roots plus declared libraryfolders; not an exhaustive disk scan or ownership check.'}

def main(output, roots, source_cap=1_000_000):
    output.mkdir(parents=True, exist_ok=False)
    def fetch(pair):
        name, url = pair
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'FirstSight-generator-audit/1'}), timeout=25) as response:
                raw = response.read(source_cap + 1)
            if len(raw) > source_cap:
                raise ValueError(f'{source_cap} byte/source cap exceeded')
            (output / name).write_bytes(raw)
            return {'url': url, 'file': name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'status': 'retrieved'}
        except Exception as error:
            return {'url': url, 'status': 'failed', 'error': str(error)}
    with ThreadPoolExecutor(max_workers=3) as pool:
        sources = list(pool.map(fetch, SOURCES.items()))
    result = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), **inspect_libraries(roots),
              'freeBytes': {p: shutil.disk_usage(p).free for p in ['C:\\', 'D:\\'] if Path(p).exists()},
              'sources': sources, 'sourceCapBytes': source_cap, 'gameBinariesDownloaded': False, 'runtimeTested': False, 'modelCalls': 0}
    (output / 'audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--steam-root', type=Path, action='append')
    parser.add_argument('--source-cap', type=int, choices=[1_000_000, 5_000_000], default=1_000_000)
    args = parser.parse_args()
    roots = args.steam_root or [Path(os.environ.get('ProgramFiles(x86)', 'C:/Program Files (x86)')) / 'Steam', Path('D:/SteamLibrary'), Path('D:/Steam')]
    main(args.output, roots, args.source_cap)
