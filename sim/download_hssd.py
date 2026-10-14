"""Download complete pinned rigid scene dependencies; atomic files and hash audit."""
import concurrent.futures
import hashlib
import json
import posixpath
import subprocess
import time
import urllib.request
from pathlib import Path

from catalog_hssd import REVISION

SCENES = ['108736779_177263484', '107734188_176000034', '105515151_173104068',
          '105515184_173104128', '103997445_171030492', '102816051']
ROOT = Path('run/hssd-data')


def download(path):
    target = ROOT / path
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(3):
            try:
                with urllib.request.urlopen(f'https://huggingface.co/datasets/hssd/hssd-hab/resolve/{REVISION}/{path}', timeout=30) as source, target.with_suffix(target.suffix+'.partial').open('wb') as sink:
                    while True:
                        block = source.read(1024*1024)
                        if not block:
                            break
                        sink.write(block)
                target.with_suffix(target.suffix+'.partial').replace(target)
                break
            except Exception:
                if attempt == 2:
                    subprocess.run(['curl.exe','--location','--fail','--silent','--show-error','--retry','3','--connect-timeout','20','--max-time','600','--output',str(target.with_suffix(target.suffix+'.partial')),f'https://huggingface.co/datasets/hssd/hssd-hab/resolve/{REVISION}/{path}'],check=True)
                    target.with_suffix(target.suffix+'.partial').replace(target)
                    break
                time.sleep(2**attempt)
    return target


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    repo = json.loads(Path('run/hssd-catalog-v1/repository.json').read_text())
    inventory = {f['rfilename'] for f in repo['siblings']}
    handles = {posixpath.basename(p).removesuffix('.object_config.json'):p for p in inventory if p.endswith('.object_config.json')}
    # Prefetch each unique referenced config concurrently, never thousands of
    # serial connections. Failure inventory is retained before dependency parsing.
    initial = {'hssd-hab.scene_dataset_config.json','semantics/hssd-hab_semantic_lexicon.json'}
    for scene_id in SCENES:
        scene_path = f'scenes/{scene_id}.scene_instance.json'
        scene = json.loads(download(scene_path).read_text())
        initial.update([scene_path, scene['stage_instance']['template_name']+'.stage_config.json', f'semantics/scenes/{scene_id}.semantic_config.json'])
        initial.update(handles[row['template_name']] for row in scene['object_instances'])
    print(f'Prefetching {len(initial)} unique configs',flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(download,p):p for p in sorted(initial)}
        failures = []
        for future in concurrent.futures.as_completed(futures):
            try:
                future.result()
            except Exception as error:
                failures.append({'path':futures[future],'exceptionType':type(error).__name__})
        if failures:
            (ROOT/f'config-failures-{time.time_ns()}.json').write_text(json.dumps(failures,indent=2))
            raise RuntimeError('Configuration download incomplete; saved failure inventory')
    configs = set(); dependencies = set(); scene_dependencies = {}
    def config(path):
        if path not in inventory:
            raise ValueError('Missing dependency: '+path)
        configs.add(path)
        data = json.loads(download(path).read_text())
        for key in ['render_asset', 'collision_asset', 'semantic_asset']:
            if data.get(key):
                asset = posixpath.normpath(posixpath.join(posixpath.dirname(path), data[key]))
                if asset not in inventory or asset.startswith('../'):
                    raise ValueError('Unresolved asset: '+asset)
                dependencies.add(asset)
        return data
    for scene_id in SCENES:
        before = configs | dependencies
        scene = config(f'scenes/{scene_id}.scene_instance.json')
        if scene.get('articulated_object_instances'):
            raise ValueError('Articulated dependencies require explicit support')
        config(scene['stage_instance']['template_name']+'.stage_config.json')
        for row in scene['object_instances']:
            handle = row['template_name']
            if handle not in handles:
                raise ValueError('Unknown object handle: '+handle)
            config(handles[handle])
        config(f'semantics/scenes/{scene_id}.semantic_config.json')
        scene_dependencies[scene_id] = {'objects':len(scene['object_instances']), 'newPaths':sorted((configs|dependencies)-before)}
    config('hssd-hab.scene_dataset_config.json')
    config('semantics/hssd-hab_semantic_lexicon.json')
    paths = sorted(configs|dependencies)
    manifest = {'revision':REVISION, 'scenes':SCENES, 'license':'CC BY-NC 4.0', 'source':'https://3dlg-hcvc.github.io/hssd/', 'paths':paths, 'sceneDependencies':scene_dependencies, 'complete':False}
    (ROOT/'download-manifest.json').write_text(json.dumps(manifest,indent=2))
    print(f'Dependency closure: {len(configs)} configs, {len(dependencies)} assets',flush=True)
    failures = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(download,p):p for p in paths}
        for index, future in enumerate(concurrent.futures.as_completed(futures),1):
            try:
                future.result()
            except Exception as error:
                failures.append({'path':futures[future], 'exceptionType':type(error).__name__})
            if index % 50 == 0:
                print(f'{index}/{len(paths)} completed; failures={len(failures)}',flush=True)
    manifest['files'] = []
    for p in paths:
        file = ROOT/p
        if file.exists():
            digest = hashlib.sha256()
            with file.open('rb') as stream:
                for block in iter(lambda:stream.read(1024*1024),b''):
                    digest.update(block)
            manifest['files'].append({'path':p,'bytes':file.stat().st_size,'sha256':digest.hexdigest()})
    manifest.update(failures=failures, complete=not failures, totalBytes=sum(f['bytes'] for f in manifest['files']))
    (ROOT/'download-manifest.json').write_text(json.dumps(manifest,indent=2))
    print(json.dumps({'complete':manifest['complete'],'files':len(manifest['files']),'bytes':manifest['totalBytes'],'failures':failures},indent=2))
    if failures:
        raise RuntimeError('Incomplete assets; see manifest')


if __name__ == '__main__':
    main()
