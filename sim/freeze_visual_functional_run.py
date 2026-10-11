"""Freeze current implementation/report hashes separately from raw data hash list."""
import hashlib
import json
from pathlib import Path

def main():
    paths=[Path('docs/experiments/visual-pipeline-dataset-v1.json')]
    paths += [Path(f'docs/experiments/visual-functional-{name}-v4.json') for name in ['val4','val5']]
    paths += [Path(f'run/sim/visual-functional-v2-{name}')/file for name in ['val4','val5'] for file in ['vo.json','boundary-tracks.json','run.json','memory/pipeline.json','memory/integrated-memory.json']]
    paths += [Path('sim')/name for name in ['three_view_vo.py','automatic_boundary_tracks.py','run_visual_memory_pipeline.py','local_rotation_evidence.py']]
    paths += [Path('src/agent')/name for name in ['experience-association.ts','visual-experience-memory.ts','visual-experience-pipeline.ts','temporal-region-continuity.ts','visual-change-boundaries.ts','region-interpretation.ts','revisable-region-hierarchy.ts','segment-association.ts','segment-interpretation-store.ts']]
    paths += [Path('src/sim')/name for name in ['visual-experience-replay.ts','build-visual-memory-inputs.ts','visual-complete-evaluation.ts']]
    hashes={str(path).replace('\\','/'):hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    with Path('docs/experiments/visual-functional-run-manifest-v1.json').open('x') as f:json.dump({'protocol':'visual-functional-run-manifest-v1','hashes':hashes,'status':'software prototype; physical boundary acceptance failed','note':'Raw image hashes referenced by dataset manifest. Timing depends on concurrent CPU workload and is not device latency. Reports and code are versioned; older numerical failure reports retained.'},f,indent=2)
    print(f'Frozen {len(hashes)} input/code/report hashes')

if __name__=='__main__':main()
