"""WSL isolated Habitat bootstrap. No restricted dataset access/terms acceptance."""
import argparse
import hashlib
import json
import subprocess
import tarfile
import urllib.request
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path('run/habitat-runtime'))
    args = parser.parse_args()
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
    prefix = root / 'env'
    subprocess.run([str(binary), '--root-prefix', str(root / 'mamba'), 'create', '--yes', '--prefix', str(prefix),
                    '--override-channels', '-c', 'conda-forge', '-c', 'aihabitat', 'python=3.9', 'habitat-sim=0.3.3', 'headless', 'numpy<2', 'imageio-ffmpeg'], check=True)
    with (root / 'environment-explicit.txt').open('w') as file:
        subprocess.run([str(binary), 'list', '--prefix', str(prefix), '--explicit'], stdout=file, check=True)
    subprocess.run([str(prefix / 'bin/python'), '-c', 'import habitat_sim; print("Habitat import OK", habitat_sim.__version__)'], check=True)
    print('Ready for smoke render (import is not GPU-render verification):', prefix)


if __name__ == '__main__':
    main()
