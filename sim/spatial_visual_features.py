"""Local coarse RGB descriptors, not a learned semantic embedding or metric pose."""
import json
import sys
import os
import re
from PIL import Image,ImageOps

def descriptor(path):
    if os.name!='nt' and re.match(r'^[A-Za-z]:[\\/]',path):path='/mnt/'+path[0].lower()+'/'+path[3:].replace('\\','/')
    with Image.open(path) as source:
        image=ImageOps.exif_transpose(source).convert('RGB')
        if image.width*image.height>20_000_000:raise ValueError('Image pixel budget exceeded')
        small=image.resize((4,4));values=[channel/255 for pixel in small.getdata() for channel in pixel]
        # Global color histogram complements coarse layout; no file/path/GT features.
        hist=image.resize((64,64)).histogram()
        for channel in range(3):
            for bucket in range(8):values.append(sum(hist[channel*256+bucket*32:channel*256+(bucket+1)*32])/4096)
        return values

if __name__=='__main__':
    rows=json.load(sys.stdin)
    if len(rows)>100:raise ValueError('Batch exceeds 100 observations')
    result=[]
    for row in rows:
        if not 1<=len(row['frames'])<=4:raise ValueError('Camera budget exceeded')
        result.append({'id':row['id'],'features':[descriptor(path) for path in row['frames']]})
    json.dump(result,sys.stdout)
