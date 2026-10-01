import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { logger } from '../utils/logger';
import { sendCrashReport } from '../utils/telemetry';

interface Props {
  children: ReactNode;
  tabName: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class TabErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[TabErrorBoundary] Error caught in tab "${this.props.tabName}":`, error, errorInfo);
    try {
      logger.error('UI', `Ошибка рендера во вкладке [${this.props.tabName}]: ${error.message}\n${errorInfo.componentStack || ''}`);
      sendCrashReport({
        component: `TabErrorBoundary (${this.props.tabName})`,
        message: error?.message || String(error),
        stack: error?.stack || errorInfo?.componentStack || undefined
      });
    } catch {}
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-6 my-8 mx-auto max-w-md bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/50 rounded-3xl shadow-sm text-center">
          <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 flex items-center justify-center mb-3">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
            Не удалось загрузить раздел «{this.props.tabName}»
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 max-w-xs">
            Произошла изолированная ошибка при отображении данных. Другие разделы приложения продолжают работать.
          </p>
          {this.state.error?.message && (
            <div className="w-full p-2.5 mb-4 bg-red-50/50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 rounded-xl text-left text-[11px] font-mono text-red-700 dark:text-red-300 break-words max-h-24 overflow-y-auto">
              {this.state.error.message}
            </div>
          )}
          <button
            onClick={this.handleRetry}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all active:scale-95 min-h-[44px]"
          >
            <RefreshCw className="w-4 h-4" />
            Попробовать снова
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default TabErrorBoundary;
