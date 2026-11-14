import { Activity, BookOpen, LayoutDashboard, Terminal, X } from 'lucide-react';
import type { NavSection } from '../types/gateway.ts';

interface SidebarProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  publicBaseUrl: string;
  rateLimitMax: number;
  requestCount: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'playground', label: 'Playground', icon: Terminal },
  { id: 'reference', label: 'API Reference', icon: BookOpen },
  { id: 'logs', label: 'Request Logs', icon: Activity },
];

export function Sidebar({
  activeSection,
  onSelectSection,
  publicBaseUrl,
  rateLimitMax,
  requestCount,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const navContent = (
    <div className="flex h-full flex-col justify-between bg-white px-4 py-5">
      <div>
        <div className="flex items-center justify-between px-2 pb-6">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            Gemini Gateway
          </span>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation menu"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 lg:hidden"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Gateway navigation" className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectSection(item.id);
                  onCloseMobile();
                }}
                aria-current={isActive ? 'page' : undefined}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
                  isActive
                    ? 'bg-slate-100 text-slate-900'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? 'text-blue-700' : 'text-slate-400'
                    }`}
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                </span>
                {item.id === 'logs' && (
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {requestCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
        <div className="text-xs font-medium text-slate-700">Public Endpoint</div>
        <div
          className="mt-1 truncate font-mono text-xs text-slate-900"
          title={publicBaseUrl}
        >
          {publicBaseUrl}
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 tabular-nums">
          <span>{rateLimitMax} req/min</span>
          <span aria-hidden="true">·</span>
          <span>CORS Open</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
        {navContent}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-64 max-w-[80vw] border-r border-slate-200 bg-white shadow-lg">
            {navContent}
          </aside>
        </div>
      )}
    </>
  );
}
