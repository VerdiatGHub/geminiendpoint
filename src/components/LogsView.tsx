import { Fragment, useMemo, useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import type { RequestLogEntry } from '../shared/inference.ts';

interface LogsViewProps {
  logs: RequestLogEntry[];
  loading: boolean;
  onRefresh: () => void;
  onClear: () => void;
  onOpenPlayground: () => void;
}

type StatusFilter = 'all' | '2xx' | 'errors';

export function LogsView({
  logs,
  loading,
  onRefresh,
  onClear,
  onOpenPlayground,
}: LogsViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((entry) => {
      if (statusFilter === '2xx' && (entry.status < 200 || entry.status >= 400)) {
        return false;
      }
      if (statusFilter === 'errors' && entry.status >= 200 && entry.status < 400) {
        return false;
      }
      if (!q) return true;
      return (
        entry.path.toLowerCase().includes(q) ||
        entry.model.toLowerCase().includes(q) ||
        entry.promptPreview.toLowerCase().includes(q) ||
        (entry.errorMessage ?? '').toLowerCase().includes(q)
      );
    });
  }, [logs, search, statusFilter]);

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-slate-900">
            Request Logs
          </h1>
          <p className="text-xs text-slate-500">
            Live audit trail of recent inference requests handled by this server.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Refresh</span>
          </button>
          {logs.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 whitespace-nowrap"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Clear Logs</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1 sm:max-w-sm">
          <label htmlFor="logs-search" className="sr-only">
            Filter request logs
          </label>
          <input
            id="logs-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by route, model, or prompt..."
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 self-start rounded-lg bg-slate-100 p-1 sm:self-auto">
          {(
            [
              { id: 'all', label: 'All' },
              { id: '2xx', label: '2xx OK' },
              { id: 'errors', label: 'Errors' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                statusFilter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table / Empty / Loading */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading && logs.length === 0 ? (
          <div className="divide-y divide-slate-200 p-4" aria-busy="true">
            {[1, 2, 3].map((row) => (
              <div key={row} className="flex items-center justify-between py-3">
                <div className="h-4 w-48 animate-pulse rounded bg-slate-100" />
                <div className="h-4 w-24 animate-pulse rounded bg-slate-100" />
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <h2 className="font-display text-base font-semibold text-slate-900">
              No inference requests recorded yet
            </h2>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              Requests sent through the Playground or external HTTP clients will appear here with
              real latency, status codes, and token counts.
            </p>
            <button
              type="button"
              onClick={onOpenPlayground}
              className="mt-5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800"
            >
              Send First Request
            </button>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            No requests match the current filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="px-5 py-3">Time</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Route</th>
                  <th className="px-4 py-3">Model</th>
                  <th className="px-4 py-3">Mode</th>
                  <th className="px-4 py-3 text-right">Latency</th>
                  <th className="px-5 py-3 text-right">Tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredLogs.map((entry) => {
                  const isExpanded = expandedId === entry.id;
                  const statusTone =
                    entry.status >= 200 && entry.status < 400
                      ? 'text-emerald-700'
                      : entry.status >= 400 && entry.status < 500
                        ? 'text-amber-700'
                        : 'text-red-700';

                  return (
                    <Fragment key={entry.id}>
                      <tr
                        className="cursor-pointer transition-colors hover:bg-slate-50"
                        onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                      >
                        <td className="px-5 py-3 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                          {formatTime(entry.timestamp)}
                        </td>
                        <td
                          className={`px-4 py-3 font-mono text-xs font-semibold tabular-nums whitespace-nowrap ${statusTone}`}
                        >
                          {entry.status} {entry.status >= 200 && entry.status < 400 ? 'OK' : 'ERR'}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-900 whitespace-nowrap">
                          {entry.method} {entry.path}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-700 whitespace-nowrap">
                          {entry.model}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                          {entry.stream ? 'SSE Stream' : 'JSON'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                          {entry.latencyMs} ms
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                          {entry.usage.totalTokens}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50">
                          <td colSpan={7} className="px-5 py-3.5 text-xs text-slate-700">
                            <div className="flex flex-wrap items-center gap-4 font-mono text-slate-500">
                              <span>ID: {entry.id}</span>
                              {entry.ttftMs !== undefined && <span>TTFT: {entry.ttftMs} ms</span>}
                              <span>Prompt tokens: {entry.usage.promptTokens}</span>
                              <span>Completion tokens: {entry.usage.completionTokens}</span>
                            </div>
                            {entry.promptPreview && (
                              <div className="mt-2">
                                <span className="font-medium text-slate-700">Prompt preview: </span>
                                <span className="text-slate-600">{entry.promptPreview}</span>
                              </div>
                            )}
                            {entry.errorMessage && (
                              <div className="mt-2 text-red-700">
                                <span className="font-medium">Error: </span>
                                <span>{entry.errorMessage}</span>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
