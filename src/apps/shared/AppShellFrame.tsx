import {
  AlertTriangle,
  Info,
  Layers,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import type { BridgeConnectionStatus } from './useOsBridge';

export interface AppShellFrameProps {
  /** Human-readable micro-app display name (e.g. "Feaso OS", "CutSheet AU"). */
  appName: string;
  /** Optional short domain descriptor shown in status and recovery copy. */
  appSubtitle?: string;
  /** Connection lifecycle status returned by useOsBridge(). */
  status: BridgeConnectionStatus;
  /** Human-readable error message from useOsBridge() or runtime validation. */
  errorMessage?: string | null;
  /** Callback wired to #retry-handshake-btn to re-initiate APP_READY -> OS_INIT. */
  onRetryHandshake: () => void;
  /** When true on a loaded project, displays the guided empty-slice recovery card. */
  isSliceEmpty?: boolean;
  /** Heading for the guided empty-slice state (#app-empty-state). */
  emptyTitle?: string;
  /** Supporting copy for the guided empty-slice state (#app-empty-state). */
  emptyDescription?: string;
  /** Label for the #init-baseline-btn CTA. */
  initBaselineLabel?: string;
  /** Action handler for #init-baseline-btn to seed Australian baseline values. */
  onInitBaseline?: () => void;
  /** Optional header element rendered above both empty state and active children. */
  header?: ReactNode;
  /** Optional custom loading skeleton content replacing the default Breeze Dark skeleton. */
  loadingSkeleton?: ReactNode;
  /** Optional callback passed through to ErrorBoundary for workspace recovery. */
  onResetWorkspace?: () => void;
  /**
   * Layout container strategy:
   * - "workbench": vertically scrollable Breeze Dark workspace (default)
   * - "fullbleed": fixed viewport flex container for 3D / map split-pane apps
   */
  layout?: 'workbench' | 'fullbleed';
  /** Optional extra Tailwind classes applied to the root frame container. */
  className?: string;
  /** When true, suppresses the amber standalone preview banner for full-bleed standalone GIS apps. */
  hideStandaloneBanner?: boolean;
  /** Primary interactive application surface. */
  children: ReactNode;
}

/**
 * Shared KDE Plasma Breeze Dark application frame for all 4 Vite MPA micro-apps.
 * Guarantees every commercial-grade UI state exists cleanly with zero layout jump:
 * Loading Skeleton, Error/Timeout Recovery, Standalone Preview Banner, Guided
 * Empty Slice State, and React ErrorBoundary protection.
 */
export function AppShellFrame({
  appName,
  appSubtitle,
  status,
  errorMessage,
  onRetryHandshake,
  isSliceEmpty = false,
  emptyTitle,
  emptyDescription,
  initBaselineLabel = 'Initialise Australian Baseline',
  onInitBaseline,
  header,
  loadingSkeleton,
  onResetWorkspace,
  layout = 'workbench',
  className = '',
  hideStandaloneBanner = false,
  children,
}: AppShellFrameProps) {
  const isLoaded = status === 'ready' || status === 'standalone';
  const isFatalError = status === 'timeout' || status === 'error';

  const derivedAppState: 'loading' | 'error' | 'empty' | 'ready' =
    status === 'loading'
      ? 'loading'
      : isFatalError
        ? 'error'
        : isSliceEmpty
          ? 'empty'
          : 'ready';

  const rootLayoutClasses =
    layout === 'fullbleed'
      ? 'flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#10141a] text-[#e6edf3]'
      : 'flex h-full min-h-0 w-full flex-col overflow-x-hidden overflow-y-auto bg-[#10141a] text-[#e6edf3]';

  const resolvedErrorText =
    errorMessage && errorMessage.trim().length > 0
      ? errorMessage
      : status === 'timeout'
        ? `OS_INIT did not arrive from devaware-os within 4 seconds for ${appName}.`
        : `Unable to establish a healthy @devaware/os-bridge session for ${appName}.`;

  return (
    <main
      id="app-root"
      data-app-state={derivedAppState}
      data-bridge-status={status}
      className={`${rootLayoutClasses} ${className}`.trim()}
    >
      {/* 1. LOADING SKELETON (non-jumping Breeze Dark structural match) */}
      {status === 'loading' && (
        <section
          id="app-loading-skeleton"
          data-app-state="loading"
          data-testid="app-loading-skeleton"
          aria-busy="true"
          aria-label={`Loading ${appName}${appSubtitle ? ` — ${appSubtitle}` : ''}`}
          className="flex min-h-0 flex-1 flex-col gap-3 p-4"
        >
          {loadingSkeleton ?? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-400/12 bg-[#161c24] px-4 py-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-52 max-w-[70%] animate-pulse rounded bg-slate-700/80" />
                  <div className="h-3 w-72 max-w-[85%] animate-pulse rounded bg-slate-800/90" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-6 w-28 animate-pulse rounded-full bg-slate-800" />
                  <div className="h-6 w-32 animate-pulse rounded-full bg-[#3daee9]/20" />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="h-20 rounded-xl border border-slate-400/12 bg-[#161c24] p-3.5">
                  <div className="h-2.5 w-24 animate-pulse rounded bg-slate-700/75" />
                  <div className="mt-3 h-5 w-32 animate-pulse rounded bg-slate-600/65" />
                </div>
                <div className="h-20 rounded-xl border border-slate-400/12 bg-[#161c24] p-3.5">
                  <div className="h-2.5 w-28 animate-pulse rounded bg-slate-700/75" />
                  <div className="mt-3 h-5 w-36 animate-pulse rounded bg-[#3daee9]/25" />
                </div>
                <div className="h-20 rounded-xl border border-slate-400/12 bg-[#161c24] p-3.5">
                  <div className="h-2.5 w-20 animate-pulse rounded bg-slate-700/75" />
                  <div className="mt-3 h-5 w-28 animate-pulse rounded bg-slate-600/65" />
                </div>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-12">
                <div className="flex flex-col gap-3 rounded-xl border border-slate-400/12 bg-[#161c24] p-4 lg:col-span-5">
                  <div className="h-3 w-36 animate-pulse rounded bg-slate-700/75" />
                  <div className="h-10 w-full animate-pulse rounded-lg bg-slate-800/85" />
                  <div className="h-10 w-full animate-pulse rounded-lg bg-slate-800/85" />
                  <div className="h-10 w-full animate-pulse rounded-lg bg-slate-800/85" />
                </div>
                <div className="flex min-h-[200px] flex-col justify-between rounded-xl border border-slate-400/12 bg-[#161c24]/85 p-4 lg:col-span-7">
                  <div className="space-y-2.5">
                    <div className="h-3 w-44 animate-pulse rounded bg-slate-700/75" />
                    <div className="h-3 w-64 max-w-full animate-pulse rounded bg-slate-800/90" />
                  </div>
                  <div className="font-mono-tech flex items-center gap-2 text-[11px] text-slate-400">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-[#3daee9]" />
                    <span>
                      Connecting {appName} via @devaware/os-bridge...
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {/* 2. FATAL ERROR / TIMEOUT RECOVERY SURFACE */}
      {isFatalError && (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6">
          <section
            id="app-error-banner"
            data-testid="app-error-banner"
            role="alert"
            className="w-full max-w-lg rounded-xl border border-rose-500/35 bg-[#161c24] p-5 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rose-500/35 bg-rose-500/15 text-rose-400">
                <AlertTriangle size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-mono-tech text-[10px] font-semibold tracking-wider text-rose-300 uppercase">
                  {status === 'timeout'
                    ? 'Bridge Handshake Timeout'
                    : 'Bridge Connection Fault'}
                </div>
                <h1
                  id="error-banner-title"
                  className="mt-0.5 text-sm font-semibold text-white"
                >
                  {status === 'timeout'
                    ? `${appName} Handshake Timed Out`
                    : `${appName} Bridge Connection Interrupted`}
                </h1>
                <p
                  id="error-banner-detail"
                  className="mt-1.5 text-xs leading-relaxed text-slate-300"
                >
                  {resolvedErrorText}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-400/12 pt-3.5">
              <button
                type="button"
                id="retry-handshake-btn"
                data-testid="retry-handshake-btn"
                onClick={onRetryHandshake}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#3daee9] px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-[#5bc0f2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3daee9]"
              >
                <RotateCcw size={13} />
                Retry Handshake
              </button>
            </div>
          </section>
        </div>
      )}

      {/* 3. LOADED WORKSPACE (READY OR STANDALONE) */}
      {isLoaded && (
        <ErrorBoundary
          scopeLabel={appName}
          onResetWorkspace={onResetWorkspace}
        >
          {/* Standalone Preview Banner */}
          {status === 'standalone' && !hideStandaloneBanner && (
            <div
              id="app-standalone-banner"
              data-testid="app-standalone-banner"
              role="status"
              className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-400/25 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-100"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Info size={14} className="shrink-0 text-amber-300" />
                <span className="truncate sm:whitespace-normal">
                  <strong className="font-semibold text-amber-200">
                    Standalone Preview Mode:
                  </strong>{' '}
                  {appName} is loaded with the sample Australian starter site.
                  Open inside devaware-os for live cross-app sync.
                </span>
              </div>
            </div>
          )}

          {/* Non-fatal inline bridge error banner when already loaded */}
          {errorMessage && errorMessage.trim().length > 0 && (
            <section
              id="app-error-banner"
              data-testid="app-error-banner"
              role="alert"
              className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-rose-500/35 bg-rose-500/12 px-3.5 py-2 text-xs text-rose-100"
            >
              <div className="flex min-w-0 items-center gap-2">
                <AlertTriangle size={14} className="shrink-0 text-rose-400" />
                <span id="error-banner-detail" className="min-w-0 break-words">
                  {errorMessage}
                </span>
              </div>
              <button
                type="button"
                id="retry-handshake-btn"
                data-testid="retry-handshake-btn"
                onClick={onRetryHandshake}
                className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-rose-400/35 bg-rose-500/20 px-2.5 py-1 text-[11px] font-semibold text-rose-100 transition-colors hover:bg-rose-500/30"
              >
                <RotateCcw size={12} />
                Retry Handshake
              </button>
            </section>
          )}

          {/* Optional App Header */}
          {header}

          {/* 4. EMPTY / UNINITIALIZED SLICE STATE vs INTERACTIVE WORKBENCH */}
          {isSliceEmpty ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6">
              <section
                id="app-empty-state"
                data-testid="app-empty-state"
                className="flex w-full max-w-lg flex-col items-center rounded-xl border border-dashed border-[#3daee9]/40 bg-[#161c24] px-6 py-7 text-center shadow-xl"
              >
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#3daee9]/30 bg-[#3daee9]/12 text-[#3daee9]">
                  <Layers size={20} />
                </span>
                <h2 className="mt-3 text-sm font-semibold text-white">
                  {emptyTitle ?? `No ${appName} Model Initialised`}
                </h2>
                <p
                  id="empty-state-desc"
                  className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-300"
                >
                  {emptyDescription ??
                    `This SiteProject does not yet contain baseline ${appName} parameters. Initialise an Australian baseline to begin analysis.`}
                </p>
                {onInitBaseline && (
                  <button
                    type="button"
                    id="init-baseline-btn"
                    data-testid="init-baseline-btn"
                    onClick={onInitBaseline}
                    className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#3daee9] px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-[#5bc0f2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3daee9]"
                  >
                    <Sparkles size={13} />
                    {initBaselineLabel}
                  </button>
                )}
              </section>
            </div>
          ) : (
            children
          )}
        </ErrorBoundary>
      )}
    </main>
  );
}
