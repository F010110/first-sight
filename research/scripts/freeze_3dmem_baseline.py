"""Check runtime changes against upstream and freeze per-question configs."""
import difflib
import hashlib
import json
from pathlib import Path
from omegaconf import OmegaConf

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'vendor/3d-mem'
RUNTIME = ROOT / 'runs/3dmem-minival-runtime-v1'
OUT = ROOT / 'runs/minival26-baseline-v1'


def main():
    OUT.mkdir(parents=True, exist_ok=False)
    allowed = {'src/scene_aeqa.py', 'src/habitat.py', 'src/const.py', 'src/eval_utils_gpt_aeqa.py'}
    changes = {}
    diffs = []
    for source in [*sorted((SOURCE / 'src').rglob('*.py')), SOURCE / 'run_aeqa_evaluation.py']:
        relative = source.relative_to(SOURCE).as_posix()
        copy = RUNTIME / relative
        before, after = source.read_text(), copy.read_text()
        if before != after:
            if relative not in allowed:
                raise ValueError('Unexpected algorithm change: ' + relative)
            changes[relative] = {'upstreamSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                                 'runtimeSha256': hashlib.sha256(copy.read_bytes()).hexdigest()}
            if relative != 'src/const.py':
                diffs.extend(difflib.unified_diff(before.splitlines(True), after.splitlines(True), fromfile=relative + '-upstream', tofile=relative + '-runtime'))
    questions = sorted(json.loads((ROOT / 'data/hm3d-minival-eqa-subset/questions.json').read_text()), key=lambda q: q['question_id'])
    for q in questions:
        folder = OUT / q['question_id']
        folder.mkdir()
        (folder / 'question.json').write_text(json.dumps([q], indent=2), encoding='utf-8')
        config = OmegaConf.load(RUNTIME / 'cfg/minival.yaml')
        config.questions_list_path = str(folder / 'question.json')
        config.output_parent_dir = str(folder / 'output')
        config.exp_name = 'baseline'
        OmegaConf.save(config, folder / 'config.yaml')
    # Config and evidence budgets are fixed before the first question.
    manifest = {'questions': [q['question_id'] for q in questions], 'count': len(questions),
                'runtime': str(RUNTIME), 'sourceChanges': changes,
                'conditions': 'GT simulator poses, no IMU/pose noise, no question-specific changes',
                'model': 'qwen3.8-flash', 'navigationStepsPerQuestion': 50,
                'apiRequestsPerQuestionMax': 110, 'maxOutputTokensPerRequest': 4096,
                'timeoutSecondsPerQuestion': 3600, 'sdkRetries': 0,
                'scoring': 'Execution status != answer score; retain all 26 question denominator; scoring pending'}
    (ROOT / 'reports/minival26-baseline-v1-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    (ROOT / 'reports/minival26-runtime-diff.txt').write_text(''.join(diffs), encoding='utf-8')
    print('Frozen', len(questions), 'questions; changed files:', sorted(changes))


if __name__ == '__main__':
    main()
