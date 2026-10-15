import type { SpatialObservation } from "./incremental-spatial-memory.js";
import { SpatialTopologyService } from "./spatial-topology-service.js";

/** Timer owns scheduling only. Source timestamps must share the supplied clock domain. */
export class SpatialTopologyWorker {
	private timer: ReturnType<typeof setInterval> | null = null;
	private active: Promise<void> | null = null;
	private paused = false;
	private lastError: string | null = null;
	constructor(private readonly service: Pick<SpatialTopologyService,"ingest"|"tick"|"summary">, private readonly clock: () => number = Date.now, private readonly intervalMs = 1000) {
		if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new Error("Invalid timer interval");
	}
	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => { void this.pump(); },this.intervalMs);
		this.timer.unref();
	}
	async accept(observation: SpatialObservation): Promise<void> {
		await this.service.ingest(observation);
		if(this.timer)void this.pump(); // Stopped workers accept durably without starting paid calls.
	}
	status() {
		const state = this.service.summary();
		return { running:this.timer!==null, busy:this.active!==null, paused:this.paused, lastError:this.lastError,...state, hasUnprocessedObservations:state.pending>0 };
	}
	resume(): void { this.paused=false; this.lastError=null; }
	pump(): Promise<void> {
		if(this.active)return this.active;
		if(this.paused)return Promise.resolve();
		const task=this.service.tick(this.clock()).catch(error=>{
			this.paused=true;this.lastError=(error as Error).name; // No provider body/credentials.
		}).finally(()=>{if(this.active===task)this.active=null;});
		this.active=task;return task;
	}
	async stop(): Promise<void> {
		if(this.timer)clearInterval(this.timer);this.timer=null;
		await this.active; // Pending stays durable; never implicit drain or paid retry.
	}
}
