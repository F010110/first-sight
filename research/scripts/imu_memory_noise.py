"""Measurement-level IMU simulation for a collocated camera/IMU, not a VIO.

Pure strapdown propagation; no ground-truth resets after initialization.
Motion between observation poses is a stop-to-stop quintic along navmesh paths.
"""
import json
import csv
import gzip
from pathlib import Path
import numpy as np
from scipy.spatial.transform import Rotation

G = 9.80665
PROFILES = {
    'gt': dict(gyro_asd_dps=0., accel_asd_ug=0., gyro_bias_dps=0., accel_bias_mg=0.),
    'ideal_imu': dict(gyro_asd_dps=0., accel_asd_ug=0., gyro_bias_dps=0., accel_bias_mg=0.),
    'bmi_like': dict(gyro_asd_dps=.014, accel_asd_ug=175., gyro_bias_dps=.003, accel_bias_mg=.1),
    'mpu_like': dict(gyro_asd_dps=.005, accel_asd_ug=400., gyro_bias_dps=.01, accel_bias_mg=.5),
}


class InertialPose:
    def __init__(self, profile, seed=0, hz=200.):
        self.profile = profile
        self.spec = PROFILES[profile]
        self.rng = np.random.default_rng(seed)
        # Published ASDs treated as one-sided spectra: Qc = ASD^2 / 2.
        self.ng = np.deg2rad(self.spec['gyro_asd_dps']) / np.sqrt(2.)
        self.na = self.spec['accel_asd_ug'] * 1e-6 * G / np.sqrt(2.)
        self.bg = self.rng.normal(size=3) * np.deg2rad(self.spec['gyro_bias_dps'])
        self.ba = self.rng.normal(size=3) * self.spec['accel_bias_mg'] * .001 * G
        # Assumed, not device-identified: slow stationary bias, tau=100 s,
        # per-axis stationary sigma = 1/3 of initial residual-bias sigma.
        self.sbg = np.deg2rad(self.spec['gyro_bias_dps']) / 3.
        self.sba = self.spec['accel_bias_mg'] * .001 * G / 3.
        self.dg = np.zeros(3)
        self.da = np.zeros(3)
        self.hz = hz
        self.time = 0.
        self.pose = None
        self.true_pose = None
        self.velocity = np.zeros(3)
        self.samples = 0
        self.last_measurement = None
        self.sample_sink = None

    def advance(self, target, waypoints=None):
        target = np.asarray(target, dtype=float)
        if self.pose is None:
            self.pose = target.copy()
            self.true_pose = target.copy()
            return self.pose.copy()
        start = self.true_pose.copy()
        points = [start[:3, 3]] + ([] if waypoints is None else list(waypoints)) + [target[:3, 3]]
        unique = [np.asarray(points[0])]
        for point in points[1:]:
            if np.linalg.norm(point - unique[-1]) > 1e-7:
                unique.append(np.asarray(point))
        if len(unique) == 1:
            unique.append(unique[0].copy())
        # Turn on the spot first; then translate along the collision-free polyline.
        self._segment(start[:3, 3], start[:3, 3], start[:3, :3], target[:3, :3])
        for a, b in zip(unique[:-1], unique[1:]):
            if np.linalg.norm(b-a) > 1e-7:
                self._segment(a, b, target[:3, :3], target[:3, :3])
        self.true_pose = target.copy()
        return target.copy() if self.profile == 'gt' else self.pose.copy()

    def _segment(self, p0, p1, r0, r1):
        rv = Rotation.from_matrix(r0.T @ r1).as_rotvec()
        dp = p1 - p0
        # Quintic peak speed 1.875*d/T, peak accel 5.774*d/T^2.
        duration = max(.2, 1.875*np.linalg.norm(dp)/.5,
                       np.sqrt(5.774*np.linalg.norm(dp)/1.),
                       1.875*np.linalg.norm(rv)/np.deg2rad(90.),
                       np.sqrt(5.774*np.linalg.norm(rv)/np.deg2rad(180.)))
        count = int(np.ceil(duration * self.hz))
        dt = duration / count
        decay = np.exp(-dt / 100.)
        gravity = np.array([0., -G, 0.])  # Habitat world, +Y up.
        for k in range(count):
            u = (k + .5) / count
            s = 10*u**3 - 15*u**4 + 6*u**5
            sd = (30*u**2 - 60*u**3 + 30*u**4) / duration
            sdd = (60*u - 180*u**2 + 120*u**3) / duration**2
            rt = r0 @ Rotation.from_rotvec(rv*s).as_matrix()
            w = rv*sd
            f = rt.T @ (dp*sdd - gravity)
            self.dg = decay*self.dg + self.sbg*np.sqrt(1-decay**2)*self.rng.normal(size=3)
            self.da = decay*self.da + self.sba*np.sqrt(1-decay**2)*self.rng.normal(size=3)
            wm = w + self.bg + self.dg + self.ng/np.sqrt(dt)*self.rng.normal(size=3)
            fm = f + self.ba + self.da + self.na/np.sqrt(dt)*self.rng.normal(size=3)
            rh = self.pose[:3, :3] @ Rotation.from_rotvec(wm*dt/2).as_matrix()
            aw = rh @ fm + gravity
            self.pose[:3, 3] += self.velocity*dt + .5*aw*dt**2
            self.velocity += aw*dt
            self.pose[:3, :3] = self.pose[:3, :3] @ Rotation.from_rotvec(wm*dt).as_matrix()
            self.time += dt
            self.samples += 1
            self.last_measurement = dict(dt=dt, angular_rate=wm.tolist(), specific_force=fm.tolist())
            if self.sample_sink is not None:
                self.sample_sink([self.time, dt, *w, *f, *wm, *fm, *(self.bg+self.dg), *(self.ba+self.da)])


