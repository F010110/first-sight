"""Read-only evidence sheets; no inference or reference edits."""
import json
from pathlib import Path
from PIL import Image, ImageDraw

root=Path(__file__).resolve().parents[2]
out=root/'run/ulvn-place-quality-audit-v1'
out.mkdir(exist_ok=False)
source=json.loads((root/'run/gmod-annotated-rerender-v2-final/public-source.json').read_text())['observations']
report=json.loads((root/'run/ulvn-local-domains-813-quality-audit-v2/report.json').read_text(encoding='utf-8'))
pairs=report['canonical']['pairs']
def draw_observation(canvas,n,x,y):
    for j,v in enumerate(source[n-1]['views']):
        with Image.open(v['path']) as im:
            im.thumbnail((192,108));canvas.paste(im,(x+j*192,y))
for page,start in enumerate(range(0,len(pairs),12),1):
    canvas=Image.new('RGB',(1152,12*134),'white');d=ImageDraw.Draw(canvas)
    for row,p in enumerate(pairs[start:start+12]):
        y=row*134
        d.text((2,y),f"{start+row+1}: {p['current']} -> {p['historical']}  XY={p['xyDistance']:.0f} DZ={p['heightDifference']:.0f}  {p['currentLabel']} / {p['historicalLabel']}",fill='black')
        draw_observation(canvas,p['current'],0,y+22);draw_observation(canvas,p['historical'],576,y+22)
    canvas.save(out/f'pairs-{page:02}.jpg',quality=88)
# Uniform timeline, plus dense samples of both missed label-return visits.
ordinals=sorted(set(range(1,814,10))|set(range(317,336,2))|set(range(660,694,2)))
for page,start in enumerate(range(0,len(ordinals),24),1):
    canvas=Image.new('RGB',(1152,12*134),'white');d=ImageDraw.Draw(canvas)
    for row,n in enumerate(ordinals[start:start+24]):
        x=(row%2)*576;y=(row//2)*134
        d.text((x,y),str(n),fill='black');draw_observation(canvas,n,x,y+22)
    canvas.save(out/f'timeline-{page:02}.jpg',quality=88)
(out/'pair-index.json').write_text(json.dumps(pairs,indent=2),encoding='utf-8')
print(out)
