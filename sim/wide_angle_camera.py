"""Synthetic circular equidistant fisheye, not a measured hardware lens."""
import cv2
import numpy as np


def equidistant_fisheye(image, fov_degrees):
    if image is None or image.shape[0] != image.shape[1] or not np.isfinite(fov_degrees) or not 0 < fov_degrees < 180:
        raise ValueError('Square render and FOV strictly between 0 and 180 required')
    size = image.shape[0]
    if size < 2:
        raise ValueError('Render too small')
    center = (size - 1) / 2
    theta_max = np.radians(fov_degrees / 2)
    y, x = np.indices((size, size), dtype=np.float64)
    dx, dy = x - center, y - center
    r = np.hypot(dx, dy)
    theta = np.minimum(r / center, 1) * theta_max
    focal = size / (2 * np.tan(theta_max))
    scale = np.divide(focal * np.tan(theta), r, out=np.zeros_like(r), where=r > 0)
    map_x = (center + dx * scale).astype(np.float32)
    map_y = (center + dy * scale).astype(np.float32)
    valid = r <= center
    output = cv2.remap(image, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    output[~valid] = 0
    return output, valid.astype(np.uint8) * 255
