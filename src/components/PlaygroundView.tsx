import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Play, Square } from 'lucide-react';
import type { EndpointPath, ModelSpec } from '../shared/inference.ts';
import type { PlaygroundDraft } from '../types/gateway.ts';
import { CopyButton } from './CopyButton.tsx';

interface PlaygroundViewProps {
  models: ModelSpec[];
  draft: PlaygroundDraft;
  onDraftChange: (next: PlaygroundDraft) => void;
  onRequestComplete: () => void;
}

type ResponseTab = 'output' | 'raw' | 'payload';

interface RunResult {
  status: number;
  statusText: string;
  latencyMs: number;
  ttftMs?: number;
  outputText: string;
  rawBody: string;
  embeddingDimensions?: number;
  embeddingPreview?: number[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  errorMessage?: string;
}

const PRESETS: Array<{ label: string; draft: Partial<PlaygroundDraft> }> = [
  {
    label: 'Architecture Summary',
    draft: {
      endpoint: '/v1/chat/completions',
      model: 'gemini-4-hydrogen',
      systemInstruction: 'You are a concise staff infrastructure engineer.',
      prompt: 'Explain the trade-offs between SSE streaming and WebSockets for LLM APIs in 3 bullet points.',
      stream: true,
      thinkingLevel: 'LOW',
      jsonMode: false,
    },
  },
  {
    label: 'Structured JSON',
    draft: {
      endpoint: '/v1/chat/completions',
      model: 'gemini-4-hydrogen',
      systemInstruction: 'Return only valid JSON with keys: service, status, regions (array of 3 strings).',
      prompt: 'Generate a sample deployment descriptor for a global API gateway.',
      stream: false,
      thinkingLevel: 'LOW',
      jsonMode: true,
    },
  },
  {
    label: 'Fast Native Generate',
    draft: {
      endpoint: '/v1/generate',
      model: 'gemini-3.1-flash-lite',
      systemInstruction: '',
      prompt: 'Write a 2-sentence release note for a zero-downtime database index migration.',
      stream: true,
      thinkingLevel: 'MINIMAL',
      jsonMode: false,
    },
  },
  {
    label: 'Vector Embedding',
    draft: {
      endpoint: '/v1/embeddings',
      model: 'gemini-embedding-2',
      systemInstruction: '',
      prompt: 'Public HTTP inference gateway supporting OpenAI chat completions and streaming SSE.',
      stream: false,
      thinkingLevel: '',
      jsonMode: false,
    },
  },
];

export function PlaygroundView({
  models,
  draft,
  onDraftChange,
  onRequestComplete,
}: PlaygroundViewProps) {
  const [activeTab, setActiveTab] = useState<ResponseTab>('output');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const availableModels = useMemo(() => {
    if (draft.endpoint === '/v1/embeddings') {
      return models.filter((m) => m.capability === 'embeddings');
    }
    return models.filter((m) => m.capability === 'text');
  }, [models, draft.endpoint]);

  const activeModelSpec = useMemo(
    () => availableModels.find((m) => m.id === draft.model) ?? availableModels[0],
    [availableModels, draft.model]
  );

  // Sync model and thinking level when switching endpoints
  useEffect(() => {
    if (!activeModelSpec) return;
    const modelChanged = activeModelSpec.id !== draft.model;
    const validThinking =
      draft.thinkingLevel &&
      activeModelSpec.supportedThinkingLevels.includes(
        draft.thinkingLevel as ModelSpec['supportedThinkingLevels'][number]
      );
    const nextThinking = validThinking
      ? draft.thinkingLevel
      : activeModelSpec.defaultThinkingLevel ?? '';

    if (modelChanged || nextThinking !== (draft.thinkingLevel ?? '')) {
      onDraftChange({
        ...draft,
        model: activeModelSpec.id,
        thinkingLevel: nextThinking,
        stream: activeModelSpec.streamingSupported ? draft.stream : false,
      });
    }
  }, [activeModelSpec, draft, onDraftChange]);

  const requestBody = useMemo(() => {
    if (draft.endpoint === '/v1/embeddings') {
      return {
        model: draft.model,
        input: draft.prompt,
      };
    }
    if (draft.endpoint === '/v1/generate') {
      const payload: Record<string, unknown> = {
        model: draft.model,
        prompt: draft.prompt,
        stream: draft.stream,
      };
      if (draft.systemInstruction?.trim()) {
        payload.systemInstruction = draft.systemInstruction.trim();
      }
      if (draft.thinkingLevel) {
        payload.thinkingLevel = draft.thinkingLevel;
      }
      if (draft.jsonMode) {
        payload.responseMimeType = 'application/json';
      }
      return payload;
    }

    const messages: Array<{ role: string; content: string }> = [];
    if (draft.systemInstruction?.trim()) {
      messages.push({ role: 'system', content: draft.systemInstruction.trim() });
    }
    messages.push({ role: 'user', content: draft.prompt });

    const chatPayload: Record<string, unknown> = {
      model: draft.model,
      messages,
      stream: draft.stream,
    };
    if (draft.thinkingLevel) {
      chatPayload.thinking_level = draft.thinkingLevel;
    }
    if (draft.jsonMode) {
      chatPayload.response_format = { type: 'json_object' };
    }
    return chatPayload;
  }, [draft]);

  const requestBodyString = useMemo(() => JSON.stringify(requestBody, null, 2), [requestBody]);

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.prompt.trim()) {
      setValidationError(
        draft.endpoint === '/v1/embeddings'
          ? 'Input text is required before sending a request.'
          : 'Prompt text is required before sending a request.'
      );
      return;
    }

