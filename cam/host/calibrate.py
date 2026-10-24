"""Prepare a printable checkerboard, or fit an explicitly chosen lens model offline."""
import argparse
import hashlib
import json
from pathlib import Path


def board(path,cols,rows,square):
    width,height=(cols+3)*square,(rows+3)*square
    cells=[]
    for y in range(rows+1):
        for x in range(cols+1):
            if (x+y)%2==0:cells.append(f'<rect x="{(x+1)*square}" y="{(y+1)*square}" width="{square}" height="{square}" fill="black"/>')
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}mm" height="{height}mm" viewBox="0 0 {width} {height}"><rect width="100%" height="100%" fill="white"/>'+''.join(cells)+'</svg>'
    with Path(path).open('x',encoding='utf8') as f:f.write(svg)


def fit(directory,output,model,cols,rows,square):
    import cv2
    import numpy as np
    files=sorted(p for p in Path(directory).iterdir() if p.suffix.lower() in ('.jpg','.jpeg','.png'))
    points=[];sources=[];hashes=set();size=None
    for path in files:
        digest=hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in hashes:continue
        image=cv2.imread(str(path))
        if image is None:continue
        current=(image.shape[1],image.shape[0])
        if current!=(640,480):raise ValueError('Capture calibration images at current 640x480 mode, no resize/crop')
        size=current
        ok,corners=cv2.findChessboardCornersSB(cv2.cvtColor(image,cv2.COLOR_BGR2GRAY),(cols,rows))
        if ok:points.append(corners.astype(np.float64));sources.append(dict(path=str(path),sha256=digest));hashes.add(digest)
    if len(points)<12:raise ValueError(f'Need >=12 distinct valid board views; found {len(points)}. Vary tilt, distance and position.')
    cloud=np.concatenate(points).reshape(-1,2);coverage=(cloud.max(axis=0)-cloud.min(axis=0))/np.array(size)
    if min(coverage)<.65:raise ValueError('Insufficient image coverage; include edges and corners with a larger target')
    obj=np.zeros((1,cols*rows,3),np.float64);obj[0,:,:2]=np.mgrid[0:cols,0:rows].T.reshape(-1,2)*square
    objects=[obj.copy() for _ in points]
    if model=='fisheye':
        rms,K,D,rvecs,tvecs=cv2.fisheye.calibrate(objects,[p.reshape(1,-1,2) for p in points],size,None,None,
            flags=cv2.fisheye.CALIB_RECOMPUTE_EXTRINSIC|cv2.fisheye.CALIB_CHECK_COND|cv2.fisheye.CALIB_FIX_SKEW)
    else:
        rms,K,D,rvecs,tvecs=cv2.calibrateCamera([o.reshape(-1,3).astype(np.float32) for o in objects],[p.astype(np.float32) for p in points],size,None,None)
    if not np.isfinite(rms) or not np.all(np.isfinite(K)) or not np.all(np.isfinite(D)):raise ValueError('Non-finite calibration; acquire better board views')
    report=dict(status='fitted-needs-review',modelChosenByOperator=model,imageSize=size,innerCorners=[cols,rows],squareMm=square,
                views=len(points),rmsPixels=float(rms),coverageFraction=coverage.tolist(),K=K.tolist(),D=D.tolist(),sources=sources,
                verified160Degrees=False,notes='Fit is not proof of advertised FOV or correct model. Review reprojection/edge coverage and compare models. Never share one lens calibration across all three devices without validation.')
    with Path(output).open('x',encoding='utf8') as f:json.dump(report,f,indent=2)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['board','fit']);p.add_argument('input');p.add_argument('output',nargs='?')
    p.add_argument('--model',choices=['fisheye','pinhole']);p.add_argument('--cols',type=int,default=9);p.add_argument('--rows',type=int,default=6);p.add_argument('--square-mm',type=float,default=20)
    a=p.parse_args()
    if not 3<=a.cols<=20 or not 3<=a.rows<=20 or not 1<=a.square_mm<=100:p.error('Invalid board dimensions')
    if a.action=='board':board(a.input,a.cols,a.rows,a.square_mm)
    else:
        if not a.output or not a.model:p.error('fit requires IMAGE-DIRECTORY NEW.json --model fisheye|pinhole')
        fit(a.input,a.output,a.model,a.cols,a.rows,a.square_mm)


if __name__=='__main__':main()
