import type {
  CameraDirection,
  DemoMode,
  VisionProvider,
  VisionRequest,
  VisionResponse,
  WatchCheckProvider,
  WatchCheckRequest,
  WatchCheckResult,
} from '../types.js';

const DIRECTION_LABELS: Record<CameraDirection, string> = {
  front: '正前方 (front)',
  left: '左侧 (left)',
  right: '右侧 (right)',
};

export function toSpokenText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/[*_`#>]/g, '')
    .replace(/^\s*[-•\d.]+\s+/gm, '')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function buildVisionPrompts(req: VisionRequest): { systemPrompt: string; userPrompt: string } {
  const attached = req.frames.map((f) => `${DIRECTION_LABELS[f.direction]}（拍摄于 ${(f.ageMs / 1000).toFixed(1)} 秒前）`);
  const missingText = req.missingDirections.length
    ? `当前缺失以下视角：${req.missingDirections.map((d) => DIRECTION_LABELS[d]).join('、')}，严禁臆测或编造缺失方向的内容。`
    : '当前前、左、右三个视角图像均已提供。';

  const modeRules: Record<DemoMode, string> = {
    describe:
      '任务：多视角环境描述。请综合各视角，用2到4句自然流畅的中文，依次说明正前方、左侧和右侧的环境布局、关键物体/人物及显眼文字。',
    ocr:
      '任务：读文字与标牌识别。请准确朗读图像中清晰可见的文字、标识或标签内容，并说明文字位于哪个方向；若反光、模糊或被遮挡导致看不清，请直接说明看不清并建议如何调整角度，不要猜字。',
    identify:
      '任务：物品识别。请识别画面中的主要目标物品（尤其是正前方桌面或手中的物品），说明物品名称、颜色/外观特征及相对用户的方位。',
    custom:
      `任务：回答用户具体问题。用户问题是：“${req.question}”。请直接、准确地根据图像回答，不要套话。`,
  };

  const systemPrompt = [
    '你是佩戴在用户身上的“First Sight”多视角盲人/低视力视觉生活助手。',
    '所有图像均来自同一时刻附近佩戴在头部或胸前的摄像头：正前方(front)、左侧(left)、右侧(right)。',
    '回答约束：',
    '1. 必须使用以用户身体为中心的相对方位（如“正前方”、“左前方”、“左侧”、“右侧”），不要说像素坐标或文件名。',
    '2. 仅描述图片中确实看到的内容；看不清或未拍到的方向如实说明，不得编造。',
    '3. 不做“可以安全走过去/安全过马路”之类的通行安全保证。',
    '4. 输出将直接用于手机语音朗读：请使用简洁自然的中文口语短句，不要使用 Markdown 符号（如 **、#、列表符）。',
  ].join('\n');

  const userPrompt = [
    `已附上视角：${attached.join('；')}。`,
    missingText,
    modeRules[req.mode],
    req.mode !== 'custom' && req.question.trim() ? `补充说明：${req.question.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { systemPrompt, userPrompt };
}

function getQwenCredentials(): { apiKey: string; baseUrl: string } {
  const apiKey = process.env.QWEN_API_KEY?.trim();
  const baseUrl = process.env.QWEN_BASE_URL?.trim();
  if (!apiKey || !baseUrl) {
    throw new Error('未配置 QWEN_API_KEY 或 QWEN_BASE_URL 环境变量');
  }
  return { apiKey, baseUrl };
}

function buildMultimodalUserContent(
  promptText: string,
  frames: VisionRequest['frames'],
): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: promptText }];
  for (const frame of frames) {
    content.push({
      type: 'text',
      text: `[视角: ${DIRECTION_LABELS[frame.direction]} | 来源: ${frame.source === 'esp32' ? 'ESP32硬件相机' : '手动测试图'} | 画面延迟: ${(frame.ageMs / 1000).toFixed(1)}s]`,
    });
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${frame.jpegBase64}` },
    });
  }
  return content;
}

export function createQwenVisionProvider(options: {
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
} = {}): VisionProvider {
  const model = options.model || process.env.QWEN_DEMO_MODEL || 'qwen3.8-flash';
  const timeoutMs = options.timeoutMs ?? 45_000;
  const maxTokens = options.maxTokens ?? 450;

  return async (req: VisionRequest): Promise<VisionResponse> => {
    if (!req.frames.length) {
      throw new Error('当前没有可用相机画面，请先确认相机已连接或上传测试图片');
    }
    const { apiKey, baseUrl } = getQwenCredentials();
    const { systemPrompt, userPrompt } = buildVisionPrompts(req);
    const content = buildMultimodalUserContent(userPrompt, req.frames);

    const body = JSON.stringify({
      model,
      enable_thinking: false,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
    });

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = req.signal ? AbortSignal.any([req.signal, timeoutSignal]) : timeoutSignal;
    const started = performance.now();

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      signal,
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`Qwen API 返回错误 HTTP ${response.status}: ${rawText.slice(0, 240)}`);
    }

    const parsed = JSON.parse(rawText) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const answer = parsed.choices?.[0]?.message?.content?.trim();
    if (!answer) {
      throw new Error('Qwen API 未返回有效文本内容');
    }

    const latencyMs = Math.round(performance.now() - started);
    const spokenText = toSpokenText(answer) || answer;

    const result: VisionResponse = {
      answer,
      spokenText,
      model,
      latencyMs,
    };
    if (
      typeof parsed.usage?.prompt_tokens === 'number' &&
      typeof parsed.usage?.completion_tokens === 'number'
    ) {
      result.usage = {
        promptTokens: parsed.usage.prompt_tokens,
        completionTokens: parsed.usage.completion_tokens,
      };
    }
    return result;
  };
}

export function createQwenWatchChecker(options: {
  model?: string;
  timeoutMs?: number;
} = {}): WatchCheckProvider {
  const model = options.model || process.env.QWEN_DEMO_MODEL || 'qwen3.8-flash';
  const timeoutMs = options.timeoutMs ?? 20_000;

  return async (req: WatchCheckRequest): Promise<WatchCheckResult> => {
    if (!req.frames.length) {
      return { found: false, direction: '未知', summary: '无可用画面', model, latencyMs: 0 };
    }
    const { apiKey, baseUrl } = getQwenCredentials();
    const systemPrompt = [
      '你是视觉目标监测器，负责检查当前图像中是否明确出现了用户正在寻找的目标。',
      '只有当目标在至少一个视角中清晰可见时才返回 found=true；看不清、疑似、未出现或未拍到方向一律返回 found=false。',
      '严格只输出一个 JSON 对象：{"found":boolean,"direction":"正前方"|"左侧"|"右侧"|"未知","summary":"简短中文口语说明（不超过40字）"}。',
    ].join('\n');
    const userPrompt = `监测目标：${req.target}。请检查附上的画面，判断当前是否明确看到该目标，并只输出 JSON。`;
    const content = buildMultimodalUserContent(userPrompt, req.frames);

    const body = JSON.stringify({
      model,
      enable_thinking: false,
      temperature: 0.1,
      max_tokens: 160,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
    });

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = req.signal ? AbortSignal.any([req.signal, timeoutSignal]) : timeoutSignal;
    const started = performance.now();

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      signal,
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`Qwen Watch HTTP ${response.status}: ${rawText.slice(0, 200)}`);
    }

    const parsed = JSON.parse(rawText) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const contentText = (parsed.choices?.[0]?.message?.content ?? '')
      .replace(/^```json\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    const obj = JSON.parse(contentText) as {
      found?: unknown;
      direction?: unknown;
      summary?: unknown;
    };
    const latencyMs = Math.round(performance.now() - started);
    const validDirections = ['正前方', '左侧', '右侧', '未知'] as const;
    const dir = validDirections.includes(obj.direction as (typeof validDirections)[number])
      ? (obj.direction as WatchCheckResult['direction'])
      : '未知';
    const summary = typeof obj.summary === 'string' && obj.summary.trim() ? toSpokenText(obj.summary) : '未检测到目标';

    return {
      found: obj.found === true,
      direction: dir,
      summary,
      model,
      latencyMs,
    };
  };
}
