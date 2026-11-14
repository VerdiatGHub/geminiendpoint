import { useState } from 'react';
import type { PlaygroundDraft } from '../types/gateway.ts';
import { CopyButton } from './CopyButton.tsx';

interface ReferenceViewProps {
  publicBaseUrl: string;
  onTryEndpoint: (draft: Partial<PlaygroundDraft>) => void;
}

interface RouteDoc {
  method: 'GET' | 'POST';
  path: string;
  title: string;
  summary: string;
  params: Array<{ name: string; type: string; required: boolean; description: string }>;
  exampleResponse: string;
  playgroundDraft?: Partial<PlaygroundDraft>;
}

const ROUTES: RouteDoc[] = [
  {
    method: 'POST',
    path: '/v1/chat/completions',
    title: 'OpenAI-Compatible Chat Completions',
    summary:
      'Drop-in replacement for OpenAI chat completions. Works with the official OpenAI Python/Node SDKs by setting base_url to <BASE_URL>/v1.',
    params: [
      {
        name: 'model',
        type: 'string',
        required: false,
        description: 'Defaults to gemini-4-hydrogen. Also supports gemini-3.1-flash-lite.',
      },
      {
        name: 'messages',
        type: 'array',
        required: true,
        description: 'Array of { role: "system" | "user" | "assistant", content: string }.',
      },
      {
        name: 'stream',
        type: 'boolean',
        required: false,
        description: 'Set true to stream Server-Sent Events (chat.completion.chunk).',
      },
      {
        name: 'thinking_level',
        type: 'string',
        required: false,
        description: 'Optional reasoning depth: MINIMAL (flash-lite), LOW, MEDIUM, HIGH, XHIGH (hydrogen).',
      },
      {
        name: 'response_format',
        type: 'object',
        required: false,
        description: 'Pass { "type": "json_object" } for guaranteed JSON output.',
      },
    ],
    exampleResponse: `{
  "id": "req_8f91c2a01b34",
  "object": "chat.completion",
  "created": 1794637052,
  "model": "gemini-4-hydrogen",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Hello from Gemini Gateway." },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 14, "completion_tokens": 6, "total_tokens": 20 }
}`,
    playgroundDraft: {
      endpoint: '/v1/chat/completions',
      model: 'gemini-4-hydrogen',
      stream: true,
    },
  },
  {
    method: 'POST',
    path: '/v1/generate',
    title: 'Native Gemini Generation',
    summary:
      'Lightweight JSON or SSE endpoint accepting a direct prompt and optional systemInstruction without OpenAI message wrapping.',
    params: [
      {
        name: 'prompt',
        type: 'string',
        required: true,
        description: 'Primary text prompt (alias: contents).',
      },
      {
        name: 'model',
        type: 'string',
        required: false,
        description: 'Defaults to gemini-4-hydrogen.',
      },
      {
        name: 'systemInstruction',
        type: 'string',
        required: false,
        description: 'Optional system-level steering instruction.',
      },
      {
        name: 'stream',
        type: 'boolean',
        required: false,
        description: 'Set true for SSE chunks { id, model, text } ending with [DONE].',
      },
      {
        name: 'thinkingLevel',
        type: 'string',
        required: false,
        description: 'LOW | MEDIUM | HIGH | XHIGH (hydrogen) or MINIMAL | LOW | MEDIUM | HIGH (flash-lite).',
      },
    ],
    exampleResponse: `{
  "id": "req_3a7d10e921fc",
  "model": "gemini-4-hydrogen",
  "text": "Edge caching stores responses near end users to reduce origin latency.",
  "usage": { "promptTokens": 11, "completionTokens": 13, "totalTokens": 24 },
  "latencyMs": 412
}`,
    playgroundDraft: {
      endpoint: '/v1/generate',
      model: 'gemini-3.1-flash-lite',
      stream: false,
    },
  },
  {
    method: 'POST',
    path: '/v1/embeddings',
    title: 'Dense Vector Embeddings',
    summary:
      'Generates normalized semantic vectors using gemini-embedding-2 for single strings or batches up to 32 items.',
    params: [
      {
        name: 'input',
        type: 'string | string[]',
        required: true,
        description: 'Text string or array of up to 32 strings to embed.',
      },
      {
        name: 'model',
        type: 'string',
        required: false,
        description: 'Defaults to gemini-embedding-2.',
      },
    ],
    exampleResponse: `{
  "object": "list",
  "data": [
    { "object": "embedding", "index": 0, "embedding": [0.0124, -0.0318, 0.0092] }
  ],
  "model": "gemini-embedding-2",
  "usage": { "prompt_tokens": 8, "total_tokens": 8 }
}`,
    playgroundDraft: {
      endpoint: '/v1/embeddings',
      model: 'gemini-embedding-2',
      stream: false,
    },
  },
  {
    method: 'GET',
    path: '/v1/models',
    title: 'Model Catalog',
    summary: 'Lists all active Gemini models and their supported capabilities and thinking levels.',
    params: [],
    exampleResponse: `{
  "object": "list",
  "data": [
    { "id": "gemini-4-hydrogen", "object": "model", "owned_by": "google-gemini" }
  ]
}`,
  },
  {
    method: 'GET',
    path: '/health',
    title: 'Gateway Health Check',
    summary: 'Lightweight uptime and readiness probe for external monitors and load balancers.',
    params: [],
    exampleResponse: `{
  "status": "ok",
  "service": "gemini-gateway",
  "uptimeSeconds": 124
}`,
  },
];

