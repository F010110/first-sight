"""Freeze compiled execution/grading policy before any QA predictions."""
import argparse
import json
from pathlib import Path
from sim.spatial.salad_features import sha

def freeze(root):
    if (root/'smoke').exists() or (root/'full').exists():raise ValueError('Cannot freeze after QA started')
    files=['dist/current/sim/evaluation/memory-evaluation.js','dist/current/sim/evaluation/memory-evaluation-session.js','dist/current/sim/evaluation/memory-evaluation-grade.js','dist/current/agent/request-agent.js','dist/current/agent/qwen-provider.js','dist/current/agent/spatial-retrieve.js','dist/current/sim/evaluation/spatial-memory-evaluation-session.js']
    record={'files':{str(Path(p).resolve()):sha(Path(p)) for p in files},'purpose':'Execution, horizon scope, grading rubric and score aggregation frozen before QA predictions','rates':{'inputUSDPerMillion':.1356,'outputUSDPerMillion':.4584,'source':'https://www.alibabacloud.com/help/en/pai/product-overview/billing-of-pai-token-service','basis':'Published PAI China Beijing list price, not an account invoice'},'nominalEstimatedCostCeilingsUSD':{'memory':4,'smoke':.5,'smokeGrading':.2,'full':3,'fullGrading':1.5}}
    current=root/'code-freeze.json'
    if current.exists():
        previous=root/('code-freeze.superseded-'+sha(current)[:16]+'.json')
        if previous.exists():raise ValueError('Existing superseded freeze; do not overwrite')
        current.rename(previous)
        record['supersedes']=previous.name
    with current.open('x',encoding='utf8') as f:json.dump(record,f,indent=2)
    print('Frozen compiled execution and grading policy',len(files))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('prepared',type=Path);freeze(p.parse_args().prepared)
