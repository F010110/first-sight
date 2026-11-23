export const CAMERA_DIRECTIONS = ['front', 'left', 'right'] as const;
export type CameraDirection = (typeof CAMERA_DIRECTIONS)[number];
export type DemoMode = 'describe' | 'ocr' | 'identify' | 'custom';

export interface VisionFrame {
  direction: CameraDirection;
  id: string;
  atMs: number;
  ageMs: number;
  sha256: string;
  jpegBase64: string;
  source: 'esp32' | 'manual';
}

export interface VisionRequest {
  mode: DemoMode;
  question: string;
  frames: VisionFrame[];
  missingDirections: CameraDirection[];
  signal?: AbortSignal;
}

export interface VisionUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface VisionResponse {
  answer: string;
  spokenText: string;
  model: string;
  latencyMs: number;
  usage?: VisionUsage;
}

export type VisionProvider = (req: VisionRequest) => Promise<VisionResponse>;

export interface WatchCheckRequest {
  target: string;
  frames: VisionFrame[];
  missingDirections: CameraDirection[];
  signal?: AbortSignal;
}

export interface WatchCheckResult {
  found: boolean;
  direction: '正前方' | '左侧' | '右侧' | '未知';
  summary: string;
  model: string;
  latencyMs: number;
}

export type WatchCheckProvider = (req: WatchCheckRequest) => Promise<WatchCheckResult>;

export interface EvidenceRef {
  direction: CameraDirection;
  filename: string;
  url: string;
}

export interface QaRecord {
  id: string;
  speakId: string;
  mode: DemoMode;
  question: string;
  answer: string;
  spokenText: string;
  model: string;
  latencyMs: number;
  directions: CameraDirection[];
  missingDirections: CameraDirection[];
  evidenceUrls: EvidenceRef[];
  createdAtMs: number;
  source: 'desktop' | 'mobile';
}

export interface WatchAlertRecord {
  id: string;
  speakId: string;
  target: string;
  direction: '正前方' | '左侧' | '右侧' | '未知';
  summary: string;
  spokenText: string;
  model: string;
  latencyMs: number;
  evidenceUrls: EvidenceRef[];
  createdAtMs: number;
}

export type WatchStatus = 'active' | 'triggered' | 'cancelled' | 'expired' | 'failed';

export interface WatchTask {
  id: string;
  target: string;
  status: WatchStatus;
  createdAtMs: number;
  expiresAtMs: number;
  checks: number;
  hitCount: number;
  lastCheckedAtMs: number | null;
  lastAlertAtMs: number | null;
  alert: WatchAlertRecord | null;
  error: string | null;
}

export type ReplayEvent =
  | { kind: 'qa'; record: QaRecord }
  | { kind: 'watch-alert'; record: WatchAlertRecord };

export interface SessionSummary {
  sessionId: string;
  startedAtMs: number;
  eventCount: number;
  qaCount: number;
  alertCount: number;
}
