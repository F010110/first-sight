"""Extract local GLBs safely and freeze the archive-matched official QA subset."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import tarfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    archive = ROOT / 'data/hm3d-minival-glb-v0.2.tar'
    target = ROOT / 'data/hm3d-minival-glb-v0.2'
    target.mkdir(parents=True, exist_ok=True)
    files = []
    with tarfile.open(archive) as stream:
        for member in stream.getmembers():
            relative = PurePosixPath(member.name)
            if relative.is_absolute() or '..' in relative.parts or '\\' in member.name:
                raise ValueError('Unsafe archive path')
            if member.isdir():
                continue
            if not member.isfile() or relative.suffix != '.glb':
                raise ValueError('Unexpected archive member')
            destination = target.joinpath(*relative.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            source = stream.extractfile(member)
            if source is None:
                raise ValueError('Missing member stream')
            if destination.exists():
                incoming = hashlib.sha256(source.read()).hexdigest()
                if hashlib.sha256(destination.read_bytes()).hexdigest() != incoming:
                    raise ValueError('Refusing to overwrite different existing asset')
            else:
                with destination.open('xb') as out:
                    shutil.copyfileobj(source, out)
            files.append({'path': str(relative), 'bytes': destination.stat().st_size,
                          'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()})
    scenes = {f['path'].split('/')[0] for f in files}
    original = ROOT / 'vendor/3d-mem/data/aeqa_questions-184.json'
    questions = json.loads(original.read_text())
    subset = [q for q in questions if q['episode_history'] in scenes]
    output = ROOT / 'data/hm3d-minival-eqa-subset'
    output.mkdir(exist_ok=True)
    (output / 'questions.json').write_text(json.dumps(subset, indent=2), encoding='utf-8')
    manifest = {'protocol': 'archive-matched A-EQA subset, raw GLB + regenerated navmesh adaptation',
                'selection': 'all official 184 questions whose episode_history exists in provided archive; no performance filtering',
                'questionCount': len(subset), 'sceneIds': sorted({q['episode_history'] for q in subset}),
                'questionIds': [q['question_id'] for q in subset], 'assets': files,
                'upstreamQuestionsSha256': hashlib.sha256(original.read_bytes()).hexdigest(),
                'missing': ['basis GLBs', 'official navmesh', 'semantic meshes and instance annotations'],
                'status': 'extracted/subset frozen only; start poses and regenerated navmeshes not yet validated'}
    (ROOT / 'reports/hm3d-minival-subset-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print('Extracted', len(files), 'GLBs; froze', len(subset), 'questions across', len(manifest['sceneIds']), 'scenes')


if __name__ == '__main__':
    main()
