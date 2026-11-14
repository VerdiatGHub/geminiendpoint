export type EndpointPath =
  | '/v1/chat/completions'
  | '/v1/generate'
  | '/v1/embeddings'
  | '/v1/models'
  | '/health';

export type ModelCapability = 'text' | 'embeddings';

export type ThinkingLevelValue = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH' | 'XHIGH';

export interface ModelSpec {
  id: string;
  label: string;
  capability: ModelCapability;
  contextWindow: string;
  supportedThinkingLevels: ThinkingLevelValue[];
  defaultThinkingLevel?: ThinkingLevelValue;
  streamingSupported: boolean;
  description: string;
}

export const MODEL_CATALOG: ModelSpec[] = [
  {
    id: 'gemini-4-hydrogen',
    label: 'Gemini 4 Hydrogen',
    capability: 'text',
    contextWindow: '1M tokens',
    supportedThinkingLevels: ['LOW', 'MEDIUM', 'HIGH', 'XHIGH'],
    defaultThinkingLevel: 'HIGH',
    streamingSupported: true,
    description: 'Balanced high-intelligence text and reasoning model for general inference, chat, and structured JSON.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite',
    capability: 'text',
    contextWindow: '1M tokens',
    supportedThinkingLevels: ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'],
    defaultThinkingLevel: 'MINIMAL',
    streamingSupported: true,
    description: 'Ultra-low-latency model optimized for high-throughput endpoints, classification, and instant responses.',
  },
  {
    id: 'gemini-embedding-2',
    label: 'Gemini Embedding 2',
    capability: 'embeddings',
    contextWindow: '8K tokens',
    supportedThinkingLevels: [],
    streamingSupported: false,
    description: 'Dense semantic vector embedding model for search, RAG pipelines, clustering, and similarity.',
  },
];

export const DEFAULT_TEXT_MODEL = 'gemini-4-hydrogen';
export const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-2';

export interface ChatMessage {
  role: 'system' | 'developer' | 'user' | 'assistant';
  content: string | Array<{ type?: string; text?: string }>;
}

export interface NormalizedChatRequest {
  model: string;
  systemInstruction?: string;
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
  stream: boolean;
  thinkingLevel?: ThinkingLevelValue;
  responseMimeType?: string;
  seed?: number;
}

export interface NormalizedGenerateRequest {
  model: string;
  prompt: string;
  systemInstruction?: string;
  stream: boolean;
  thinkingLevel?: ThinkingLevelValue;
  responseMimeType?: string;
  seed?: number;
}

export interface NormalizedEmbeddingRequest {
  model: string;
  inputs: string[];
}

export interface UsageSummary {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface RequestLogEntry {
  id: string;
  timestamp: string;
  method: 'GET' | 'POST';
  path: string;
  model: string;
  status: number;
  stream: boolean;
  latencyMs: number;
  ttftMs?: number;
  usage: UsageSummary;
  promptPreview: string;
  errorMessage?: string;
}

export interface GatewayStats {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgLatencyMs: number;
  totalTokens: number;
}

export function extractMessageText(content: ChatMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function findModelSpec(modelId: string): ModelSpec | undefined {
  return MODEL_CATALOG.find((m) => m.id === modelId);
}

export function normalizeThinkingLevel(
  modelId: string,
  rawLevel: unknown
): { value?: ThinkingLevelValue; error?: string } {
  if (rawLevel === undefined || rawLevel === null || rawLevel === '') {
    return {};
  }
  if (typeof rawLevel !== 'string') {
    return { error: 'thinkingLevel must be a string.' };
  }
  const upper = rawLevel.trim().toUpperCase() as ThinkingLevelValue;
  const spec = findModelSpec(modelId);
  if (!spec) {
    // Allow pass-through if a custom model name was explicitly requested
    if (['MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH'].includes(upper)) {
      return { value: upper };
    }
    return { error: `Unsupported thinking level "${rawLevel}".` };
  }
  if (spec.supportedThinkingLevels.length === 0) {
    return { error: `Model "${modelId}" does not support thinkingLevel.` };
  }
  if (!spec.supportedThinkingLevels.includes(upper)) {
    return {
      error: `Model "${modelId}" supports thinking levels: ${spec.supportedThinkingLevels.join(', ')}.`,
    };
  }
  return { value: upper };
}

export function validateChatCompletionRequest(
  body: unknown
): { ok: true; data: NormalizedChatRequest } | { ok: false; status: number; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, error: 'Request body must be a JSON object.' };
  }
  const record = body as Record<string, unknown>;
  const model =
    typeof record.model === 'string' && record.model.trim()
      ? record.model.trim()
      : DEFAULT_TEXT_MODEL;

