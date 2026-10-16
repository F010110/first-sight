"""Validate synchronized source frame indices and build bounded visual contact sheets."""
import argparse
import io
import json
import zipfile
from pathlib import Path
from PIL import Image,ImageDraw,ImageStat

def audit(source,output):
    output.mkdir(parents=True,exist_ok=False);archives={};report={'source':str(source),'modelCalls':0,'sourceHzAssumption':10,'poseVerified':False,'independentSessions':1}
    try:
        for view in ['front','left','right']:
            path=source/f'image_lcam_{view}.zip'
            if not path.exists():raise ValueError('Missing camera archive: '+str(path))
            archives[view]=zipfile.ZipFile(path)
        indices={v:{int(Path(n).name.split('_')[0]):n for n in z.namelist() if n.endswith('.png')} for v,z in archives.items()}
        sets=[set(v) for v in indices.values()];common=sorted(set.intersection(*sets));union=set.union(*sets)
        report.update(counts={v:len(n) for v,n in indices.items()},matchedFrames=len(common),unmatchedFrames=len(union)-len(common),indexRange=[min(common),max(common)],nominalSpanSeconds=(max(common)-min(common))/10)
        if any(s!=sets[0] for s in sets):raise ValueError('Camera frame indices disagree')
        selected=sorted({common[round(i*(len(common)-1)/11)] for i in range(12)})
        sheet=Image.new('RGB',(160*3,140*len(selected)),'white');draw=ImageDraw.Draw(sheet);quality=[]
        for row,index in enumerate(selected):
            for col,view in enumerate(['front','left','right']):
                image=Image.open(io.BytesIO(archives[view].read(indices[view][index]))).convert('RGB');image.load()
                stat=ImageStat.Stat(image);quality.append({'index':index,'view':view,'size':list(image.size),'std':stat.stddev})
                image.thumbnail((160,120));sheet.paste(image,(col*160,row*140));draw.text((col*160,row*140+120),f'{index} {view}',fill='black')
        sheet.save(output/'contact-sheet.jpg');report['sampleQuality']=quality
        metadata=source/'metadata.zip'
        if metadata.exists():
            with zipfile.ZipFile(metadata) as z:report['metadataEntries']=z.namelist()
        report['status']='index-alignment-and-image-sample-passed'
        report['limitations']='Frame index matching is not hardware synchronization proof. Nominal duration uses documented 10Hz, not verified source timestamps. No ground-truth pose supplied to Agent. No campus completeness or semantic accuracy claim.'
    except Exception as error:report.update(status='failed',error=str(error));raise
    finally:
        for z in archives.values():z.close()
        (output/'audit.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='sampleQuality'},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);a=p.parse_args();audit(a.source,a.output)
