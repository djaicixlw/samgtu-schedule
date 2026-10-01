import React, { useState, useEffect, useMemo } from 'react';
import { X, Terminal, Copy, Trash2, AlertTriangle, AlertCircle, Info, Activity, Filter, Check, RefreshCw } from 'lucide-react';
import { logger, LogEntry, getSystemDiagnostics, SystemDiagnostics } from '../utils/logger';
import { toast } from 'sonner';

interface DebugLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DebugLogsModal: React.FC<DebugLogsModalProps> = ({ isOpen, onClose }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [filterLevel, setFilterLevel] = useState<'ALL' | 'ERRORS_ONLY'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const updateState = () => {
      setLogs(logger.getLogs());
      setDiagnostics(getSystemDiagnostics());
    };

    updateState();
    const unsubscribe = logger.subscribe(updateState);
    return () => unsubscribe();
  }, [isOpen]);

  const filteredLogs = useMemo(() => {
    return logs.filter(entry => {
      if (filterLevel === 'ERRORS_ONLY' && entry.level !== 'ERROR') {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchMsg = entry.message.toLowerCase().includes(q);
        const matchCat = entry.category.toLowerCase().includes(q);
        const matchLevel = entry.level.toLowerCase().includes(q);
        return matchMsg || matchCat || matchLevel;
      }
      return true;
    });
  }, [logs, filterLevel, searchQuery]);

  const errorCount = useMemo(() => logs.filter(l => l.level === 'ERROR').length, [logs]);
  const warnCount = useMemo(() => logs.filter(l => l.level === 'WARN').length, [logs]);

  const handleCopyLogs = async () => {
    try {
      const dump = logger.exportLogsAsJSON();
      await navigator.clipboard.writeText(dump);
      setIsCopied(true);
      
      // Haptic feedback in Telegram
      if (typeof window !== 'undefined' && window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
      }

      toast.success('Все логи и диагностика скопированы в буфер!');
      setTimeout(() => setIsCopied(false), 2000);
    } catch (e) {
      toast.error('Не удалось скопировать логи в буфер');
    }
  };

  const handleClearLogs = () => {
    logger.clearLogs();
    toast.info('Логи очищены');
  };

  if (!isOpen) return null;

  const getLevelBadgeClass = (level: string) => {
    switch (level) {
      case 'ERROR':
        return 'bg-red-500/15 text-red-500 border-red-500/30';
      case 'WARN':
        return 'bg-amber-500/15 text-amber-500 border-amber-500/30';
      case 'ACTION':
        return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
      case 'DEBUG':
        return 'bg-purple-500/15 text-purple-400 border-purple-500/30';
      default:
        return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[92dvh] sm:max-h-[85vh] text-slate-200 overflow-hidden"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/90 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">Мобильная консоль</h3>
                <span className="px-2 py-0.5 text-[11px] font-mono font-bold bg-slate-800 text-slate-300 rounded-full border border-slate-700">
                  {logs.length} / 150
                </span>
                {errorCount > 0 && (
                  <span className="px-2 py-0.5 text-[11px] font-mono font-bold bg-red-500/20 text-red-400 rounded-full border border-red-500/40">
                    {errorCount} {errorCount === 1 ? 'ошибка' : 'ошибок'}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">Встроенная диагностика и перехватчик событий</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* System Diagnostics Bar */}
        {diagnostics && (
          <div className="px-5 py-2.5 bg-slate-950/60 border-b border-slate-800 text-xs text-slate-400 flex flex-wrap gap-x-4 gap-y-1 font-mono">
            <span><strong className="text-slate-300">OS:</strong> {diagnostics.telegramPlatform}</span>
            <span><strong className="text-slate-300">TG:</strong> {diagnostics.tgWebAppVersion}</span>
            <span><strong className="text-slate-300">Группа:</strong> {diagnostics.currentGroupId}</span>
            <span><strong className="text-slate-300">Неделя:</strong> {diagnostics.selectedWeek}</span>
            <span><strong className="text-slate-300">Storage:</strong> {Math.round(diagnostics.localStorageUsageBytes / 1024)} KB</span>
            <span><strong className="text-slate-300">Сеть:</strong> {diagnostics.onlineStatus ? 'Online' : 'Offline'}</span>
          </div>
        )}

        {/* Toolbar */}
        <div className="p-4 border-b border-slate-800 bg-slate-900/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 flex-1">
            <input
              type="text"
              placeholder="Поиск по логам..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
            />
            <button
              onClick={() => setFilterLevel(prev => prev === 'ALL' ? 'ERRORS_ONLY' : 'ALL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors border ${
                filterLevel === 'ERRORS_ONLY'
                  ? 'bg-red-500/20 text-red-400 border-red-500/40'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>{filterLevel === 'ERRORS_ONLY' ? 'Только ошибки' : 'Все логи'}</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyLogs}
              className="flex-1 sm:flex-none px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm shadow-indigo-950"
            >
              {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{isCopied ? 'Скопировано!' : 'Скопировать логи'}</span>
            </button>
            <button
              onClick={handleClearLogs}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors border border-slate-700"
              title="Очистить логи"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Очистить</span>
            </button>
          </div>
        </div>

        {/* Logs List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-xs overscroll-contain">
          {filteredLogs.length === 0 ? (
            <div className="py-16 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
              <Info className="w-8 h-8 opacity-40" />
              <p>Нет записей, удовлетворяющих условиям фильтра</p>
            </div>
          ) : (
            filteredLogs.slice().reverse().map((log, idx) => {
              const timeStr = log.timestamp.split('T')[1]?.split('+')[0] || log.timestamp;
              return (
                <div
                  key={idx}
                  className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition-colors flex flex-col gap-1"
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded-md border font-bold text-[10px] ${getLevelBadgeClass(log.level)}`}>
                        {log.level}
                      </span>
                      <span className="px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-400 font-semibold text-[10px]">
                        {log.category}
                      </span>
                      <span className="text-slate-500 text-[11px]">{timeStr}</span>
                    </div>
                  </div>

                  <div className="text-slate-200 break-words whitespace-pre-wrap font-sans text-xs pt-0.5">
                    {log.message}
                  </div>

                  {log.data && (
                    <pre className="mt-1 p-2 bg-slate-950 rounded-lg text-[10px] text-slate-400 overflow-x-auto border border-slate-800/60">
                      {typeof log.data === 'object' ? JSON.stringify(log.data, null, 2) : String(log.data)}
                    </pre>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default DebugLogsModal;
