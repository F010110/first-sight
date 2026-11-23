"""Calibrate recorded evidence availability and freeze a small diagnostic pilot, no API calls."""
import argparse
import hashlib
import json
from pathlib import Path

SELECTED = ['C01', 'C30', 'S03', 'S20', 'S27', 'S30', 'L01', 'L03', 'L07', 'L09', 'L10', 'L13', 'L16', 'L23', 'L25']
CONFIRMED = {
    'S03': 'citation-protocol', 'S20': 'non-answer', 'S27': 'time-object-binding', 'S30': 'time-object-binding',
    'L07': 'retrieval-navigation-budget', 'L09': 'current-substituted-for-history', 'L10': 'protocol-truncation-and-identity-confusion',
    'L13': 'irrelevant-retrieval-and-object-binding', 'L15': 'current-context-substituted-for-history',
    'L21': 'visit-identity-binding', 'L23': 'wrong-time-range-and-object-binding', 'L25': 'retrieval-not-found',
    'C30': 'unsupported-movement-assurance', 'L03': 'recent-revisit-reexposure-not-long-proof'
}


def load(p):
    return json.loads(Path(p).read_text(encoding='utf-8'))


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def prepare(run, freeze, output, previous_attempt=None):
    run, freeze, output = map(Path, [run, freeze, output])
    if output.exists():
        raise FileExistsError(output)
    tasks = load(run / 'tasks.json')
    refs = {r['id']: r for r in load(freeze / 'evaluation-only/references.json')}
    findings = load('data/evaluation/unioncity-questions90-v2-assistant-review.json')
    disputed = {r['id'] for r in findings['findings']} | {'C30'}
    records, pilot, snapshots = [], [], {}
    for task in tasks:
        ident = task['id']
        result = load(run / 'questions' / ident / 'result.json')
        path = run / 'questions' / ident / 'producer-snapshot.json'
        snapshot = load(path)
        source = {r['observation_id']: r for r in snapshot['results'] if r['lane'] == 'memory'}
        reference = refs[ident]
        anchors = [r for r in reference['referenceObservations'] if r['atMs'] < task['queryAtMs']]
        # Row presence is not semantic sufficiency, and exact anchor identity is not the grading rule.
        stored = [{'id': a['id'], 'atMs': a['atMs'], 'present': a['id'] in source,
                   'text': source[a['id']]['result']['summary'] if a['id'] in source else None,
                   'inRecentWindow': a['atMs'] >= task['queryAtMs'] - 60000} for a in anchors]
        records.append({'id': ident, 'status': result['status'], 'confirmedFailureStage': CONFIRMED.get(ident),
                        'semanticOutcome': 'not-fully-adjudicated' if ident not in CONFIRMED else 'targeted-assistant-review',
                        'referenceRecords': stored, 'automaticGradeDisputed': ident in disputed,
                        'contextCitations': result.get('answer', {}).get('contextRefs', []),
                        'memoryCitations': result.get('answer', {}).get('memoryRefs', []),
                        'note': 'Private diagnosis only. Source row present does not mean core fact was extracted; no oracle IDs enter normal retrieval.'})
        if ident in SELECTED:
            pilot.append(task)
            snapshots[ident] = {'path': str(path.resolve()), 'sha256': sha(path)}
    if len(records) != 90 or len(pilot) != 15:
        raise ValueError('Unexpected task count')
    output.mkdir(parents=True)
    (output / 'evaluation-only').mkdir()
    def save(name, value):
        (output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    save('evaluation-only/baseline-calibration.json', {'questions': records, 'paidCalls': 0,
         'rules': ['No full historical score invented from a targeted review', 'Follow public question, no hidden quantity or disclaimer requirements',
                   'Wrong identity and unsupported added identifiers remain errors despite correct attributes',
                   'Accept supported alternative referents or clarification for ambiguous questions',
                   'Coverage is judged from initial context separately from whether the answer used it',
                   'Raw image, context and memory citations are distinct; explicit permission to move is not visual doorway recognition']})
    save('tasks.json', pilot)
    save('snapshots.json', snapshots)
    save('evaluation-only/references.json', [refs[t['id']] for t in pilot])
    save('evaluation-only/calibrated-pilot-notes.json', {
        'C01': 'Do not deduct merely for absence of boilerplate; visible bench location answers the question.',
        'C30': 'Visible doorway is answerable, but unsupported direct permission to enter is a safety failure.',
        'S20': 'Repeating question verbatim scores zero, not one.',
        'S27': 'Initial upper-lobby wood door state, not later terrace door. Clarify if genuinely ambiguous.',
        'S30': 'Direction at the referenced terrace viewpoint, not earlier room viewpoint.',
        'L03': 'Recent revisit re-exposes facade attributes; excluded from long-dependence gate, retained in answer-quality table.',
        'L16': 'Green table can be correct while asserting deli for first hardware store remains an extra unsupported identity.'})
    plan = {'schema': 'unioncity-repair-pilot-v1', 'approvedQuestionTextUnchanged': True, 'questions': 15,
            'normal': SELECTED, 'memoryDisabled': [x for x in SELECTED if x.startswith('L')],
            'suppliedEvidenceDiagnosticOnly': [x for x in SELECTED if not x.startswith('C')],
            'expectedBranches': 37, 'baselineRun': str(run.resolve()), 'freeze': str(freeze.resolve()),
            'publicInputPath': str((run / 'input.json').resolve()), 'publicInputSHA256': sha(run / 'input.json'),
            'tasksSHA256': sha(output / 'tasks.json'), 'baselineResultsSHA256': sha(run / 'results.jsonl'),
            'snapshotsSHA256': sha(output / 'snapshots.json'), 'referencesSHA256': sha(output / 'evaluation-only/references.json'),
            'reusePolicy': 'Reuse old producer snapshots read-only; do not reextract 813 frames or import predictions into memory',
            'maxUSD': {'answers': .45, 'grading': .25, 'pilotTotal': .70}, 'maxCalls': {'answers': 222, 'grading': 37},
            'gateFrozenBeforeRun': {'normalCompletedAtLeast': 14, 'normalSemanticAtLeast3Count': 12,
                'requiredProtocolCasesCompleted': ['S03', 'L07', 'L10'], 'noDeliveredExplicitMovementAssurances': True,
                'noFutureOrPrivateEvidenceInNormal': True, 'preserveGoodControlsAtLeast3': ['C01', 'L01'],
                'wrongBindingSet': ['L09', 'L13', 'L23'], 'wrongBindingAtLeast3Count': 2,
                'eligibleLong': ['L01', 'L07', 'L09', 'L10', 'L13', 'L16', 'L23', 'L25'],
                'eligibleLongSupportedAtLeast3Count': 5},
            'full90Conditional': 'Run only if predeclared gates hold after trace/semantic review and cumulative budget fits; do not loosen gates after seeing results',
            'noHeldoutQuestionsExecutedWithoutUserReview': True}
    if previous_attempt:
        previous_attempt = Path(previous_attempt)
        if not load(previous_attempt / 'report.json')['completedScript']:
            raise ValueError('Previous attempt must finish before another bounded attempt')
        usage = load(previous_attempt / 'requests/usage.json')
        remaining = .45 - usage['estimatedUSD']
        if remaining <= .02 or usage['calls'] >= 222:
            raise ValueError('Pilot cumulative answer budget exhausted')
        plan['previousAttempts'] = [{'path': str(previous_attempt.resolve()), 'usageSHA256': sha(previous_attempt / 'requests/usage.json'),
                                     'estimatedUSD': usage['estimatedUSD'], 'calls': usage['calls']}]
        plan['maxUSD']['answers'] = remaining
        plan['maxCalls']['answers'] = 222 - usage['calls']
        plan['maxUSD']['pilotTotal'] = .70
        plan['budgetScope'] = 'All pilot attempts combined: answers USD0.45, grading USD0.25; previous spend deducted, not a fresh cap'
    save('plan.json', plan)
    return {'calibratedRecordedTasks': len(records), 'confirmedStageCases': len(CONFIRMED), 'pilotTasks': len(pilot),
            'branches': plan['expectedBranches'], 'gateFrozen': True, 'output': str(output), 'paidCalls': 0}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--run', required=True)
    p.add_argument('--freeze', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--previous-attempt')
    a = p.parse_args()
    print(json.dumps(prepare(a.run, a.freeze, a.output, a.previous_attempt), ensure_ascii=False))