    setValidationError(null);
    setIsRunning(true);
    setActiveTab('output');

    const controller = new AbortController();
    abortRef.current = controller;
    const startMs = performance.now();

    try {
      const response = await fetch(draft.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBodyString,
        signal: controller.signal,
      });

      const contentType = response.headers.get('content-type') || '';

      if (response.ok && contentType.includes('text/event-stream') && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulatedText = '';
        let rawEvents = '';
        let ttftMs: number | undefined;
        let usage: RunResult['usage'];

        setResult({
          status: response.status,
          statusText: response.statusText || 'OK',
          latencyMs: 0,
          outputText: '',
          rawBody: '',
        });

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunkStr = decoder.decode(value, { stream: true });
          rawEvents += chunkStr;
          buffer += chunkStr;

          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const dataPayload = trimmed.slice(5).trim();
            if (dataPayload === '[DONE]') continue;

            try {
              const parsed = JSON.parse(dataPayload) as Record<string, unknown>;
              if (parsed.error && typeof parsed.error === 'object') {
                const errMsg = String((parsed.error as { message?: string }).message || 'Stream error');
                setResult({
                  status: 500,
                  statusText: 'Stream Error',
                  latencyMs: Math.round(performance.now() - startMs),
                  ttftMs,
                  outputText: accumulatedText,
                  rawBody: rawEvents,
                  errorMessage: errMsg,
                });
                continue;
              }

              let delta = '';
              if (Array.isArray(parsed.choices)) {
                const firstChoice = parsed.choices[0] as
                  | { delta?: { content?: string } }
                  | undefined;
                delta = firstChoice?.delta?.content ?? '';
              } else if (typeof parsed.text === 'string') {
                delta = parsed.text;
              }

              if (parsed.usage && typeof parsed.usage === 'object') {
                const u = parsed.usage as Record<string, number>;
                usage = {
                  promptTokens: u.promptTokens ?? u.prompt_tokens ?? 0,
                  completionTokens: u.completionTokens ?? u.completion_tokens ?? 0,
                  totalTokens: u.totalTokens ?? u.total_tokens ?? 0,
                };
              }

              if (delta) {
                if (ttftMs === undefined) {
                  ttftMs = Math.round(performance.now() - startMs);
                }
                accumulatedText += delta;
                setResult({
                  status: response.status,
                  statusText: response.statusText || 'OK',
                  latencyMs: Math.round(performance.now() - startMs),
                  ttftMs,
                  outputText: accumulatedText,
                  rawBody: rawEvents,
                  usage,
                });
              }
            } catch {
              // Ignore partial non-JSON SSE comments
            }
          }
        }

        setResult((prev) => ({
          status: response.status,
          statusText: response.statusText || 'OK',
          latencyMs: Math.round(performance.now() - startMs),
          ttftMs: prev?.ttftMs ?? ttftMs,
          outputText: accumulatedText || prev?.outputText || '',
          rawBody: rawEvents,
          usage: usage ?? prev?.usage,
          errorMessage: prev?.errorMessage,
        }));
      } else {
        const rawText = await response.text();
        let parsedJson: Record<string, unknown> | null = null;
        try {
          parsedJson = JSON.parse(rawText) as Record<string, unknown>;
        } catch {
          parsedJson = null;
        }

        const latencyMs = Math.round(performance.now() - startMs);

        if (!response.ok) {
          const errObj = parsedJson?.error as { message?: string } | undefined;
          const errorMessage =
            errObj?.message || rawText || `Request failed with HTTP ${response.status}`;
          setResult({
            status: response.status,
            statusText: response.statusText || 'Error',
            latencyMs,
            outputText: '',
            rawBody: parsedJson ? JSON.stringify(parsedJson, null, 2) : rawText,
            errorMessage,
          });
        } else if (draft.endpoint === '/v1/embeddings' && parsedJson) {
          const dataArr = Array.isArray(parsedJson.data)
            ? (parsedJson.data as Array<{ embedding?: number[] }>)
            : [];
          const vec = dataArr[0]?.embedding ?? [];
          const u = (parsedJson.usage ?? {}) as Record<string, number>;
          setResult({
            status: response.status,
            statusText: response.statusText || 'OK',
            latencyMs,
            outputText: `Generated ${dataArr.length} embedding vector(s) · ${vec.length} dimensions`,
            embeddingDimensions: vec.length,
            embeddingPreview: vec.slice(0, 12),
            rawBody: JSON.stringify(parsedJson, null, 2),
            usage: {
              promptTokens: u.prompt_tokens ?? 0,
              completionTokens: 0,
              totalTokens: u.total_tokens ?? u.prompt_tokens ?? 0,
            },
          });
        } else if (parsedJson) {
          let outputText = '';
          if (Array.isArray(parsedJson.choices)) {
            const first = parsedJson.choices[0] as
              | { message?: { content?: string } }
              | undefined;
            outputText = first?.message?.content ?? '';
          } else if (typeof parsedJson.text === 'string') {
            outputText = parsedJson.text;
          }
          const u = (parsedJson.usage ?? {}) as Record<string, number>;
          setResult({
            status: response.status,
            statusText: response.statusText || 'OK',
            latencyMs,
            outputText,
            rawBody: JSON.stringify(parsedJson, null, 2),
            usage: {
              promptTokens: u.prompt_tokens ?? u.promptTokens ?? 0,
              completionTokens: u.completion_tokens ?? u.completionTokens ?? 0,
              totalTokens: u.total_tokens ?? u.totalTokens ?? 0,
            },
          });
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setResult({
          status: 0,
          statusText: 'Network Error',
          latencyMs: Math.round(performance.now() - startMs),
          outputText: '',
          rawBody: '',
          errorMessage: err instanceof Error ? err.message : 'Request failed.',
        });
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
      onRequestComplete();
    }
  };

  const statusTone =
    !result
      ? 'text-slate-500'
      : result.status >= 200 && result.status < 300 && !result.errorMessage
        ? 'text-emerald-700'
        : result.status >= 400 && result.status < 500
          ? 'text-amber-700'
          : 'text-red-700';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-slate-900">
            Inference Playground
          </h1>
          <p className="text-xs text-slate-500">
            Send live requests to your public endpoint and inspect streaming SSE or JSON payloads.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                setValidationError(null);
                onDraftChange({ ...draft, ...preset.draft } as PlaygroundDraft);
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Request Form */}
        <form
          onSubmit={handleSubmit}
          className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 xl:col-span-5"
        >
          <div className="space-y-4">
            <div>
              <label
                htmlFor="pg-endpoint"
                className="block text-xs font-medium text-slate-700"
              >
                Endpoint Route
              </label>
              <select
                id="pg-endpoint"
                value={draft.endpoint}
                onChange={(e) => {
                  setValidationError(null);
                  onDraftChange({
                    ...draft,
                    endpoint: e.target.value as Extract<
                      EndpointPath,
                      '/v1/chat/completions' | '/v1/generate' | '/v1/embeddings'
                    >,
                  });
                }}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              >
                <option value="/v1/chat/completions">POST /v1/chat/completions</option>
                <option value="/v1/generate">POST /v1/generate</option>
                <option value="/v1/embeddings">POST /v1/embeddings</option>
              </select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="pg-model" className="block text-xs font-medium text-slate-700">
                  Model
                </label>
                <select
                  id="pg-model"
                  value={draft.model}
                  onChange={(e) => onDraftChange({ ...draft, model: e.target.value })}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                >
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </select>
              </div>

              {draft.endpoint !== '/v1/embeddings' && (
                <div>
                  <label
                    htmlFor="pg-thinking"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Thinking Level
                  </label>
                  <select
                    id="pg-thinking"
                    value={draft.thinkingLevel ?? ''}
                    onChange={(e) =>
                      onDraftChange({ ...draft, thinkingLevel: e.target.value })
                    }
                    className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                  >
                    <option value="">Default (Auto)</option>
                    {(activeModelSpec?.supportedThinkingLevels ?? []).map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {lvl}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {draft.endpoint !== '/v1/embeddings' && (
              <>
                <div className="flex flex-wrap items-center gap-5 pt-0.5">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0">
                    <input
                      type="checkbox"
                      checked={draft.stream}
                      onChange={(e) => onDraftChange({ ...draft, stream: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                    />
                    <span>Stream SSE</span>
                  </label>

                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.jsonMode)}
                      onChange={(e) =>
                        onDraftChange({ ...draft, jsonMode: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                    />
                    <span>JSON Mode</span>
                  </label>
                </div>

                <div>
                  <label
                    htmlFor="pg-system"
                    className="block text-xs font-medium text-slate-700"
                  >
                    System Instruction (optional)
                  </label>
                  <input
                    id="pg-system"
                    type="text"
                    value={draft.systemInstruction ?? ''}
                    onChange={(e) =>
                      onDraftChange({ ...draft, systemInstruction: e.target.value })
                    }
                    placeholder="e.g., Answer concisely with concrete technical examples."
                    className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
                  />
                </div>
              </>
            )}

            <div>
              <label htmlFor="pg-prompt" className="block text-xs font-medium text-slate-700">
                {draft.endpoint === '/v1/embeddings' ? 'Input Text' : 'User Prompt'}
              </label>
              <textarea
                id="pg-prompt"
                rows={6}
                value={draft.prompt}
                onChange={(e) => {
                  if (validationError) setValidationError(null);
                  onDraftChange({ ...draft, prompt: e.target.value });
                }}
                placeholder={
                  draft.endpoint === '/v1/embeddings'
                    ? 'Enter text to embed into a dense vector...'
                    : 'Enter a prompt to test your hosted LLM endpoint...'
                }
                className="mt-1.5 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
              />
            </div>

            {validationError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{validationError}</span>
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <span className="font-mono text-xs text-slate-500">
              {draft.endpoint}
            </span>
            <div className="flex items-center gap-2">
              {isRunning ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 whitespace-nowrap"
                >
                  <Square className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                >
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Send Request</span>
                </button>
              )}
            </div>
          </div>
        </form>

        {/* Live Response Panel */}
        <section
          aria-label="Response output"
          className="flex min-h-[500px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white xl:col-span-7"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(
                [
                  { id: 'output', label: 'Output' },
                  { id: 'raw', label: 'Raw Response' },
                  { id: 'payload', label: 'Request JSON' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums">
              {isRunning && <span className="font-medium text-blue-700">Streaming...</span>}
              {result && (
                <>
                  <span className={`font-semibold ${statusTone}`}>
                    {result.status > 0 ? `${result.status} ${result.statusText}` : result.statusText}
                  </span>
                  <span className="text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-slate-600">{result.latencyMs} ms</span>
                  {result.ttftMs !== undefined && (
                    <>
                      <span className="text-slate-300" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-slate-600">TTFT {result.ttftMs} ms</span>
                    </>
                  )}
                  {result.usage && result.usage.totalTokens > 0 && (
                    <>
                      <span className="text-slate-300" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-slate-600">
                        {result.usage.totalTokens} tokens
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-auto p-5">
            {activeTab === 'payload' ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">
                    HTTP POST {draft.endpoint}
                  </span>
                  <CopyButton
                    value={requestBodyString}
                    label="Copy JSON"
                    ariaLabel="Copy request JSON body"
                  />
                </div>
                <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-100">
                  <code>{requestBodyString}</code>
                </pre>
              </div>
            ) : !result && !isRunning ? (
              <div className="flex h-full min-h-[340px] flex-col items-center justify-center text-center">
                <div className="max-w-sm space-y-2">
                  <h2 className="font-display text-base font-semibold text-slate-900">
                    Ready for inference
                  </h2>
                  <p className="text-sm text-slate-500">
                    Configure your endpoint, model, and prompt on the left, then click Send
                    Request to inspect real output and latency.
                  </p>
                </div>
              </div>
            ) : isRunning && !result ? (
              <div className="space-y-3" aria-busy="true" aria-label="Loading response">
                <div className="h-4 w-3/4 animate-pulse rounded bg-slate-100" />
                <div className="h-4 w-5/6 animate-pulse rounded bg-slate-100" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
              </div>
            ) : result?.errorMessage ? (
              <div className="space-y-4">
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
                >
                  <div className="font-semibold">
                    Request Failed ({result.status || 'Network Error'})
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-red-800">
                    {result.errorMessage}
                  </p>
                </div>
                {result.rawBody && (
                  <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-100">
                    <code>{result.rawBody}</code>
                  </pre>
                )}
              </div>
            ) : activeTab === 'raw' ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">
                    Raw Wire Response
                  </span>
                  <CopyButton
                    value={result?.rawBody ?? ''}
                    label="Copy Raw"
                    ariaLabel="Copy raw response"
                  />
                </div>
                <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-100">
                  <code>{result?.rawBody || '(waiting for response)'}</code>
                </pre>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">
                    Generated Output ({draft.model})
                  </span>
                  {result?.outputText && (
                    <CopyButton
                      value={result.outputText}
                      label="Copy Output"
                      ariaLabel="Copy generated output"
                    />
                  )}
                </div>

                <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-900">
                  {result?.outputText}
                </div>

                {result?.embeddingPreview && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-medium text-slate-700 tabular-nums">
                      First 12 Vector Dimensions (of {result.embeddingDimensions})
                    </div>
                    <code className="mt-2 block overflow-x-auto font-mono text-xs text-slate-800">
                      [{result.embeddingPreview.map((v) => v.toFixed(6)).join(', ')}, ...]
                    </code>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