export function ReferenceView({ publicBaseUrl, onTryEndpoint }: ReferenceViewProps) {
  const [liveProbePath, setLiveProbePath] = useState<string | null>(null);
  const [liveProbeOutput, setLiveProbeOutput] = useState<string | null>(null);
  const [probeLoading, setProbeLoading] = useState(false);

  const runLiveGet = async (path: string) => {
    setProbeLoading(true);
    setLiveProbePath(path);
    try {
      const res = await fetch(path);
      const data = await res.json();
      setLiveProbeOutput(JSON.stringify(data, null, 2));
    } catch (err) {
      setLiveProbeOutput(err instanceof Error ? err.message : 'Failed to reach endpoint');
    } finally {
      setProbeLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold tracking-tight text-slate-900">
          API Reference
        </h1>
        <p className="text-xs text-slate-500">
          Public HTTP specification served from{' '}
          <code className="font-mono text-slate-700">{publicBaseUrl}</code>.
        </p>
      </div>

      <div className="space-y-4">
        {ROUTES.map((route) => {
          const fullUrl = `${publicBaseUrl}${route.path}`;
          return (
            <section
              key={route.path}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white"
            >
              <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`font-mono text-xs font-semibold ${
                        route.method === 'POST' ? 'text-blue-700' : 'text-emerald-700'
                      }`}
                    >
                      {route.method}
                    </span>
                    <code className="font-mono text-sm font-semibold text-slate-900">
                      {route.path}
                    </code>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{route.summary}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <CopyButton
                    value={fullUrl}
                    label="Copy URL"
                    ariaLabel={`Copy ${route.path} URL`}
                  />
                  {route.playgroundDraft ? (
                    <button
                      type="button"
                      onClick={() => onTryEndpoint(route.playgroundDraft!)}
                      className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-800 whitespace-nowrap"
                    >
                      Try in Playground
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => runLiveGet(route.path)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap"
                    >
                      Run Live Check
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 divide-y divide-slate-200 lg:grid-cols-12 lg:divide-x lg:divide-y-0">
                <div className="p-6 lg:col-span-6">
                  <div className="text-xs font-semibold text-slate-700">
                    {route.params.length > 0 ? 'Body Parameters' : 'Parameters'}
                  </div>
                  {route.params.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">
                      No request body or query parameters required.
                    </p>
                  ) : (
                    <dl className="mt-3 divide-y divide-slate-100">
                      {route.params.map((p) => (
                        <div key={p.name} className="py-2.5 first:pt-0 last:pb-0">
                          <dt className="flex items-center gap-2 text-xs">
                            <code className="font-mono font-semibold text-slate-900">
                              {p.name}
                            </code>
                            <span className="font-mono text-slate-500">{p.type}</span>
                            {p.required && (
                              <span className="font-medium text-amber-700">required</span>
                            )}
                          </dt>
                          <dd className="mt-1 text-xs leading-relaxed text-slate-600">
                            {p.description}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>

                <div className="bg-slate-900 p-5 lg:col-span-6">
                  <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                    <span>
                      {liveProbePath === route.path
                        ? probeLoading
                          ? 'Fetching live response...'
                          : 'Live Response (200 OK)'
                        : 'Example 200 Response'}
                    </span>
                  </div>
                  <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-slate-100">
                    <code>
                      {liveProbePath === route.path && liveProbeOutput
                        ? liveProbeOutput
                        : route.exampleResponse}
                    </code>
                  </pre>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
