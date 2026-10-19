"""HTTP/link/range/JS syntax audit; not browser interaction acceptance."""
import json
import re
import subprocess
import urllib.request
from pathlib import Path
from html.parser import HTMLParser


class Links(HTMLParser):
    def __init__(self):super().__init__();self.links=set();self.cards=0
    def handle_starttag(self,tag,attrs):
        if tag=='article':self.cards+=1
        if tag=='a':self.links.add(dict(attrs)['href'])


def main():
    base='http://127.0.0.1:8879/';root=Path('run/review-site')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    parser=Links();parser.feed(opener.open(base,timeout=20).read().decode('utf8'))
    for link in sorted(parser.links):
        if not link.startswith('http'):
            with opener.open(base+link,timeout=20) as response:
                if response.status!=200:raise ValueError(link)
                print(link,response.status)
    if parser.cards!=8:raise ValueError('Expected 2 home + 6 planned HSSD cards')
    catalog=json.loads((root/'hssd-videos/catalog.json').read_text(encoding='utf8'))
    video=next(row['video'] for row in catalog['scenes'] if row['ready'])
    request=urllib.request.Request(base+'hssd-videos/'+video,headers={'Range':'bytes=0-1023'})
    with opener.open(request,timeout=20) as response:
        if response.status!=206 or len(response.read())!=1024:raise ValueError('Range failed')
        print('videoRange206',response.headers['Content-Type'])
    for path in [root/'index.html',root/'hssd-videos/index.html']:
        script=re.search(r'<script>(.*?)</script>',path.read_text(encoding='utf8'),re.S).group(1)
        subprocess.run(['node','-e','new (require("node:vm").Script)(require("node:fs").readFileSync(0,"utf8"))'],input=script.encode('utf8'),check=True)
        print('JS syntax passed',path)
    print('8 samples; HTTP audit passed. Browser interactions unverified.')


if __name__=='__main__':main()
