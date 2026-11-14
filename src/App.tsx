import { useCallback, useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import {
  DEFAULT_TEXT_MODEL,
  MODEL_CATALOG,
  type GatewayStats,
  type ModelSpec,
  type RequestLogEntry,
} from './shared/inference.ts';
import type {
  GatewayInfoResponse,
  GatewayLogsResponse,
  NavSection,
  PlaygroundDraft,
} from './types/gateway.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { OverviewView } from './components/OverviewView.tsx';
import { PlaygroundView } from './components/PlaygroundView.tsx';
import { ReferenceView } from './components/ReferenceView.tsx';
import { LogsView } from './components/LogsView.tsx';

const INITIAL_STATS: GatewayStats = {
  totalRequests: 0,
  successCount: 0,
  errorCount: 0,
  successRate: 100,
  avgLatencyMs: 0,
  totalTokens: 0,
};

const INITIAL_DRAFT: PlaygroundDraft = {
  endpoint: '/v1/chat/completions',
  model: 'gemini-3.1-flash-lite',
  prompt: 'Explain how a reverse-proxy LLM gateway handles SSE streaming in two crisp sentences.',
  systemInstruction: 'Be precise and concise.',
  stream: true,
  thinkingLevel: 'MINIMAL',
  jsonMode: false,
};

const SECTION_TITLES: Record<NavSection, string> = {
  overview: 'Overview',
  playground: 'Playground',
  reference: 'API Reference',
  logs: 'Request Logs',
};

export default function App() {
  const [activeSection, setActiveSection] = useState<NavSection>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [publicBaseUrl, setPublicBaseUrl] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'
  );
  const [uptimeSeconds, setUptimeSeconds] = useState<number>(0);
  const [rateLimit, setRateLimit] = useState({ maxRequests: 60, windowSeconds: 60 });
  const [models, setModels] = useState<ModelSpec[]>(MODEL_CATALOG);
  const [stats, setStats] = useState<GatewayStats>(INITIAL_STATS);
  const [logs, setLogs] = useState<RequestLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState<boolean>(false);

  const [playgroundDraft, setPlaygroundDraft] = useState<PlaygroundDraft>(INITIAL_DRAFT);

  const fetchGatewayData = useCallback(async () => {
    setLogsLoading(true);
    try {
      const [infoRes, logsRes] = await Promise.all([
        fetch('/api/gateway/info'),
        fetch('/api/gateway/logs'),
      ]);
      if (infoRes.ok) {
        const info = (await infoRes.json()) as GatewayInfoResponse;
        setPublicBaseUrl(info.publicBaseUrl);
        setUptimeSeconds(info.uptimeSeconds);
        setRateLimit(info.rateLimit);
        setModels(info.models);
        setStats(info.stats);
      }
      if (logsRes.ok) {
        const logsPayload = (await logsRes.json()) as GatewayLogsResponse;
        setLogs(logsPayload.logs);
        setStats(logsPayload.stats);
      }
    } catch {
      // Keep current state if transient network fetch fails
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchGatewayData();
  }, [fetchGatewayData]);

  const handleOpenPlayground = useCallback((partial?: Partial<PlaygroundDraft>) => {
    if (partial) {
      setPlaygroundDraft((prev) => ({ ...prev, ...partial }));
    }
    setActiveSection('playground');
  }, []);

  const handleClearLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/gateway/logs', { method: 'DELETE' });
      if (res.ok) {
        const payload = (await res.json()) as GatewayLogsResponse;
        setLogs(payload.logs);
        setStats(payload.stats);
      }
    } catch {
      // Ignore transient error
    }
  }, []);

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <Sidebar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        publicBaseUrl={publicBaseUrl}
        rateLimitMax={rateLimit.maxRequests}
        requestCount={logs.length}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 lg:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <div className="flex items-center gap-2 truncate text-sm">
              <span className="hidden text-slate-500 sm:inline">Gemini Gateway</span>
              <span className="hidden text-slate-300 sm:inline" aria-hidden="true">
                /
              </span>
              <span className="font-medium text-slate-900">{SECTION_TITLES[activeSection]}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => handleOpenPlayground()}
              className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              Test Endpoint
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {activeSection === 'overview' && (
            <OverviewView
              publicBaseUrl={publicBaseUrl}
              models={models}
              stats={stats}
              rateLimit={rateLimit}
              uptimeSeconds={uptimeSeconds}
              onOpenPlayground={handleOpenPlayground}
            />
          )}

          {activeSection === 'playground' && (
            <PlaygroundView
              models={models}
              draft={playgroundDraft}
              onDraftChange={setPlaygroundDraft}
              onRequestComplete={fetchGatewayData}
            />
          )}

          {activeSection === 'reference' && (
            <ReferenceView
              publicBaseUrl={publicBaseUrl}
              onTryEndpoint={handleOpenPlayground}
            />
          )}

          {activeSection === 'logs' && (
            <LogsView
              logs={logs}
              loading={logsLoading}
              onRefresh={fetchGatewayData}
              onClear={handleClearLogs}
              onOpenPlayground={() => handleOpenPlayground()}
            />
          )}
        </main>
      </div>
    </div>
  );
}
