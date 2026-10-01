import React, { useState } from 'react';
import { KeyRound, X, AlertCircle, RefreshCw, ArrowRight } from 'lucide-react';
import { linkStudentWithInvite } from '../utils/attendanceStorage';
import { toast } from 'sonner';

interface StudentLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (gid: string, slot: string) => void;
}

const StudentLinkModal: React.FC<StudentLinkModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Automatically uppercase and strip whitespace
    const clean = e.target.value.toUpperCase().replace(/\s+/g, '');
    setCode(clean);
    if (errorMessage) setErrorMessage(null);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanCode = code.trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (!cleanCode) {
      setErrorMessage('Пожалуйста, введите код приглашения');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await linkStudentWithInvite(cleanCode, 1);
      if (res.ok && res.gid && res.slot) {
        toast.success(`Успешно! Вы привязаны к слоту ${res.slot}`);
        onSuccess(res.gid, res.slot);
      } else {
        const err = res.error || '';
        if (
          err.includes('404') ||
          err.includes('истекший') ||
          err.includes('просроченный') ||
          err.includes('Неверный')
        ) {
          setErrorMessage('Неверный или просроченный код приглашения');
        } else if (err.includes('429') || err.includes('Слишком много')) {
          setErrorMessage('Слишком много попыток, подождите 15 минут');
        } else {
          setErrorMessage(err || 'Не удалось привязать код приглашения');
        }
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Ошибка сети при обращении к серверу');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl max-w-md w-full max-h-[92dvh] sm:max-h-[85vh] flex flex-col shadow-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white leading-tight">
                Код приглашения
              </h3>
              <p className="text-xs text-slate-400">
                Привязка к журналу группы
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4 flex-1 overflow-y-auto">
          <div className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Введите одноразовый 10-значный код приглашения, полученный от старосты вашей группы (например, <span className="font-mono font-bold text-slate-900 dark:text-slate-200">K7P2-9XQM4T</span>).
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Код приглашения
            </label>
            <div className="relative">
              <input
                type="text"
                value={code}
                onChange={handleCodeChange}
                placeholder="K7P2-9XQM4T"
                autoFocus
                disabled={isLoading}
                maxLength={20}
                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/80 border-2 border-slate-200 dark:border-slate-700 rounded-2xl text-center font-mono text-lg font-bold tracking-widest text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all uppercase"
              />
            </div>
            <p className="text-[11px] text-slate-400 text-center">
              Буквы автоматически переводятся в заглавные
            </p>
          </div>

          {errorMessage && (
            <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 flex items-start gap-2.5 animate-in fade-in duration-200">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
              <p className="text-xs font-medium text-red-800 dark:text-red-200 leading-snug">
                {errorMessage}
              </p>
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={isLoading || !code.trim()}
              className="w-full py-3 px-4 rounded-2xl font-bold text-xs bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-md shadow-indigo-200 dark:shadow-none transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Проверка кода...</span>
                </>
              ) : (
                <>
                  <span>Подключиться</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default StudentLinkModal;