def append_json(path, row):
    with Path(path).open('a', encoding='utf-8') as f:
        f.write(json.dumps(row, ensure_ascii=False) + '\n')


class MemoryExperiment:
    def __init__(self, cfg, scene, output):
        self.output = Path(output)
        self.output.mkdir(parents=True, exist_ok=True)
        self.cfg = cfg
        self.scene = scene
        self.inertial = InertialPose(cfg.noise_profile, int(cfg.noise_seed))
        self.imu_file = gzip.open(self.output/'imu.csv.gz', 'wt', encoding='utf-8')
        writer = csv.writer(self.imu_file)
        writer.writerow(['t','dt'] + [f'{prefix}_{axis}' for prefix in
            ('true_w','true_f','measured_w','measured_f','bias_w','bias_f') for axis in ('x','y','z')])
        self.inertial.sample_sink = writer.writerow
        self.current_frame = None
        self.current_pts = None
        self.last_gt_pts = None
        self.est_pts = None
        self.last_matches = []

    def observation(self, gt_pose, pts, step, view, angle):
        waypoints = None
        if self.last_gt_pts is not None and np.linalg.norm(pts-self.last_gt_pts) > 1e-6:
            import habitat_sim
            path = habitat_sim.ShortestPath()
            path.requested_start = self.last_gt_pts
            path.requested_end = pts
            if not self.scene.pathfinder.find_path(path):
                raise RuntimeError('No navmesh path for IMU synthesis; refusing straight-line teleport')
            offset = gt_pose[:3, 3] - pts
            waypoints = [np.asarray(p)+offset for p in path.points]
        est = self.inertial.advance(gt_pose, waypoints)
        self.imu_file.flush()
        self.current_frame = f'{step}-view_{view}.png'
        self.current_pts = np.asarray(pts).copy()
        self.est_pts = est[:3, 3] + (pts-gt_pose[:3, 3])
        self.last_gt_pts = np.asarray(pts).copy()
        err = Rotation.from_matrix(gt_pose[:3, :3].T @ est[:3, :3]).magnitude()
        append_json(self.output/'poses.jsonl', dict(frame=self.current_frame, step=step, view=view,
            angle=float(angle), time=self.inertial.time, imuSamples=self.inertial.samples,
            gtCameraPose=gt_pose.tolist(), estimatedCameraPose=est.tolist(),
            positionErrorM=float(np.linalg.norm(est[:3, 3]-gt_pose[:3, 3])),
            rotationErrorDeg=float(np.rad2deg(err)), velocity=self.inertial.velocity.tolist(),
            lastMeasurement=self.inertial.last_measurement))
        return est, self.est_pts

    def objects(self, stage, step=None):
        rows = []
        for oid, obj in self.scene.objects.items():
            rows.append(dict(id=int(oid), category=obj['class_name'],
                detections=int(obj['num_detections']), center=np.asarray(obj['bbox'].center).tolist(),
                extent=np.asarray(obj['bbox'].extent).tolist(), points=len(obj['pcd'].points)))
        snapshots = {str(k): [int(x) for x in v.cluster] for k,v in self.scene.snapshots.items()}
        append_json(self.output/'memory.jsonl', dict(stage=stage, step=step,
            frame=self.current_frame, objects=rows, snapshots=snapshots))

    def matches(self, detection_list, matches):
        append_json(self.output/'associations.jsonl', dict(frame=self.current_frame,
            detected=[dict(id=int(k), category=v['class_name'], center=np.asarray(v['bbox'].center).tolist())
                      for k,v in detection_list.items()],
            matches=[[int(a), None if b is None else int(b)] for a,b in matches]))
