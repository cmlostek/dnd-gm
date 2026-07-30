import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

/**
 * Catches render-time errors so a single bad component can't white-screen the
 * whole app mid-session — which, at a table, means losing the GM's screen in
 * the middle of combat.
 *
 * "Try again" re-mounts the subtree, which is enough to recover from transient
 * failures (a malformed row from realtime, a null deref on a half-loaded
 * store). "Reload" is the escape hatch when state is genuinely wedged.
 *
 * Note this only catches errors thrown while *rendering*. Async failures in
 * event handlers and store actions still need their own handling — see the
 * swallowed-catch cleanup work.
 */
type Props = { children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the component stack — React strips it from the bare error.
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-950 p-6">
        <div className="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-2 text-rose-400">
            <AlertTriangle size={20} />
            <h1 className="font-serif text-xl text-slate-100">Something broke</h1>
          </div>

          <p className="text-sm text-slate-400 leading-relaxed">
            This part of Grimoire hit an error and stopped rendering. Your campaign
            data is safe — it lives on the server, not in this screen.
          </p>

          <pre className="text-[11px] font-mono text-rose-300/90 bg-slate-950 border border-slate-800 rounded p-3 overflow-x-auto whitespace-pre-wrap">
            {error.message || String(error)}
          </pre>

          <div className="flex gap-2">
            <button
              onClick={() => this.setState({ error: null })}
              className="ac-btn flex-1 px-3 py-2 rounded text-sm font-semibold flex items-center justify-center gap-1.5"
            >
              <RotateCcw size={14} /> Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="flex-1 px-3 py-2 rounded text-sm bg-slate-800 hover:bg-slate-700 text-slate-200"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
