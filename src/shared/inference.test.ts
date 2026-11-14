import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSlidingWindowRateLimiter,
  formatOpenAIChatChunk,
  formatOpenAIChatCompletion,
  summarizeGatewayStats,
  validateChatCompletionRequest,
  validateEmbeddingRequest,
  validateGenerateRequest,
  type RequestLogEntry,
} from './inference.ts';

test('validateChatCompletionRequest maps system and multi-turn messages cleanly', () => {
  const result = validateChatCompletionRequest({
    model: 'gemini-4-hydrogen',
    messages: [
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'user', content: 'Explain TLS.' },
    ],
    stream: true,
    thinking_level: 'low',
    response_format: { type: 'json_object' },
    seed: 42,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.data.model, 'gemini-4-hydrogen');
  assert.equal(result.data.systemInstruction, 'Be concise.');
  assert.equal(result.data.stream, true);
  assert.equal(result.data.thinkingLevel, 'LOW');
  assert.equal(result.data.responseMimeType, 'application/json');
  assert.equal(result.data.seed, 42);
  assert.deepEqual(result.data.contents, [
    { role: 'user', parts: [{ text: 'Hello' }] },
    { role: 'model', parts: [{ text: 'Hi there' }] },
    { role: 'user', parts: [{ text: 'Explain TLS.' }] },
  ]);
});

test('validateChatCompletionRequest rejects empty messages and invalid thinking levels', () => {
  const missingMessages = validateChatCompletionRequest({ model: 'gemini-4-hydrogen' });
  assert.equal(missingMessages.ok, false);
  if (!missingMessages.ok) {
    assert.equal(missingMessages.status, 400);
  }

  const invalidThinking = validateChatCompletionRequest({
    model: 'gemini-4-hydrogen',
    messages: [{ role: 'user', content: 'Hi' }],
    thinking_level: 'minimal',
  });
  assert.equal(invalidThinking.ok, false);
  if (!invalidThinking.ok) {
    assert.equal(invalidThinking.status, 400);
    assert.match(invalidThinking.error, /LOW, MEDIUM, HIGH, XHIGH/);
  }

  const embedModel = validateChatCompletionRequest({
    model: 'gemini-embedding-2',
    messages: [{ role: 'user', content: 'Hi' }],
  });
  assert.equal(embedModel.ok, false);
});

test('validateGenerateRequest validates prompt and defaults model', () => {
  const valid = validateGenerateRequest({
    prompt: 'Summarize HTTP/3 in one sentence.',
    thinkingLevel: 'medium',
  });
  assert.equal(valid.ok, true);
  if (!valid.ok) return;
  assert.equal(valid.data.model, 'gemini-4-hydrogen');
  assert.equal(valid.data.thinkingLevel, 'MEDIUM');
  assert.equal(valid.data.stream, false);

  const empty = validateGenerateRequest({ prompt: '   ' });
  assert.equal(empty.ok, false);
});

test('validateEmbeddingRequest handles string and batch array inputs', () => {
  const single = validateEmbeddingRequest({ input: 'semantic search' });
  assert.equal(single.ok, true);
  if (single.ok) {
    assert.equal(single.data.model, 'gemini-embedding-2');
    assert.deepEqual(single.data.inputs, ['semantic search']);
  }

  const batch = validateEmbeddingRequest({ input: ['alpha', 'beta'] });
  assert.equal(batch.ok, true);
  if (batch.ok) {
    assert.deepEqual(batch.data.inputs, ['alpha', 'beta']);
  }

  const empty = validateEmbeddingRequest({ input: [] });
  assert.equal(empty.ok, false);
});

test('formatOpenAIChatCompletion and formatOpenAIChatChunk emit standard OpenAI shapes', () => {
  const completion = formatOpenAIChatCompletion({
    id: 'chatcmpl-123',
    created: 1700000000,
    model: 'gemini-4-hydrogen',
    text: 'Ready.',
    usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
  });

  assert.equal(completion.object, 'chat.completion');
  assert.equal(completion.choices[0].message.content, 'Ready.');
  assert.equal(completion.usage.total_tokens, 12);

  const chunk = formatOpenAIChatChunk({
    id: 'chatcmpl-123',
    created: 1700000000,
    model: 'gemini-4-hydrogen',
    deltaContent: 'Hel',
    includeRole: true,
  });

  assert.equal(chunk.object, 'chat.completion.chunk');
  assert.equal(chunk.choices[0].delta.role, 'assistant');
  assert.equal(chunk.choices[0].delta.content, 'Hel');
  assert.equal(chunk.choices[0].finish_reason, null);
});

test('createSlidingWindowRateLimiter enforces limit and recovers after window expires', () => {
  const limiter = createSlidingWindowRateLimiter(2, 1000);
  const r1 = limiter.check('1.2.3.4', 1000);
  const r2 = limiter.check('1.2.3.4', 1200);
  const r3 = limiter.check('1.2.3.4', 1400);
  const r4 = limiter.check('1.2.3.4', 2100);

  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining, 1);
  assert.equal(r2.allowed, true);
  assert.equal(r2.remaining, 0);
  assert.equal(r3.allowed, false);
  assert.equal(r3.remaining, 0);
  assert.equal(r4.allowed, true);
});

test('summarizeGatewayStats computes accurate real telemetry totals', () => {
  const logs: RequestLogEntry[] = [
    {
      id: '1',
      timestamp: '2026-11-13T10:00:00.000Z',
      method: 'POST',
      path: '/v1/chat/completions',
      model: 'gemini-4-hydrogen',
      status: 200,
      stream: false,
      latencyMs: 300,
      usage: { promptTokens: 20, completionTokens: 30, totalTokens: 50 },
      promptPreview: 'Hi',
    },
    {
      id: '2',
      timestamp: '2026-11-13T10:01:00.000Z',
      method: 'POST',
      path: '/v1/generate',
      model: 'gemini-3.1-flash-lite',
      status: 400,
      stream: false,
      latencyMs: 100,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      promptPreview: '',
      errorMessage: 'Bad request',
    },
  ];

  const stats = summarizeGatewayStats(logs);
  assert.equal(stats.totalRequests, 2);
  assert.equal(stats.successCount, 1);
  assert.equal(stats.errorCount, 1);
  assert.equal(stats.successRate, 50);
  assert.equal(stats.avgLatencyMs, 200);
  assert.equal(stats.totalTokens, 50);
});
