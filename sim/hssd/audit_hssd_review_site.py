"""Local HTTP asset/range checks; explicitly NOT browser interaction acceptance."""
import argparse
import concurrent.futures
import json
import urllib.request
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('site',type=Path); parser.add_argument('output',type=Path)
    args = parser.parse_args()
    base = 'http://127.0.0.1:8879/'+args.site.name+'/'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(base+'data.json',timeout=30) as response:
        data = json.load(response)
    with opener.open(base,timeout=30) as response:
        html = response.read().decode('utf8')
    for expected in ['切换样本集','原标签通过','原标签不通过','不通过的理由','actual']:
        if expected == 'actual':
            if data['displayInterpolation']['method'] != 'actual-action-rerender':
                raise ValueError('Video is not an actual-action render')
        elif expected not in html:
            raise ValueError('Missing review UI contract: '+expected)
    def image(sample):
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(base+sample['image'],timeout=30) as response:
            if response.status != 200 or not response.read():
                raise ValueError('Missing sample image: '+sample['id'])
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(image,data['samples']))
    request = urllib.request.Request(base+'motion-hold.mp4',headers={'Range':'bytes=0-1023'})
    with opener.open(request,timeout=30) as response:
        if response.status != 206 or len(response.read()) != 1024:
            raise ValueError('Video byte range failed')
    with opener.open('http://127.0.0.1:8879/datasets.json',timeout=30) as response:
        catalog = json.load(response)
    if not any(row['directory']==args.site.name and row['name']==data['datasetId'] for row in catalog):
        raise ValueError('Dataset switch catalog missing scene')
    result = {'protocol':'hssd-review-http-audit-v1','passed':True,'datasetId':data['datasetId'],'sampleImageUrlsVerified':len(data['samples']),'videoRangeStatus':206,'url':base,'browserInteractionVerified':False,'note':'HTTP/file contract checks only; browser tool disconnected. Playback, seeking and review interactions require actual browser review.'}
    args.output.write_text(json.dumps(result,indent=2)); print(json.dumps(result))


if __name__ == '__main__':
    main()
