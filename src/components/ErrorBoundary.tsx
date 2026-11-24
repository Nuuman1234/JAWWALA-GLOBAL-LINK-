import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Unexpected system error.' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('FDMIS ErrorBoundary caught:', error, info);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    let parsedSummary = this.state.message;
    try {
      const parsed = JSON.parse(this.state.message);
      if (parsed && typeof parsed.error === 'string') {
        parsedSummary = `${parsed.operationType?.toUpperCase() || 'OPERATION'} on ${parsed.path || 'database'}: ${parsed.error}`;
      }
    } catch {
      // keep raw message
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-lg rounded-xl border border-red-200 bg-white p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-slate-900">
                Operational Security or Data Error
              </h2>
              <p className="mt-1 text-sm text-slate-600 break-words">{parsedSummary}</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#06452F] px-4 py-2 text-sm font-medium text-white hover:bg-[#043B29] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#06452F]"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                <span>Reload Situation Room</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
