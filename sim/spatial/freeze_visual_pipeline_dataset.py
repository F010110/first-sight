"""Versioned evaluation inventory. Never used as inference input."""
import json
import hashlib
from pathlib import Path

def main():
    datasets=[]
    for name in ['region-val4-multiview','multiview-val5-clean-20261007']:
        base=Path('run/sim')/name
        hashes={}
        for view in ['frames','left','right']:
            for path in sorted((base/view).glob('*.jpg')):
                hashes[str(path.relative_to(base)).replace('\\','/')]=hashlib.sha256(path.read_bytes()).hexdigest()
        for file in ['windows.jsonl','observations.jsonl','experience-directional-evidence.json','local-rotation-evidence.json']:
            hashes[file]=hashlib.sha256((base/file).read_bytes()).hexdigest()
        rows=[json.loads(line) for line in (base/'observations.jsonl').read_text().splitlines()]
        datasets.append({'id':name,'split':'development','source':str(base),'executedFrames':len(rows),'threeViewImages':len(hashes)-4,'imageAndInputHashes':hashes,'truthAccess':'observations/windows GT fields are evaluation only; inference projects image names/ordered ticks only','labelNature':'AI original-image/trajectory reviewed boundary events; not independent human blind labels'})
    output={'protocol':'visual-pipeline-dataset-v1','scoringProtocol':'visual-pipeline-scorecard-v1','datasets':datasets,'separateOracleDiagnosticCorpus':{'path':'run/sim/place-evaluation-review-v1/expanded-oracle-summary-v1.json','recordings':6,'houses':3,'frames':2526,'scope':'Sparse oracle-only historical returns; not same evidence budget as active full three-view set. val3 scene held out from tuning.'},'exclusions':['No real-device dataset','No actual stationary negative events','No independent blind reviewer','No dynamic scene negatives','No simultaneous translation+rotation requirements in this stage'],'rules':'No combined overall accuracy. Report denominators, unknown and skipped. Do not mix expanded oracle recovery with active integrated pipeline scores.'}
    with Path('docs/experiments/visual-pipeline-dataset-v1.json').open('x') as f:json.dump(output,f,indent=2)
    print(json.dumps([{'id':d['id'],'frames':d['executedFrames'],'images':d['threeViewImages']} for d in datasets]))

if __name__=='__main__':main()
