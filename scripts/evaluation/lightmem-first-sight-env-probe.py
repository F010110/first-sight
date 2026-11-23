"""Read-only environment preflight. Does not import or start either external application."""
import importlib.metadata
import importlib.util
import json
from pathlib import Path
import shutil
import sys

PACKAGES = ['numpy', 'PIL', 'cv2', 'pydantic', 'fastapi', 'openai', 'httpx', 'networkx', 'igraph', 'faiss', 'torch', 'transformers', 'sentence_transformers', 'fcntl']

def main():
    modules = {}
    for name in PACKAGES:
        try:
            modules[name] = importlib.util.find_spec(name) is not None
        except (ImportError, ValueError):
            modules[name] = False
    # Only named, already-known locations. No scanning private user files/model contents.
    candidates = [Path.home()/'miniconda3/envs', Path.home()/'miniforge3/envs', Path.home()/'anaconda3/envs', Path('/opt/conda/envs')]
    environments = []
    for parent in candidates:
        if parent.is_dir():
            environments.extend(str(p/'bin/python') for p in parent.iterdir() if (p/'bin/python').is_file())
    print(json.dumps({'python':sys.version, 'executable':sys.executable, 'modules':modules, 'ffmpeg':shutil.which('ffmpeg'), 'ffprobe':shutil.which('ffprobe'), 'existingEnvironmentPythons':environments, 'applicationImported':False}, indent=2))

if __name__ == '__main__': main()
