import type { SegmentObservation } from "./experience-segments.js";

/** Transport-independent capture contract. All times use one recording clock. */
export interface HelmetCaptureObservation {
	schemaVersion: 1;
	recordingId: string;
	id: string;
	atMs: number;
	clockId: string;
	cameras: { direction: "front" | "left" | "right" | "rear"; cameraId: string; frame: string; capturedAtMs: number; timestampSource: "exposure" | "estimated-exposure" | "host-receive" }[];
	/** Raw metadata only: never an identity, location or movement assertion. */
	heading?: { atMs: number; degrees: number; reference: "magnetic-north" | "true-north"; reliable: boolean; uncertaintyDegrees: number; calibrationId?: string };
	calibrationId?: string;
}

/** Explicit policy, not a device-quality acceptance threshold. No I/O/driver. */
export function adaptHelmetCapture(row: HelmetCaptureObservation, policy: { maxSkewMs: number; maxHeadingAgeMs: number }) {
	if (![policy.maxSkewMs, policy.maxHeadingAgeMs].every(value => Number.isFinite(value) && value >= 0)) throw new Error("Invalid capture policy");
	if (row.schemaVersion !== 1 || !row.recordingId || !row.id || !row.clockId || !Number.isFinite(row.atMs) || row.atMs < 0) throw new Error("Invalid capture identity/clock");
	const directions = new Set<string>(), cameraIds = new Set<string>(), frames = new Set<string>();
	for (const camera of row.cameras) {
		if (!["front", "left", "right", "rear"].includes(camera.direction) || directions.has(camera.direction) || !camera.cameraId || cameraIds.has(camera.cameraId) || !camera.frame || frames.has(camera.frame) || !Number.isFinite(camera.capturedAtMs) || camera.capturedAtMs < 0 || !["exposure", "estimated-exposure", "host-receive"].includes(camera.timestampSource)) throw new Error("Invalid/duplicate camera capture");
		directions.add(camera.direction); cameraIds.add(camera.cameraId); frames.add(camera.frame);
	}
	if (!["front", "left", "right"].every(direction => directions.has(direction))) throw new Error("Missing required helmet view");
	const heading = row.heading;
	if (heading && (![heading.atMs, heading.degrees, heading.uncertaintyDegrees].every(Number.isFinite) || heading.atMs < 0 || heading.degrees < 0 || heading.degrees >= 360 || heading.uncertaintyDegrees < 0 || heading.uncertaintyDegrees > 180 || typeof heading.reliable !== "boolean" || !["magnetic-north", "true-north"].includes(heading.reference))) throw new Error("Invalid heading metadata");
	const times = row.cameras.map(camera => camera.capturedAtMs);
	const skewMs = Math.max(...times) - Math.min(...times);
	const issues: string[] = [];
	if (skewMs > policy.maxSkewMs || times.some(time => Math.abs(time - row.atMs) > policy.maxSkewMs)) issues.push("Capture timestamps exceed synchronization budget");
	if (row.cameras.some(camera => camera.timestampSource !== "exposure")) issues.push("Exposure synchronization not verified");
	const headingUsable = !!heading && heading.reliable && !!heading.calibrationId && Math.abs(heading.atMs - row.atMs) <= policy.maxHeadingAgeMs;
	const observation: SegmentObservation = { id: row.id, atMs: row.atMs, frames: ["front", "left", "right"].map(direction => row.cameras.find(camera => camera.direction === direction)!.frame) };
	return { raw: structuredClone(row), observation, eligibleForThreeViewReplay: issues.length === 0, issues, skewMs, headingUsable, note: "Heading usability is metadata eligibility only, not validated camera attitude. Rear view preserved in raw; no compass-derived motion, boundary, position or identity." };
}
