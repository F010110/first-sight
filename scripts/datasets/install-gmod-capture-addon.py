"""Explicit local addon copy only; does not install/buy/launch Garry's Mod."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

SOURCE = Path(__file__).resolve().parents[2] / 'integrations/gmod/first_sight_capture'

def install(game_root, confirm=False):
    game_root = game_root.resolve()
    content = game_root / 'garrysmod'
    if not (content / 'gameinfo.txt').is_file() or not (content / 'lua').is_dir():
        raise ValueError('Expected an actual GarrysMod install root containing garrysmod/gameinfo.txt and lua/')
    if shutil.disk_usage(game_root).free < 20_000_000_000:
        raise ValueError('Must retain at least 20GB free')
    destination = content / 'addons/first_sight_capture'
    if destination.exists():
        raise FileExistsError('Existing addon preserved; do not overwrite blindly')
    files = [p for p in SOURCE.rglob('*') if p.is_file()]
    receipt = {'source': str(SOURCE), 'destination': str(destination), 'copied': False,
               'files': {p.relative_to(SOURCE).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
               'gameLaunched': False, 'gameDownloaded': False}
    if confirm:
        shutil.copytree(SOURCE, destination)
        receipt['copied'] = True
    return receipt

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game-root', type=Path, required=True)
    parser.add_argument('--confirm-copy', action='store_true')
    args = parser.parse_args()
    print(json.dumps(install(args.game_root, args.confirm_copy), ensure_ascii=False, indent=2))
