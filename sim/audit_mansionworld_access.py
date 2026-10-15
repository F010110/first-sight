"""Public metadata/terms audit only. Does NOT download datasets or accept terms."""
import argparse
import hashlib
import json
from datetime import datetime,timezone
from pathlib import Path
import urllib.request

REPO='superbigsaw/MansionWorld'


def classify(card,readme):
    stated=card.get('license')
    text=json.dumps(card).lower()+'\n'+readme.lower()
    research_only='research purposes only' in text or 'non-commercial research' in text
    return {'declaredLicense':stated,'researchOnlyTextPresent':research_only,'status':'clarification-required' if research_only or not stated else 'requires-user-review','datasetUseApproved':False,'note':'Public availability and code licensing do not resolve dataset/third-party asset terms. This program never grants permission.'}


def audit(output):
    output=Path(output);output.mkdir(parents=True,exist_ok=False)
    def fetch(url,name):
        with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'spatial-memory-public-metadata-audit'}),timeout=30) as response:
            data=response.read(2*1024*1024+1)
        if len(data)>2*1024*1024:raise ValueError('Metadata response exceeds budget')
        (output/name).write_bytes(data)
        return data
    meta=json.loads(fetch(f'https://huggingface.co/api/datasets/{REPO}','metadata.json'));revision=meta['sha']
    readme=fetch(f'https://huggingface.co/datasets/{REPO}/raw/{revision}/README.md','README.source.md').decode()
    tree=json.loads(fetch(f'https://huggingface.co/api/datasets/{REPO}/tree/{revision}?recursive=false&expand=false','files.json'))
    files=[{'name':row['path'],'bytes':row['size'],'sha256':row.get('lfs',{}).get('oid')} for row in tree if row['path'].endswith('.zip')]
    report={'checkedAt':datetime.now(timezone.utc).isoformat(),'repo':REPO,'revision':revision,'gated':meta.get('gated'),'terms':classify(meta.get('cardData',{}),readme),'metadataSha256':hashlib.sha256((output/'metadata.json').read_bytes()).hexdigest(),'readmeSha256':hashlib.sha256(readme.encode()).hexdigest(),'archives':files,'archiveBytes':sum(row['bytes'] for row in files),'archivesDownloaded':False,'additionalAssetBudget':'Objaverse/THOR assets and decompressed data NOT included; measure before installation'}
    (output/'audit.json').write_text(json.dumps(report,indent=2));return report


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('output');a=parser.parse_args();print(json.dumps(audit(a.output),indent=2))
