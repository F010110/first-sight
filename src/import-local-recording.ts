import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { estimateMotionTrajectory, formatTrajectoryTable } from "./dead-reckoning.js";

/**
 * Imports a locally exported phone recording (`vlm-recording-*.json`) into the
 * standard experiment directory layout, so the existing `motion:replay` and
 * analysis tooling can read it. Use this when the upload tunnel is too slow.
 *
 * Usage:
 *   node dist/import-local-recording.js <exported-file.json>
 */
async function main(): Promise<void> {
	const file = process.argv[2];
	if (!file) {
		console.error("用法: node dist/import-local-recording.js <导出的json文件>");
		process.exitCode = 1;
		return;
	}
	const data = JSON.parse(await readFile(resolve(file), "utf8")) as Record<string, unknown>;
	const recordingId = typeof data.recordingId === "string" ? data.recordingId : `local-${Date.now()}`;
	const motionSamples = Array.isArray(data.motionSamples) ? (data.motionSamples as Array<Record<string, unknown>>) : [];
	const frames = Array.isArray(data.frames) ? (data.frames as Array<Record<string, unknown>>) : [];
	const durationMs = typeof data.durationMs === "number" ? data.durationMs : 0;
	const base = resolve("run", "experiments", `local-${recordingId}`, "activity-recordings", recordingId);
	await mkdir(base, { recursive: true });

	const frameRows: Array<Record<string, unknown>> = [];
	for (const [fallbackIndex, frame] of frames.entries()) {
		const index = typeof frame.frameIndex === "number" ? frame.frameIndex : fallbackIndex;
		const filename = `frame-${String(index).padStart(5, "0")}.jpg`;
		const base64 = typeof frame.dataBase64 === "string" ? frame.dataBase64 : "";
		const bytes = base64 ? Buffer.from(base64, "base64") : Buffer.alloc(0);
		if (bytes.length) await writeFile(resolve(base, filename), bytes);
		frameRows.push({
			frameIndex: index,
			id: `recording-${recordingId}-${index}`,
			timeMs: typeof frame.timeMs === "number" ? frame.timeMs : 0,
			timestampMs: typeof frame.timestampMs === "number" ? frame.timestampMs : 0,
			width: typeof frame.width === "number" ? frame.width : 0,
			height: typeof frame.height === "number" ? frame.height : 0,
			path: filename,
			byteLength: bytes.length,
			...(frame.quality !== undefined ? { quality: frame.quality } : {}),
			...(frame.motionContext !== undefined ? { motionContext: frame.motionContext } : {}),
		});
	}
	await writeFile(resolve(base, "motion.jsonl"), motionSamples.map((row) => JSON.stringify(row)).join("\n") + (motionSamples.length ? "\n" : ""), "utf8");
	await writeFile(resolve(base, "frames.jsonl"), frameRows.map((row) => JSON.stringify(row)).join("\n") + (frameRows.length ? "\n" : ""), "utf8");
	await writeFile(resolve(base, "capture.json"), JSON.stringify({
		schemaVersion: 1,
		recordingId,
		sessionId: `local-${recordingId}`,
		status: "completed",
		createdAt: typeof data.createdAt === "string" ? data.createdAt : new Date().toISOString(),
		durationMs,
		frameCount: frameRows.length,
		motionSampleCount: motionSamples.length,
		device: data.device ?? {},
		camera: { captureIntervalMs: typeof data.captureIntervalMs === "number" ? data.captureIntervalMs : 1000 },
		inputDiagnostics: null,
		processedBatchIds: [],
		analysis: null,
	}, null, 2), "utf8");

	const trajectory = estimateMotionTrajectory(motionSamples, { calibrationMs: 3_000 });
	console.log("导入目录:", base);
	console.log("帧数 %d，运动样本 %d，时长 %ss", frameRows.length, motionSamples.length, (durationMs / 1000).toFixed(1));
	const calibration = trajectory.calibration;
	console.log("标定: %sms-%sms 样本%d stable=%s", Math.round(calibration.startMs), Math.round(calibration.endMs), calibration.sampleCount, calibration.stable);
	console.log("世界系重力: (%s, %s, %s)", calibration.gravityWorld.x.toFixed(3), calibration.gravityWorld.y.toFixed(3), calibration.gravityWorld.z.toFixed(3));
	console.log("加速度噪声 %s m/s²，陀螺噪声 %s deg/s", calibration.accelerationNoiseMps2.toFixed(4), calibration.gyroNoiseDps.toFixed(3));
	console.log();
	console.log(formatTrajectoryTable(trajectory));
	console.log();
	console.log("摘要:", JSON.stringify(trajectory.summary, null, 2));
}

main().catch((error: unknown) => {
	console.error("导入失败:", error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