  const modelSpec = findModelSpec(model);
  if (modelSpec && modelSpec.capability !== 'text') {
    return {
      ok: false,
      status: 400,
      error: `Model "${model}" is an embeddings model and cannot be used with /v1/chat/completions.`,
    };
  }

  if (!Array.isArray(record.messages) || record.messages.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'Field "messages" is required and must be a non-empty array.',
    };
  }

  const systemParts: string[] = [];
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  for (let i = 0; i < record.messages.length; i++) {
    const msg = record.messages[i] as Record<string, unknown>;
    if (!msg || typeof msg !== 'object') {
      return { ok: false, status: 400, error: `messages[${i}] must be an object.` };
    }
    const role = msg.role;
    const text = extractMessageText(msg.content as ChatMessage['content']).trim();
    if (!text) {
      return { ok: false, status: 400, error: `messages[${i}].content must not be empty.` };
    }

    if (role === 'system' || role === 'developer') {
      systemParts.push(text);
    } else if (role === 'user') {
      contents.push({ role: 'user', parts: [{ text }] });
    } else if (role === 'assistant') {
      contents.push({ role: 'model', parts: [{ text }] });
    } else {
      return {
        ok: false,
        status: 400,
        error: `messages[${i}].role must be one of system, developer, user, assistant.`,
      };
    }
  }

  if (contents.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'At least one user or assistant message is required.',
    };
  }

  const rawThinking = record.thinking_level ?? record.thinkingLevel ?? record.reasoning_effort;
  const thinking = normalizeThinkingLevel(model, rawThinking);
  if (thinking.error) {
    return { ok: false, status: 400, error: thinking.error };
  }

  let responseMimeType: string | undefined;
  const responseFormat = record.response_format as Record<string, unknown> | undefined;
  if (responseFormat && typeof responseFormat === 'object') {
    if (responseFormat.type === 'json_object' || responseFormat.type === 'json_schema') {
      responseMimeType = 'application/json';
    }
  }

  const seed = typeof record.seed === 'number' && Number.isInteger(record.seed) ? record.seed : undefined;

  return {
    ok: true,
    data: {
      model,
      systemInstruction: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
      contents,
      stream: Boolean(record.stream),
      thinkingLevel: thinking.value,
      responseMimeType,
      seed,
    },
  };
}

export function validateGenerateRequest(
  body: unknown
): { ok: true; data: NormalizedGenerateRequest } | { ok: false; status: number; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, error: 'Request body must be a JSON object.' };
  }
  const record = body as Record<string, unknown>;
  const model =
    typeof record.model === 'string' && record.model.trim()
      ? record.model.trim()
      : DEFAULT_TEXT_MODEL;

  const modelSpec = findModelSpec(model);
  if (modelSpec && modelSpec.capability !== 'text') {
    return {
      ok: false,
      status: 400,
      error: `Model "${model}" is an embeddings model and cannot be used with /v1/generate.`,
    };
  }

  const rawPrompt =
    typeof record.prompt === 'string'
      ? record.prompt
      : typeof record.contents === 'string'
        ? record.contents
        : '';

  if (!rawPrompt.trim()) {
    return {
      ok: false,
      status: 400,
      error: 'Field "prompt" (or "contents") is required and must be a non-empty string.',
    };
  }

  const thinking = normalizeThinkingLevel(model, record.thinkingLevel ?? record.thinking_level);
  if (thinking.error) {
    return { ok: false, status: 400, error: thinking.error };
  }

  const systemInstruction =
    typeof record.systemInstruction === 'string' && record.systemInstruction.trim()
      ? record.systemInstruction.trim()
      : typeof record.system_instruction === 'string' && record.system_instruction.trim()
        ? record.system_instruction.trim()
        : undefined;

  const responseMimeType =
    typeof record.responseMimeType === 'string' && record.responseMimeType.trim()
      ? record.responseMimeType.trim()
      : undefined;

  const seed = typeof record.seed === 'number' && Number.isInteger(record.seed) ? record.seed : undefined;

  return {
    ok: true,
    data: {
      model,
      prompt: rawPrompt.trim(),
      systemInstruction,
      stream: Boolean(record.stream),
      thinkingLevel: thinking.value,
      responseMimeType,
      seed,
    },
  };
}

