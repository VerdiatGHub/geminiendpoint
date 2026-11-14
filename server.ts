import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { GoogleGenAI, ThinkingLevel, type GenerateContentResponse } from '@google/genai';
import {
  MODEL_CATALOG,
  createSlidingWindowRateLimiter,
  formatOpenAIChatChunk,
  formatOpenAIChatCompletion,
  summarizeGatewayStats,
  validateChatCompletionRequest,
  validateEmbeddingRequest,
  validateGenerateRequest,
  type RequestLogEntry,
  type ThinkingLevelValue,
  type UsageSummary,
} from './src/shared/inference.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_LOGS = 100;

let cachedAiClient: GoogleGenAI | null = null;
function getAiClient(): GoogleGenAI {
  if (!cachedAiClient) {
    cachedAiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedAiClient;
}

const rateLimiter = createSlidingWindowRateLimiter(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
const requestLogs: RequestLogEntry[] = [];
const serverStartedAt = Date.now();

function recordLog(entry: RequestLogEntry) {
  requestLogs.unshift(entry);
  if (requestLogs.length > MAX_LOGS) {
    requestLogs.length = MAX_LOGS;
  }
}

function resolvePublicBaseUrl(req: Request): string {
  const host = req.get('host');
  const protoHeader = req.get('x-forwarded-proto');
  const protocol = protoHeader ? protoHeader.split(',')[0].trim() : req.protocol;

  if (host && !/^localhost(?::\d+)?$/i.test(host) && !/^127\.0\.0\.1(?::\d+)?$/.test(host)) {
    return `${protocol}://${host}`.replace(/\/+$/, '');
  }

  const configured = process.env.APP_URL?.trim();
  if (configured && configured !== 'MY_APP_URL' && /^https?:\/\//i.test(configured)) {
    return configured.replace(/\/+$/, '');
  }
  return `${protocol}://${host ?? `localhost:${PORT}`}`;
}

function toSdkThinkingLevel(level?: ThinkingLevelValue): ThinkingLevel | undefined {
  if (!level) return undefined;
  return ThinkingLevel[level];
}

function extractUsage(response: GenerateContentResponse): UsageSummary {
  const meta = response.usageMetadata;
  const promptTokens = meta?.promptTokenCount ?? 0;
  const completionTokens = meta?.candidatesTokenCount ?? 0;
  const totalTokens = meta?.totalTokenCount ?? promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

function parseGeminiError(err: unknown): { status: number; message: string; code: string } {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const statusMatch = rawMessage.match(/\b(400|401|403|404|429|500|502|503|504)\b/);
  const parsedStatus =
    typeof (err as { status?: unknown })?.status === 'number'
      ? ((err as { status: number }).status)
      : statusMatch
        ? Number(statusMatch[1])
        : 500;

  if (rawMessage.includes('API_KEY_INVALID') || rawMessage.includes('API key not valid')) {
    return {
      status: 400,
      code: 'api_key_invalid',
      message: 'Upstream Gemini API key is missing or invalid. Verify GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (rawMessage.includes('PERMISSION_DENIED') || parsedStatus === 403) {
    return {
      status: 403,
      code: 'permission_denied',
      message: 'Upstream Gemini API returned permission denied. Verify GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (rawMessage.includes('RESOURCE_EXHAUSTED') || parsedStatus === 429) {
    return {
      status: 429,
      code: 'rate_limit_exceeded',
      message: 'Upstream Gemini quota exceeded (429). Retry shortly or upgrade your key tier in Settings > Secrets.',
    };
  }
  if (rawMessage.includes('NOT_FOUND') || parsedStatus === 404) {
    return {
      status: 404,
      code: 'model_not_found',
      message: `Requested model was not found or is unsupported: ${rawMessage}`,
    };
  }

  return {
    status: parsedStatus >= 400 && parsedStatus < 600 ? parsedStatus : 500,
    code: 'inference_error',
    message: rawMessage || 'Unexpected inference error.',
  };
}

async function withTransientRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const parsed = parseGeminiError(err);
      const retryable = parsed.status === 503 || parsed.status === 502 || parsed.status === 504;
      if (!retryable || attempt === maxRetries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw lastError;
}

function applyCors(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, Accept'
  );
  res.setHeader(
    'Access-Control-Expose-Headers',
    'X-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset'
  );
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

function applyRateLimit(req: Request, res: Response, next: NextFunction) {
  const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
  const decision = rateLimiter.check(clientKey);
  res.setHeader('X-RateLimit-Limit', String(decision.limit));
  res.setHeader('X-RateLimit-Remaining', String(decision.remaining));
  res.setHeader('X-RateLimit-Reset', String(decision.resetUnixSeconds));

  if (!decision.allowed) {
    res.status(429).json({
      error: {
        message: 'Gateway rate limit exceeded (60 requests per minute).',
        type: 'rate_limit_error',
        code: 'gateway_rate_limited',
      },
    });
    return;
  }
  next();
}

async function createServer() {
  const app = express();
  app.set('trust proxy', true);
  app.use(applyCors);
  app.use(express.json({ limit: '4mb' }));

  app.use((req, res, next) => {
    const requestId = `req_${crypto.randomUUID().slice(0, 12)}`;
    res.setHeader('X-Request-Id', requestId);
    res.locals.requestId = requestId;
    next();
  });

  // Public Health Endpoint
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'gemini-gateway',
      uptimeSeconds: Math.floor((Date.now() - serverStartedAt) / 1000),
      timestamp: new Date().toISOString(),
      models: MODEL_CATALOG.map((m) => m.id),
    });
  });

  // OpenAI-compatible Model Listing Endpoint
  app.get('/v1/models', (_req, res) => {
    const created = Math.floor(serverStartedAt / 1000);
    res.json({
      object: 'list',
      data: MODEL_CATALOG.map((m) => ({
        id: m.id,
        object: 'model',
        created,
        owned_by: 'google-gemini',
        capability: m.capability,
        context_window: m.contextWindow,
        supported_thinking_levels: m.supportedThinkingLevels,
        streaming_supported: m.streamingSupported,
        description: m.description,
      })),
    });
  });

  // OpenAI-compatible Chat Completions Endpoint (JSON + SSE streaming)
  app.post('/v1/chat/completions', applyRateLimit, async (req, res) => {
    const startMs = Date.now();
    const requestId = String(res.locals.requestId || `chatcmpl-${crypto.randomUUID().slice(0, 12)}`);
    const validation = validateChatCompletionRequest(req.body);

    if (!validation.ok) {
      const latencyMs = Date.now() - startMs;
      recordLog({
        id: requestId,
        timestamp: new Date().toISOString(),
        method: 'POST',
        path: '/v1/chat/completions',
        model: String((req.body as Record<string, unknown>)?.model || 'gemini-4-hydrogen'),
        status: validation.status,
        stream: Boolean((req.body as Record<string, unknown>)?.stream),
        latencyMs,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        promptPreview: '',
        errorMessage: validation.error,
      });
      res.status(validation.status).json({
        error: {
          message: validation.error,
          type: 'invalid_request_error',
          code: 'invalid_request',
        },
      });
      return;
    }

    const { model, systemInstruction, contents, stream, thinkingLevel, responseMimeType, seed } =
      validation.data;
    const lastUserText =
      [...contents].reverse().find((c) => c.role === 'user')?.parts[0]?.text ?? '';
    const promptPreview = lastUserText.slice(0, 120);

    const config: Record<string, unknown> = {};
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (responseMimeType) config.responseMimeType = responseMimeType;
    if (seed !== undefined) config.seed = seed;
    const sdkThinking = toSdkThinkingLevel(thinkingLevel);
    if (sdkThinking) {
      config.thinkingConfig = { thinkingLevel: sdkThinking };
    }

    if (stream) {
      const created = Math.floor(Date.now() / 1000);
      let headersSent = false;
      let ttftMs: number | undefined;
      let lastUsage: UsageSummary = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      try {
        const streamResp = await getAiClient().models.generateContentStream({
          model,
          contents,
          config: Object.keys(config).length > 0 ? config : undefined,
        });

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        headersSent = true;

        let isFirstChunk = true;
        for await (const chunk of streamResp) {
          const c = chunk as GenerateContentResponse;
          if (c.usageMetadata) {
            lastUsage = extractUsage(c);
          }
          const deltaText = c.text ?? '';
          if (deltaText || isFirstChunk) {
            if (ttftMs === undefined) {
              ttftMs = Date.now() - startMs;
            }
            const payload = formatOpenAIChatChunk({
              id: requestId,
              created,
              model,
              deltaContent: deltaText,
              includeRole: isFirstChunk,
              finishReason: null,
            });
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
            isFirstChunk = false;
          }
        }

        const finalPayload = formatOpenAIChatChunk({
          id: requestId,
          created,
          model,
          finishReason: 'stop',
        });
        res.write(`data: ${JSON.stringify(finalPayload)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();

        recordLog({
          id: requestId,
          timestamp: new Date().toISOString(),
          method: 'POST',
          path: '/v1/chat/completions',
          model,
          status: 200,
          stream: true,
          latencyMs: Date.now() - startMs,
          ttftMs,
          usage: lastUsage,
          promptPreview,
        });
      } catch (err) {
        const parsed = parseGeminiError(err);
        recordLog({
          id: requestId,
          timestamp: new Date().toISOString(),
          method: 'POST',
          path: '/v1/chat/completions',
          model,
          status: parsed.status,
          stream: true,
          latencyMs: Date.now() - startMs,
          ttftMs,
          usage: lastUsage,
          promptPreview,
          errorMessage: parsed.message,
        });

        if (!headersSent) {
          res.status(parsed.status).json({
            error: {
              message: parsed.message,
              type: 'api_error',
              code: parsed.code,
            },
          });
        } else {
          res.write(
            `data: ${JSON.stringify({ error: { message: parsed.message, code: parsed.code } })}\n\n`
          );
          res.write('data: [DONE]\n\n');
          res.end();
        }
      }
      return;
    }

    try {
      const response = await withTransientRetry(() =>
        getAiClient().models.generateContent({
          model,
          contents,
          config: Object.keys(config).length > 0 ? config : undefined,
        })
      );

      const usage = extractUsage(response);
      const latencyMs = Date.now() - startMs;
      const text = response.text ?? '';

      recordLog({
        id: requestId,
        timestamp: new Date().toISOString(),
        method: 'POST',
        path: '/v1/chat/completions',
        model,
        status: 200,
        stream: false,
        latencyMs,
        usage,
        promptPreview,
      });

      res.json(
        formatOpenAIChatCompletion({
          id: requestId,
          created: Math.floor(Date.now() / 1000),
          model,
          text,
          usage,
        })
      );
    } catch (err) {
      const parsed = parseGeminiError(err);
      recordLog({
        id: requestId,
        timestamp: new Date().toISOString(),
        method: 'POST',
        path: '/v1/chat/completions',
        model,
        status: parsed.status,
        stream: false,
        latencyMs: Date.now() - startMs,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        promptPreview,
        errorMessage: parsed.message,
      });
      res.status(parsed.status).json({
        error: {
          message: parsed.message,
          type: 'api_error',
          code: parsed.code,
        },
      });
    }
  });

  // Direct Gemini-Native Inference Endpoint (JSON + SSE streaming)
  app.post('/v1/generate', applyRateLimit, async (req, res) => {
    const startMs = Date.now();
    const requestId = String(res.locals.requestId || `gen-${crypto.randomUUID().slice(0, 12)}`);
    const validation = validateGenerateRequest(req.body);

    if (!validation.ok) {
      recordLog({
        id: requestId,
        timestamp: new Date().toISOString(),
        method: 'POST',
        path: '/v1/generate',
        model: String((req.body as Record<string, unknown>)?.model || 'gemini-4-hydrogen'),
        status: validation.status,
        stream: Boolean((req.body as Record<string, unknown>)?.stream),
        latencyMs: Date.now() - startMs,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        promptPreview: '',
        errorMessage: validation.error,
      });
      res.status(validation.status).json({
        error: {
          message: validation.error,
          type: 'invalid_request_error',
          code: 'invalid_request',
        },
      });
      return;
    }

    const { model, prompt, systemInstruction, stream, thinkingLevel, responseMimeType, seed } =
      validation.data;
    const promptPreview = prompt.slice(0, 120);

    const config: Record<string, unknown> = {};
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (responseMimeType) config.responseMimeType = responseMimeType;
    if (seed !== undefined) config.seed = seed;
    const sdkThinking = toSdkThinkingLevel(thinkingLevel);
    if (sdkThinking) {
      config.thinkingConfig = { thinkingLevel: sdkThinking };
    }

    if (stream) {
      let headersSent = false;
      let ttftMs: number | undefined;
      let lastUsage: UsageSummary = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      try {
        const streamResp = await getAiClient().models.generateContentStream({
          model,
          contents: prompt,
          config: Object.keys(config).length > 0 ? config : undefined,
        });

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        headersSent = true;

        for await (const chunk of streamResp) {
          const c = chunk as GenerateContentResponse;
          if (c.usageMetadata) {
            lastUsage = extractUsage(c);
          }
          const deltaText = c.text ?? '';
          if (deltaText) {
            if (ttftMs === undefined) {
              ttftMs = Date.now() - startMs;
            }
            res.write(`data: ${JSON.stringify({ id: requestId, model, text: deltaText })}\n\n`);
          }
        }

        res.write(
          `data: ${JSON.stringify({ id: requestId, model, done: true, usage: lastUsage })}\n\n`
        );
        res.write('data: [DONE]\n\n');
        res.end();

        recordLog({
          id: requestId,
          timestamp: new Date().toISOString(),
          method: 'POST',
          path: '/v1/generate',
          model,
          status: 200,
          stream: true,
          latencyMs: Date.now() - startMs,
          ttftMs,
          usage: lastUsage,
          promptPreview,
        });
      } catch (err) {
        const parsed = parseGeminiError(err);
        recordLog({
          id: requestId,
          timestamp: new Date().toISOString(),
          method: 'POST',
          path: '/v1/generate',
          model,
          status: parsed.status,
          stream: true,
          latencyMs: Date.now() - startMs,
          ttftMs,
          usage: lastUsage,
          promptPreview,
          errorMessage: parsed.message,
        });
        if (!headersSent) {
          res.status(parsed.status).json({
            error: { message: parsed.message, type: 'api_error', code: parsed.code },
          });
        } else {
          res.write(`data: ${JSON.stringify({ error: { message: parsed.message } })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        }
      }
      return;
    }

    try {
      const response = await withTransientRetry(() =>
        getAiClient().models.generateContent({
          model,
          contents: prompt,
          config: Object.keys(config).length > 0 ? config : undefined,
        })
      );

      const usage = extractUsage(response);
      const latencyMs = Date.now() - startMs;

      recordLog({
        id: requestId,
        timestamp: new Date().toISOString(),
        method: 'POST',
        path: '/v1/generate',
        model,
        status: 200,
        stream: false,
        latencyMs,
        usage,
        promptPreview,
      });

      res.json({
        id: requestId,
        model,
        text: response.text ?? '',
        usage,
        latencyMs,
      });
    } catch (err) {
      const parsed = parseGeminiError(err);
      recordLog({
        id: requestId,
        timestamp: new Date().toISOString(),
        method: 'POST',
        path: '/v1/generate',
        model,
        status: parsed.status,
        stream: false,
        latencyMs: Date.now() - startMs,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        promptPreview,
        errorMessage: parsed.message,
      });
      res.status(parsed.status).json({
        error: { message: parsed.message, type: 'api_error', code: parsed.code },
      });
    }
  });

  // Public Embeddings Endpoint
  app.post('/v1/embeddings', applyRateLimit, async (req, res) => {
    const startMs = Date.now();
    const requestId = String(res.locals.requestId || `emb-${crypto.randomUUID().slice(0, 12)}`);
    const validation = validateEmbeddingRequest(req.body);

    if (!validation.ok) {
      recordLog({
        id: requestId,
        timestamp: new Date().toISOString(),
        method: 'POST',
        path: '/v1/embeddings',
        model: String((req.body as Record<string, unknown>)?.model || 'gemini-embedding-2'),
        status: validation.status,
        stream: false,
        latencyMs: Date.now() - startMs,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        promptPreview: '',
        errorMessage: validation.error,
      });
      res.status(validation.status).json({
        error: { message: validation.error, type: 'invalid_request_error', code: 'invalid_request' },
      });
      return;
    }

    const { model, inputs } = validation.data;
    const promptPreview = inputs[0].slice(0, 120);

    try {
      const response = await withTransientRetry(() =>
        getAiClient().models.embedContent({
          model,
          contents: inputs,
        })
      );

      const embeddings = (response.embeddings ?? []).map((item, index) => ({
        object: 'embedding',
        index,
        embedding: item.values ?? [],
      }));

      const approxTokens = inputs.reduce((acc, s) => acc + Math.max(1, Math.ceil(s.length / 4)), 0);
      const usage: UsageSummary = {
        promptTokens: approxTokens,
        completionTokens: 0,
        totalTokens: approxTokens,
      };
      const latencyMs = Date.now() - startMs;

      recordLog({
        id: requestId,
        timestamp: new Date().toISOString(),
        method: 'POST',
        path: '/v1/embeddings',
        model,
        status: 200,
        stream: false,
        latencyMs,
        usage,
        promptPreview,
      });

      res.json({
        object: 'list',
        data: embeddings,
        model,
        usage: {
          prompt_tokens: usage.promptTokens,
          total_tokens: usage.totalTokens,
        },
        latencyMs,
      });
    } catch (err) {
      const parsed = parseGeminiError(err);
      recordLog({
        id: requestId,
        timestamp: new Date().toISOString(),
        method: 'POST',
        path: '/v1/embeddings',
        model,
        status: parsed.status,
        stream: false,
        latencyMs: Date.now() - startMs,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        promptPreview,
        errorMessage: parsed.message,
      });
      res.status(parsed.status).json({
        error: { message: parsed.message, type: 'api_error', code: parsed.code },
      });
    }
  });

  // Console Telemetry & Metadata Endpoints (never expose API keys)
  app.get('/api/gateway/info', (req, res) => {
    const publicBaseUrl = resolvePublicBaseUrl(req);
    res.json({
      publicBaseUrl,
      uptimeSeconds: Math.floor((Date.now() - serverStartedAt) / 1000),
      rateLimit: {
        maxRequests: RATE_LIMIT_MAX,
        windowSeconds: RATE_LIMIT_WINDOW_MS / 1000,
      },
      models: MODEL_CATALOG,
      stats: summarizeGatewayStats(requestLogs),
    });
  });

  app.get('/api/gateway/logs', (_req, res) => {
    res.json({
      logs: requestLogs,
      stats: summarizeGatewayStats(requestLogs),
    });
  });

  app.delete('/api/gateway/logs', (_req, res) => {
    requestLogs.length = 0;
    res.json({
      logs: [],
      stats: summarizeGatewayStats(requestLogs),
    });
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gemini Gateway listening on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start Gemini Gateway server:', err);
  process.exit(1);
});
