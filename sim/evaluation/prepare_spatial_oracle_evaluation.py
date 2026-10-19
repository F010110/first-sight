"""Two isolated experiment roots; only oracle root receives reference IDs."""
import argparse
import json
from pathlib import Path
from sim.evaluation.prepare_memory_evaluation import prepare
from sim.spatial.salad_features import sha

def main(a):
    truth=json.loads((a.bank/'evaluation-only/tasks.json').read_text(encoding='utf8'))
    for mode in ('spatial-memory','memory-oracle'):
        root=a.output/mode
        frozen=prepare(a.sample,a.bank,root,a.memory)
        frozen['evaluationModes']=[mode]
        frozen['interpretation']='Existing SpatialRetriever with public clock bridge' if mode=='spatial-memory' else 'Privileged reference-evidence upper bound, not a deployable memory algorithm'
        if mode=='memory-oracle':
            evidence={t['id']:t['validEvidenceSets'][0] if t['answerable'] else [] for t in truth}
            (root/'oracle-evidence.json').write_text(json.dumps(evidence,indent=2),encoding='utf8')
            frozen['oracleEvidenceSha256']=sha(root/'oracle-evidence.json')
        frozen['fullQuestionExecutions']=90;frozen['smokeQuestionExecutions']=6
        (root/'frozen.json').write_text(json.dumps(frozen,indent=2),encoding='utf8')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('sample',type=Path);p.add_argument('bank',type=Path);p.add_argument('memory',type=Path);p.add_argument('output',type=Path);main(p.parse_args())
