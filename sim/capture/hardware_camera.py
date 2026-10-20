"""Rectangular hardware-sized lens approximation; no inference of real calibration."""
import json
import math
from pathlib import Path
import cv2
import numpy as np


def load_profile(path):
    profile=json.loads(Path(path).read_text(encoding='utf8'))
    assumption=profile['simulationAssumption']
    if (profile['width'],profile['height'])!=(640,480) or profile['hardwareCalibration'] is not False or assumption['projection']!='equidistant' or assumption['fovConvention']!='diagonal' or not 0<assumption['fovDegrees']<180:
        raise ValueError('Require explicit uncalibrated VGA equidistant-diagonal profile')
    return profile


def geometry(profile):
    w,h=profile['width'],profile['height'];fov=profile['simulationAssumption']['fovDegrees']
    cx,cy=(w-1)/2,(h-1)/2
    radius=math.hypot(cx,cy);focal=radius/math.radians(fov/2)
    # A square source pinhole must cover all rectangular output rays.
    y,x=np.indices((h,w),dtype=np.float64);dx,dy=x-cx,y-cy;r=np.hypot(dx,dy)
    theta=r/focal;scale=np.divide(np.tan(theta),r,out=np.full_like(r,1/focal),where=r>0)
    rx,ry=dx*scale,dy*scale
    extent=max(float(np.abs(rx).max()),float(np.abs(ry).max()))*1.001
    source_fov=math.degrees(2*math.atan(extent))
    return dict(width=w,height=h,focalPixels=focal,cx=cx,cy=cy,
                horizontalFovDegrees=math.degrees(2*cx/focal),verticalFovDegrees=math.degrees(2*cy/focal),
                diagonalFovDegrees=fov,sourceSquarePinholeFovDegrees=source_fov),rx,ry,extent


def project(source,profile):
    if source is None or source.ndim!=3 or source.shape[0]!=source.shape[1]:raise ValueError('Square newly rendered source required; do not widen old narrow-FOV images')
    model,rx,ry,extent=geometry(profile);n=source.shape[0];center=(n-1)/2
    image=cv2.remap(source,(center+rx*center/extent).astype(np.float32),(center+ry*center/extent).astype(np.float32),cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
    source_center_focal=(n-1)/(2*extent)
    return image,{**model,'projection':'synthetic-equidistant','fovConvention':'assumed-diagonal','synthetic':True,'voRequiresExplicitCalibration':True,
                  'centerUpsamplingFactor':model['focalPixels']/source_center_focal,
                  'hardwareCalibration':False,'sourceSize':n,'warning':'Not measured optics. No real distortion/blur/noise/vignetting calibration.'}
