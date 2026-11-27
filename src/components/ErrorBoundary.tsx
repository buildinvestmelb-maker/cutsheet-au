import { AlertTriangle, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  scopeLabel: string;
  children: ReactNode;
  onResetWorkspace?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
  detailsExpanded: boolean;
}

/**
 * Commercial-grade React ErrorBoundary rendering a KDE Plasma Breeze Dark
 * recovery surface with Retry View and optional Reset Workspace actions.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      componentStack: null,
      detailsExpanded: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(_error: Error, errorInfo: ErrorInfo): void {
    this.setState({
      componentStack: errorInfo.componentStack ?? null,
    });
  }

  private handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      componentStack: null,
      detailsExpanded: false,
    });
  };

  private handleResetWorkspace = (): void => {
    this.props.onResetWorkspace?.();
    this.handleRetry();
  };

  private toggleDetails = (): void => {
    this.setState((prev) => ({
      detailsExpanded: !prev.detailsExpanded,
    }));
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { scopeLabel, onResetWorkspace } = this.props;
    const { error, componentStack, detailsExpanded } = this.state;
    const errorMessage =
      error?.message && error.message.trim().length > 0
        ? error.message
        : 'An unexpected rendering error interrupted this workspace surface.';
    const hasTechnicalDetails = Boolean(error?.stack || componentStack);

    return (
      <div
        role="alert"
        data-testid="error-boundary-fallback"
        className="flex h-full min-h-[240px] w-full items-center justify-center bg-[#10141a] p-4 text-slate-200"
      >
        <div className="w-full max-w-lg rounded-xl border border-rose-500/30 bg-[#161c24] p-5 shadow-2xl">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rose-500/35 bg-rose-500/15 text-rose-400">
              <AlertTriangle size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-mono-tech text-[10px] font-semibold tracking-wider text-rose-300 uppercase">
                Surface Fault Recovery
              </div>
              <h2 className="mt-0.5 text-sm font-semibold text-white">
                {scopeLabel} could not render
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                {errorMessage}
              </p>
            </div>
          </div>

          {hasTechnicalDetails && (
            <div className="mt-3.5">
              <button
                type="button"
                onClick={this.toggleDetails}
                aria-expanded={detailsExpanded}
                className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-slate-400 transition-colors hover:text-slate-200"
              >
                {detailsExpanded ? (
                  <ChevronUp size={13} />
                ) : (
                  <ChevronDown size={13} />
                )}
                {detailsExpanded ? 'Hide Diagnostics' : 'Show Diagnostics'}
              </button>

              {detailsExpanded && (
                <pre className="font-mono-tech mt-2 max-h-40 overflow-auto rounded-lg border border-slate-400/15 bg-[#0b0f14] p-2.5 text-[10px] leading-relaxed whitespace-pre-wrap text-slate-400">
                  {[error?.stack, componentStack].filter(Boolean).join('\n\n')}
                </pre>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-400/12 pt-3.5">
            <button
              type="button"
              data-testid="error-boundary-retry"
              onClick={this.handleRetry}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#3daee9] px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-[#5bc0f2]"
            >
              <RotateCcw size={13} />
              Retry View
            </button>

            {onResetWorkspace && (
              <button
                type="button"
                data-testid="error-boundary-reset"
                onClick={this.handleResetWorkspace}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-amber-400/35 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/20"
              >
                Reset Workspace
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
