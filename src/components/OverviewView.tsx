import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { EndpointPath, GatewayStats, ModelSpec } from '../shared/inference.ts';
import type { PlaygroundDraft } from '../types/gateway.ts';
import { buildClientSnippet, type SnippetLanguage } from '../utils/snippets.ts';
import { CopyButton } from './CopyButton.tsx';

interface OverviewViewProps {
  publicBaseUrl: string;
  models: ModelSpec[];
  stats: GatewayStats;
  rateLimit: { maxRequests: number; windowSeconds: number };
  uptimeSeconds: number;
  onOpenPlayground: (draft?: Partial<PlaygroundDraft>) => void;
}

const SNIPPET_ENDPOINTS: Array<{
  path: Extract<EndpointPath, '/v1/chat/completions' | '/v1/generate' | '/v1/embeddings'>;
  label: string;
}> = [
  { path: '/v1/chat/completions', label: 'POST /v1/chat/completions' },
  { path: '/v1/generate', label: 'POST /v1/generate' },
  { path: '/v1/embeddings', label: 'POST /v1/embeddings' },
];

const SNIPPET_LANGUAGES: Array<{ id: SnippetLanguage; label: string }> = [
  { id: 'curl', label: 'cURL' },
  { id: 'python_openai', label: 'Python' },
  { id: 'typescript', label: 'TypeScript' },
];

