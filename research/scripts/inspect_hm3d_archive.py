"""Read archive metadata and compare scene coverage; no extraction or cloud upload."""
import hashlib
import json
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    archive = ROOT / 'data/hm3d-minival-glb-v0.2.tar'
    with tarfile.open(archive, 'r:*') as stream:
        members = stream.getmembers()
    files = [m for m in members if m.isfile()]
    scenes = sorted({m.name.split('/')[0] for m in files})
    comparisons = {}
    for name in ('aeqa_questions-41.json', 'aeqa_questions-184.json'):
        questions = json.loads((ROOT / 'vendor/3d-mem/data' / name).read_text())
        matches = [q for q in questions if q.get('episode_history') in scenes]
        comparisons[name] = {'questions': len(questions),
                              'matchedQuestions': len(matches),
                              'matchedScenes': sorted({q['episode_history'] for q in matches}),
                              'requiredScenes': sorted({q['episode_history'] for q in questions})}
    digest = hashlib.sha256()
    with archive.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    report = {'archive': archive.name, 'bytes': archive.stat().st_size,
              'sha256': digest.hexdigest(), 'scope': 'local inspection only; checksum not verified against official manifest',
              'files': [{'name': m.name, 'bytes': m.size} for m in files],
              'scenes': scenes, 'aeqaCoverage': comparisons,
              'hasBasisGlb': any(m.name.endswith('.basis.glb') for m in files),
              'hasNavmesh': any(m.name.endswith('.navmesh') for m in files),
              'hasSemantics': any('.semantic.' in m.name for m in files)}
    (ROOT / 'reports/hm3d-minival-archive-inspection.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k not in ('files', 'aeqaCoverage')}, indent=2))
    for name, value in comparisons.items():
        print(name, 'matchedQuestions=', value['matchedQuestions'], 'matchedScenes=', value['matchedScenes'])


if __name__ == '__main__':
    main()
