import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { estimateMotionTrajectory, formatTrajectoryTable } from "./dead-reckoning.js";

/**
 * Offline validation entry point for the inertial dead-reckoning estimator.
 *
 * Usage:
 *   node dist/motion-replay.js <activity-recording-directory> [calibrationMs]
 *
 * The directory must contain a `motion.jsonl` written by the phone trial's
 * "record an activity" flow. The first `calibrationMs` (default 3000 ms) of the
 * recording must be quasi-static for the estimate to be trustworthy.
 */
async function main(): Promise<void> {
	const directory = process.argv[2];
	if (!directory) {
		console.error("用法: node dist/motion-replay.js <活动记录目录> [calibrationMs]");
		process.exitCode = 1;
		return;
	}
	const calibrationMs = Number(process.argv[3] ?? "3000");
	const text = await readFile(resolve(directory, "motion.jsonl"), "utf8");
	const rows = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
	const trajectory = estimateMotionTrajectory(rows, Number.isFinite(calibrationMs) ? { calibrationMs } : undefined);

	const calibration = trajectory.calibration;
	console.log("记录目录:", directory);
	console.log("标定窗口: %dms–%dms，样本 %d，stable=%s", Math.round(calibration.startMs), Math.round(calibration.endMs), calibration.sampleCount, calibration.stable);
	console.log("世界系重力: (%s, %s, %s) m/s²", calibration.gravityWorld.x.toFixed(3), calibration.gravityWorld.y.toFixed(3), calibration.gravityWorld.z.toFixed(3));
	console.log("陀螺零偏: (%s, %s, %s) deg/s", calibration.gyroBiasDps.x.toFixed(3), calibration.gyroBiasDps.y.toFixed(3), calibration.gyroBiasDps.z.toFixed(3));
	console.log("加速度噪声: %s m/s²，陀螺噪声: %s deg/s", calibration.accelerationNoiseMps2.toFixed(4), calibration.gyroNoiseDps.toFixed(3));
	console.log();
	console.log(formatTrajectoryTable(trajectory));
	console.log();
	console.log("摘要:", JSON.stringify(trajectory.summary, null, 2));
}

main().catch((error: unknown) => {
	console.error("运行失败:", error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