export function OverviewView({
  publicBaseUrl,
  models,
  stats,
  rateLimit,
  uptimeSeconds,
  onOpenPlayground,
}: OverviewViewProps) {
  const [snippetEndpoint, setSnippetEndpoint] = useState<
    Extract<EndpointPath, '/v1/chat/completions' | '/v1/generate' | '/v1/embeddings'>
  >('/v1/chat/completions');
  const [snippetLang, setSnippetLang] = useState<SnippetLanguage>('curl');
  const [snippetStream, setSnippetStream] = useState(true);

  const selectedModel =
    snippetEndpoint === '/v1/embeddings' ? 'gemini-embedding-2' : 'gemini-4-hydrogen';

  const snippetCode = useMemo(
    () =>
      buildClientSnippet(snippetLang, {
        baseUrl: publicBaseUrl,
        endpoint: snippetEndpoint,
        model: selectedModel,
        prompt:
          snippetEndpoint === '/v1/embeddings'
            ? 'Semantic vector search over technical docs'
            : 'Explain edge caching in two crisp sentences.',
        stream: snippetEndpoint === '/v1/embeddings' ? false : snippetStream,
      }),
    [publicBaseUrl, selectedModel, snippetEndpoint, snippetLang, snippetStream]
  );

  const formatUptime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m`;
  };

  return (
    <div className="space-y-6">
      {/* Primary Public Endpoint Card */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-medium text-emerald-700">Endpoint Active</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">Uptime {formatUptime(uptimeSeconds)}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                Limit {rateLimit.maxRequests} req / {rateLimit.windowSeconds}s
              </span>
              <span aria-hidden="true">·</span>
              <span>CORS Enabled</span>
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
              Public Google LLM Inference Endpoint
            </h1>
            <p className="text-sm leading-relaxed text-slate-600">
              Drop-in OpenAI-compatible chat completions, native Gemini generation with SSE
              streaming, and semantic embeddings served publicly over HTTPS.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onOpenPlayground()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-800 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            <span>Open Playground</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500">Public Base URL</div>
            <code className="mt-0.5 block truncate font-mono text-sm font-medium text-slate-900">
              {publicBaseUrl}
            </code>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <CopyButton value={publicBaseUrl} label="Copy URL" ariaLabel="Copy public base URL" />
            <CopyButton
              value={`${publicBaseUrl}/v1`}
              label="Copy /v1 Base"
              ariaLabel="Copy OpenAI SDK base URL"
            />
          </div>
        </div>

        {publicBaseUrl.includes('ais-dev-') && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
            <span className="font-semibold">Workspace Preview URL Notice: </span>
            <span>
              <code className="font-mono">ais-dev-*</code> URLs sit behind AI Studio&apos;s
              workspace authentication proxy, so unauthenticated remote <code className="font-mono">curl</code> or
              SDK calls receive a <code className="font-mono">302 /__cookie_check.html</code>{' '}
              redirect before reaching Express. To expose this endpoint publicly without login,
              deploy it to Cloud Run with unauthenticated access (a production{' '}
              <code className="font-mono">Dockerfile</code> is included).
            </span>
          </div>
        )}
      </section>

      {/* 4-Column Live Telemetry Strip */}
      <section aria-label="Gateway metrics" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Total Requests</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {stats.totalRequests}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {stats.successCount} succeeded · {stats.errorCount} failed
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Success Rate</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {stats.totalRequests === 0 ? '—' : `${stats.successRate}%`}
          </div>
          <div className="mt-1 text-xs text-slate-500">HTTP 2xx responses</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Avg Latency</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {stats.totalRequests === 0 ? '—' : `${stats.avgLatencyMs} ms`}
          </div>
          <div className="mt-1 text-xs text-slate-500">End-to-end server time</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Total Tokens</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {stats.totalTokens.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-500">Prompt + completion</div>
        </div>
      </section>

      {/* Quickstart Client Snippets */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Quickstart Client Snippets
            </h2>
            <p className="text-xs text-slate-500">
              Call your hosted endpoint from any backend, script, or OpenAI-compatible SDK.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="sr-only" htmlFor="overview-endpoint-select">
              Snippet endpoint
            </label>
            <select
              id="overview-endpoint-select"
              value={snippetEndpoint}
              onChange={(e) =>
                setSnippetEndpoint(
                  e.target.value as Extract<
                    EndpointPath,
                    '/v1/chat/completions' | '/v1/generate' | '/v1/embeddings'
                  >
                )
              }
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-800 focus:border-blue-700 focus:outline-none"
            >
              {SNIPPET_ENDPOINTS.map((item) => (
                <option key={item.path} value={item.path}>
                  {item.label}
                </option>
              ))}
            </select>

            {snippetEndpoint !== '/v1/embeddings' && (
              <button
                type="button"
                onClick={() => setSnippetStream((prev) => !prev)}
                aria-pressed={snippetStream}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  snippetStream
                    ? 'border-blue-700 bg-blue-50 text-blue-800'
                    : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900'
                }`}
              >
                {snippetStream ? 'Streaming: On' : 'Streaming: Off'}
              </button>
            )}

            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {SNIPPET_LANGUAGES.map((lang) => (
                <button
                  key={lang.id}
                  type="button"
                  onClick={() => setSnippetLang(lang.id)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    snippetLang === lang.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="relative bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-2.5">
            <span className="font-mono text-xs text-slate-400">
              {snippetEndpoint} · {selectedModel}
            </span>
            <CopyButton
              value={snippetCode}
              label="Copy Snippet"
              ariaLabel="Copy client code snippet"
              variant="dark"
            />
          </div>
          <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed text-slate-100">
            <code>{snippetCode}</code>
          </pre>
        </div>
      </section>

      {/* Supported Model Catalog */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Hosted Model Routes
          </h2>
          <p className="text-xs text-slate-500">
            Active Google Gemini models exposed through this gateway.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="px-6 py-3">Model ID</th>
                <th className="px-4 py-3">Capability</th>
                <th className="px-4 py-3">Context</th>
                <th className="px-4 py-3">Thinking Levels</th>
                <th className="px-4 py-3">Streaming</th>
                <th className="px-6 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {models.map((model) => (
                <tr key={model.id} className="hover:bg-slate-50/70">
                  <td className="px-6 py-3.5">
                    <div className="font-mono text-xs font-semibold text-slate-900">
                      {model.id}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">{model.description}</div>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-slate-700 whitespace-nowrap">
                    {model.capability === 'embeddings' ? 'Dense Embeddings' : 'Text & JSON'}
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                    {model.contextWindow}
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs text-slate-600 whitespace-nowrap">
                    {model.supportedThinkingLevels.length > 0
                      ? model.supportedThinkingLevels.join(' · ')
                      : 'N/A'}
                  </td>
                  <td className="px-4 py-3.5 text-xs text-slate-700 whitespace-nowrap">
                    {model.streamingSupported ? 'SSE Supported' : 'Batch JSON'}
                  </td>
                  <td className="px-6 py-3.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() =>
                        onOpenPlayground({
                          endpoint:
                            model.capability === 'embeddings'
                              ? '/v1/embeddings'
                              : '/v1/chat/completions',
                          model: model.id,
                          thinkingLevel: model.defaultThinkingLevel ?? '',
                        })
                      }
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900"
                    >
                      Test Model
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
