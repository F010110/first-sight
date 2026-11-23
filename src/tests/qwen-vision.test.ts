import assert from 'node:assert/strict';
import test from 'node:test';
import type { VisionFrame } from '../types.js';
import { buildVisionPrompts, toSpokenText } from '../vision/qwen-vision.js';

const SAMPLE_FRAME: VisionFrame = {
  direction: 'front',
  id: 'front:b1:1',
  atMs: 1000,
  ageMs: 1200,
  sha256: 'abc',
  jpegBase64: 'ZmFrZQ==',
  source: 'esp32',
};

test('toSpokenText strips markdown formatting and collapses newlines cleanly', () => {
  const input = '## 环境概述\n1. **正前方**：有一张白色书桌。\n- **左侧**：`水杯`\n> 请注意地面';
  const spoken = toSpokenText(input);
  assert.equal(spoken, '环境概述 正前方：有一张白色书桌。 左侧：水杯 请注意地面');
});

test('buildVisionPrompts handles all four modes and warns on missing directions', () => {
  for (const mode of ['describe', 'ocr', 'identify', 'custom'] as const) {
    const { systemPrompt, userPrompt } = buildVisionPrompts({
      mode,
      question: mode === 'custom' ? '桌上有几本书？' : '',
      frames: [SAMPLE_FRAME],
      missingDirections: ['left', 'right'],
    });
    assert.match(systemPrompt, /正前方|相对方位/);
    assert.match(systemPrompt, /安全/);
    assert.match(userPrompt, /正前方 \(front\)/);
    assert.match(userPrompt, /缺失以下视角：左侧 \(left\)、右侧 \(right\)/);
    if (mode === 'custom') {
      assert.match(userPrompt, /桌上有几本书？/);
    }
  }
});
