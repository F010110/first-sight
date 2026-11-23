"""WSL isolated Habitat bootstrap. No restricted dataset access/terms acceptance."""
import argparse
import hashlib
import json
import platform
import subprocess
import tarfile
import urllib.request
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path('run/habitat-runtime'))
    parser.add_argument('--env-name', default='env', help='Single directory name under root')
    parser.add_argument('--with-bullet', action='store_true', help='Install articulated/rigid physics support')
    args = parser.parse_args()
    if platform.system() != 'Linux' or platform.machine() != 'x86_64':
        raise SystemExit('Use x86_64 Linux/WSL, not Windows Python')
    if Path(args.env_name).name != args.env_name or args.env_name in {'.', '..'}:
        raise ValueError('Require a single environment directory name')
    root = args.root.resolve(); root.mkdir(parents=True, exist_ok=True)
    binary = root / 'bin/micromamba'
    if not binary.exists():
        archive = root / 'micromamba-linux-64.tar.bz2'
        urllib.request.urlretrieve('https://micro.mamba.pm/api/micromamba/linux-64/latest', archive)
        with tarfile.open(archive) as file:
            member = file.getmember('bin/micromamba')
            if not member.isfile():
                raise ValueError('Expected a regular binary')
            file.extract(member, root, filter='data')
        binary.chmod(0o755)
        (root / 'bootstrap.json').write_text(json.dumps({'source': 'https://micro.mamba.pm/api/micromamba/linux-64/latest', 'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest()}, indent=2))
    prefix = root / args.env_name
    packages = ['python=3.9', 'habitat-sim=0.3.3', 'headless', 'numpy<2', 'imageio-ffmpeg', 'pillow',
                'libopengl', 'libegl']
    if args.with_bullet:
        packages.append('withbullet')
    subprocess.run([str(binary), '--root-prefix', str(root / 'mamba'), 'create', '--yes', '--prefix', str(prefix),
                    '--override-channels', '-c', 'conda-forge', '-c', 'aihabitat', *packages], check=True)
    with (root / 'environment-explicit.txt').open('w') as file:
        subprocess.run([str(binary), 'list', '--prefix', str(prefix), '--explicit'], stdout=file, check=True)
    subprocess.run([str(prefix / 'bin/python'), '-c', 'import habitat_sim; print("Habitat import OK", habitat_sim.__version__)'], check=True)
    print('Ready for smoke render (import is not GPU-render verification):', prefix)


if __name__ == '__main__':
    main()