export function validateEmbeddingRequest(
  body: unknown
): { ok: true; data: NormalizedEmbeddingRequest } | { ok: false; status: number; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, error: 'Request body must be a JSON object.' };
  }
  const record = body as Record<string, unknown>;
  const model =
    typeof record.model === 'string' && record.model.trim()
      ? record.model.trim()
      : DEFAULT_EMBEDDING_MODEL;

  const rawInput = record.input ?? record.contents;
  let inputs: string[] = [];
  if (typeof rawInput === 'string') {
    if (rawInput.trim()) {
      inputs = [rawInput.trim()];
    }
  } else if (Array.isArray(rawInput)) {
    inputs = rawInput
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim());
  }

  if (inputs.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'Field "input" is required and must be a non-empty string or array of strings.',
    };
  }

  if (inputs.length > 32) {
    return {
      ok: false,
      status: 400,
      error: 'Batch size for "input" cannot exceed 32 strings per request.',
    };
  }

  return {
    ok: true,
    data: { model, inputs },
  };
}

export function formatOpenAIChatCompletion(params: {
  id: string;
  created: number;
  model: string;
  text: string;
  usage: UsageSummary;
  finishReason?: string;
}) {
  return {
    id: params.id,
    object: 'chat.completion',
    created: params.created,
    model: params.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: params.text,
        },
        finish_reason: params.finishReason ?? 'stop',
      },
    ],
    usage: {
      prompt_tokens: params.usage.promptTokens,
      completion_tokens: params.usage.completionTokens,
      total_tokens: params.usage.totalTokens,
    },
  };
}

export function formatOpenAIChatChunk(params: {
  id: string;
  created: number;
  model: string;
  deltaContent?: string;
  includeRole?: boolean;
  finishReason?: string | null;
}) {
  const delta: Record<string, string> = {};
  if (params.includeRole) {
    delta.role = 'assistant';
  }
  if (params.deltaContent !== undefined) {
    delta.content = params.deltaContent;
  }
  return {
    id: params.id,
    object: 'chat.completion.chunk',
    created: params.created,
    model: params.model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: params.finishReason ?? null,
      },
    ],
  };
}

export function summarizeGatewayStats(logs: RequestLogEntry[]): GatewayStats {
  const totalRequests = logs.length;
  if (totalRequests === 0) {
    return {
      totalRequests: 0,
      successCount: 0,
      errorCount: 0,
      successRate: 100,
      avgLatencyMs: 0,
      totalTokens: 0,
    };
  }

  let successCount = 0;
  let latencySum = 0;
  let totalTokens = 0;

  for (const entry of logs) {
    if (entry.status >= 200 && entry.status < 400) {
      successCount += 1;
    }
    latencySum += entry.latencyMs;
    totalTokens += entry.usage.totalTokens;
  }

  const errorCount = totalRequests - successCount;
  const successRate = Math.round((successCount / totalRequests) * 1000) / 10;
  const avgLatencyMs = Math.round(latencySum / totalRequests);

  return {
    totalRequests,
    successCount,
    errorCount,
    successRate,
    avgLatencyMs,
    totalTokens,
  };
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetUnixSeconds: number;
}

export function createSlidingWindowRateLimiter(maxRequests: number, windowMs: number) {
  const buckets = new Map<string, number[]>();

  return {
    check(key: string, nowMs: number = Date.now()): RateLimitDecision {
      const cutoff = nowMs - windowMs;
      const existing = buckets.get(key) ?? [];
      const active = existing.filter((ts) => ts > cutoff);

      if (active.length >= maxRequests) {
        buckets.set(key, active);
        const oldest = active[0] ?? nowMs;
        return {
          allowed: false,
          limit: maxRequests,
          remaining: 0,
          resetUnixSeconds: Math.ceil((oldest + windowMs) / 1000),
        };
      }

      active.push(nowMs);
      buckets.set(key, active);
      const oldest = active[0] ?? nowMs;
      return {
        allowed: true,
        limit: maxRequests,
        remaining: Math.max(0, maxRequests - active.length),
        resetUnixSeconds: Math.ceil((oldest + windowMs) / 1000),
      };
    },
    clear() {
      buckets.clear();
    },
  };
}
