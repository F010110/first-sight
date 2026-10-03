import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Tunnel, bin, install } from "cloudflared";
import QRCode from "qrcode";

const port = Number(process.env.VLM_TRIAL_PORT || "8765");
let serverProcess: ChildProcess | null = null;
let tunnel: Tunnel | null = null;

async function stop(): Promise<void> {
	if (tunnel) tunnel.stop();
	if (serverProcess && serverProcess.exitCode === null) {
		serverProcess.kill("SIGTERM");
		await new Promise<void>((resolveExit) => {
			const timeout = setTimeout(resolveExit, 3000);
			serverProcess?.once("exit", () => { clearTimeout(timeout); resolveExit(); });
		});
	}
}

async function waitForServer(): Promise<void> {
	for (let attempt = 0; attempt < 60; attempt++) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
			if (response.ok) return;
		} catch { /* server is still starting */ }
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
	}
	throw new Error("Trial web server did not become ready within 30 seconds");
}

async function main(): Promise<void> {
	if (!existsSync(bin)) {
		process.stdout.write(`Downloading cloudflared to the project dependency directory (${bin})…\n`);
		await install(bin, process.env.CLOUDFLARED_VERSION || "latest");
	}
	serverProcess = spawn(process.execPath, ["--use-env-proxy", "dist/trial-server.js"], { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "inherit"] });
	serverProcess.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
	serverProcess.on("exit", (code) => { if (code && code !== 0) process.stderr.write(`Trial server exited with code ${code}\n`); });
	await waitForServer();
	tunnel = Tunnel.quick(`http://127.0.0.1:${port}`);
	tunnel.on("stderr", (chunk) => process.stderr.write(chunk));
	tunnel.on("error", (error) => process.stderr.write(`Tunnel error: ${error.message}\n`));
	const publicUrl = await Promise.race([
		new Promise<string>((resolveUrl, reject) => {
			tunnel?.on("url", (candidate) => {
				try {
					const parsed = new URL(candidate);
					if (parsed.protocol === "https:" && parsed.hostname.endsWith(".trycloudflare.com") && parsed.hostname !== "api.trycloudflare.com") resolveUrl(parsed.origin);
				} catch { /* ignore non-URL output */ }
			});
			tunnel?.once("exit", (code) => reject(new Error(`Cloudflare tunnel exited before publishing a URL (${code})`)));
		}),
		new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for the temporary HTTPS URL")), 90_000)),
	]);
	await Promise.race([
		new Promise<void>((resolveConnection, reject) => {
			tunnel?.once("connected", () => resolveConnection());
			tunnel?.once("exit", (code) => reject(new Error(`Cloudflare tunnel failed before connecting (${code})`)));
		}),
		new Promise<void>((_, reject) => setTimeout(() => reject(new Error("Tunnel URL was issued, but Cloudflare did not confirm a live connection")), 60_000)),
	]);
	const qrPath = resolve("run/mobile-trial-qr.png");
	const phoneUrl = new URL("/vlm", publicUrl).toString();
	await mkdir(resolve("run"), { recursive: true });
	await QRCode.toFile(qrPath, phoneUrl, { type: "png", width: 720, margin: 2, errorCorrectionLevel: "M" });
	process.stdout.write(`\nPhone URL: ${phoneUrl}\n`);
	process.stdout.write(`QR image: ${qrPath}\n`);
	process.stdout.write("Share the QR and the trial passcode. Press Ctrl+C to end the session.\n");
	await new Promise<void>((resolveExit) => tunnel?.once("exit", () => resolveExit()));
}

process.once("SIGINT", () => { void stop().finally(() => process.exit(0)); });
process.once("SIGTERM", () => { void stop().finally(() => process.exit(0)); });

main().catch((error: unknown) => {
	process.stderr.write(`Mobile trial failed: ${error instanceof Error ? error.message : String(error)}\n`);
	void stop().finally(() => { process.exitCode = 1; });
});
