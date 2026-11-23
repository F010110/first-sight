"""Offline Garry's Mod readiness check; explicit addon copy, never downloads or launches games."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil

HERE = Path(__file__).resolve().parent

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

audit = load('gmod_environment', 'audit-game-generator-environment.py')
installer = load('gmod_installer', 'install-gmod-capture-addon.py')

def prepare(roots, game_root=None, confirm_copy=False):
    discovery = audit.inspect_libraries(roots)
    result = {'schema': 'first-sight-gmod-readiness-v1', 'discovery': discovery,
              'gameDownloaded': False, 'gameLaunched': False, 'modelCalls': 0,
              'status': 'game-not-found', 'addonCopied': False, 'runtimeVerified': False}
    matches = [row for row in discovery['games'][0]['installs'] if row['directoryExists']]
    if game_root is None:
        if len(matches) > 1:
            result['status'] = 'multiple-installs-specify-game-root'
            return result
        if not matches:
            return result
        game_root = Path(matches[0]['installPath'])
    game_root = game_root.resolve()
    content = game_root / 'garrysmod'
    result['gameRoot'] = str(game_root)
    if not (content/'gameinfo.txt').is_file() or not (content/'lua').is_dir():
        result['status'] = 'incomplete-install-or-wrong-root'
        return result
    result['freeBytes'] = shutil.disk_usage(game_root).free
    if result['freeBytes'] < 20_000_000_000:
        result['status'] = 'blocked-free-space-under-20GB'
        return result
    destination = content/'addons/first_sight_capture'
    expected = {p.relative_to(installer.SOURCE).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in installer.SOURCE.rglob('*') if p.is_file()}
    result['sourceHashes'] = expected
    result['addonDestination'] = str(destination)
    if destination.exists():
        actual = {p.relative_to(destination).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in destination.rglob('*') if p.is_file()}
        result['status'] = 'ready-addon-matches-source' if actual == expected else 'blocked-existing-addon-differs-preserved'
        return result
    result['status'] = 'ready-to-copy-addon'
    if confirm_copy:
        receipt = installer.install(game_root, True)
        result['addonCopied'] = receipt['copied']
        result['status'] = 'ready-addon-copied-runtime-unverified'
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game-root', type=Path)
    parser.add_argument('--steam-root', type=Path, action='append')
    parser.add_argument('--confirm-copy', action='store_true')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Output already exists; preserve the previous receipt')
    roots = args.steam_root or [Path(os.environ.get('ProgramFiles(x86)', 'C:/Program Files (x86)'))/'Steam', Path('D:/SteamLibrary'), Path('D:/Steam')]
    # Reserve receipt first, so no addon mutation happens without an audit destination.
    with args.output.open('x', encoding='utf8') as dest:
        result = prepare(roots, args.game_root, args.confirm_copy)
        json.dump(result, dest, ensure_ascii=False, indent=2)
    print(json.dumps(result, ensure_ascii=False, indent=2))
