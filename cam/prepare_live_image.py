"""Lossless decoded-pixel PNG view of a verified JPEG plus RGB descriptor. No model."""
import hashlib
import json
from pathlib import Path
import sys
from PIL import Image

value = json.load(sys.stdin)
source, destination = Path(value['source']), Path(value['destination'])
raw = source.read_bytes()
if hashlib.sha256(raw).hexdigest() != value['sha256']:
    raise ValueError('Original JPEG changed')
with Image.open(source) as image:
    if image.format != 'JPEG' or image.size != (640, 480):
        raise ValueError('Require VGA JPEG')
    rgb = image.convert('RGB')
    small = rgb.resize((4, 4))
    features = [channel/255 for pixel in small.getdata() for channel in pixel]
    histogram = rgb.resize((64, 64)).histogram()
    for channel in range(3):
        for bucket in range(8):
            features.append(sum(histogram[channel*256+bucket*32:channel*256+(bucket+1)*32])/4096)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('xb') as output:
        rgb.save(output, format='PNG')
    pixel_hash = hashlib.sha256(rgb.tobytes()).hexdigest()
with Image.open(destination) as decoded:
    if hashlib.sha256(decoded.convert('RGB').tobytes()).hexdigest() != pixel_hash:
        raise ValueError('Decoded pixel conversion mismatch')
print(json.dumps(dict(path=str(destination.resolve()), sha256=hashlib.sha256(destination.read_bytes()).hexdigest(),
                     jpegSha256=value['sha256'], pixelSha256=pixel_hash, features=[features])))
