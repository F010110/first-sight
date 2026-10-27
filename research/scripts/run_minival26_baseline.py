"""Run each frozen question once; isolate failures, never drop questions."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    if not os.environ.get('QWEN_API_KEY') or not os.environ.get('QWEN_BASE_URL'):
        raise RuntimeError('Required API environment missing')
    manifest = json.loads((ROOT / 'reports/minival26-baseline-v1-manifest.json').read_text())
    runtime = Path(manifest['runtime'])
    for relative, hashes in manifest['sourceChanges'].items():
        if hashlib.sha256((runtime / relative).read_bytes()).hexdigest() != hashes['runtimeSha256']:
            raise RuntimeError('Frozen runtime changed')
    result_path = ROOT / 'reports/minival26-baseline-v1-progress.json'
    run_root = ROOT / 'runs/minival26-baseline-v1'
    progress = []
    for qid in manifest['questions']:
        folder = run_root / qid
        status_path = folder / 'execution.json'
        if status_path.exists():
            progress.append(json.loads(status_path.read_text()))
            continue
        if (folder / 'run.log').exists():
            raise RuntimeError('Incomplete prior run needs review; refusing overwrite')
        env = dict(os.environ)
        env.update(TORCH_HOME=str(ROOT / 'cache/torch'), HF_HOME=str(ROOT / 'cache/hf'),
                   TMPDIR=str(ROOT / 'cache/tmp'), GALLIUM_DRIVER='d3d12',
                   MESA_D3D12_DEFAULT_ADAPTER_NAME='NVIDIA', PYTHONDONTWRITEBYTECODE='1',
                   RESEARCH_API_MAX_CALLS=str(manifest['apiRequestsPerQuestionMax']),
                   RESEARCH_VLM_MODEL=manifest['model'],
                   RESEARCH_API_USAGE_FILE=str(folder / 'api-usage.jsonl'),
                   RESEARCH_API_AUDIT_FILE=str(folder / 'api-input-hashes.jsonl'))
        start = time.monotonic()
        row = {'questionId': qid, 'answerScore': None}
        print('START', qid, flush=True)
        with (folder / 'run.log').open('w', encoding='utf-8') as log:
            try:
                process = subprocess.run([sys.executable, '-u', '-B', 'run_aeqa_evaluation.py',
                                          '-cf', str(folder / 'config.yaml')],
                                         cwd=runtime, env=env, stdout=log, stderr=subprocess.STDOUT,
                                         timeout=manifest['timeoutSecondsPerQuestion'])
                row.update(exitCode=process.returncode, status='process_completed' if process.returncode == 0 else 'process_failed')
            except subprocess.TimeoutExpired:
                row.update(status='timeout', exitCode=None)
            except OSError as error:
                row.update(status='launch_failed', errorType=type(error).__name__, exitCode=None)
        row['seconds'] = round(time.monotonic() - start, 2)
        answers = folder / 'output/baseline/gpt_answer.json'
        row['answerFilePresent'] = answers.exists()
        row['answers'] = json.loads(answers.read_text()) if answers.exists() else []
        status_path.write_text(json.dumps(row, indent=2), encoding='utf-8')
        progress.append(row)
        result_path.write_text(json.dumps({'expectedQuestions': 26, 'finished': len(progress),
                                           'scoringPending': True, 'executions': progress}, indent=2), encoding='utf-8')
        print('END', qid, row['status'], row['seconds'], flush=True)


if __name__ == '__main__':
    main()
