import React, { useState, useRef } from 'react';
import { Wrench, RefreshCw, BookOpen, Key, Shield, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { verifyPinCode } from '../utils/auth';
import { toast } from 'sonner';

interface MaintenanceScreenProps {
  message?: string;
  estimatedEndTime?: string | null;
  onRetry: () => Promise<boolean | void> | void;
  onContinueOffline: () => void;
  onAdminBypass?: () => void;
}

export const MaintenanceScreen: React.FC<MaintenanceScreenProps> = ({
  message = 'Ведутся плановые технические работы по обновлению базы данных расписания.',
  estimatedEndTime,
  onRetry,
  onContinueOffline,
  onAdminBypass
}) => {
  const [isChecking, setIsChecking] = useState(false);
  const [isAdminInputVisible, setIsAdminInputVisible] = useState(false);
  const [adminPin, setAdminPin] = useState('');
  const [authError, setAuthError] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Hidden 5-tap gesture handler to reveal admin emergency bypass
  const tapCountRef = useRef<number>(0);
  const lastTapTimeRef = useRef<number>(0);

  const handleSecretTap = () => {
    const now = Date.now();
    if (now - lastTapTimeRef.current < 600) {
      tapCountRef.current += 1;
      if (tapCountRef.current >= 5) {
        tapCountRef.current = 0;
        setIsAdminInputVisible(true);
        if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.HapticFeedback) {
          (window as any).Telegram.WebApp.HapticFeedback.notificationOccurred('warning');
        }
        toast.info('Активирован экстренный вход администратора');
      }
    } else {
      tapCountRef.current = 1;
    }
    lastTapTimeRef.current = now;
  };

  const handleRetryClick = async () => {
    setIsChecking(true);
    try {
      await onRetry();
    } finally {
      setTimeout(() => setIsChecking(false), 600);
    }
  };

  const handleAdminAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminPin.trim()) return;

    setIsAuthenticating(true);
    setAuthError('');

    try {
      const result = await verifyPinCode(adminPin.trim());
      if (result && result.role === 'admin') {
        sessionStorage.setItem('admin_maintenance_bypass', 'true');
        toast.success('Авторизация успешна. Доступ открыт.');
        if (onAdminBypass) {
          onAdminBypass();
        } else {
          onContinueOffline();
        }
      } else {
        setAuthError('Неверный PIN-код администратора');
        if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.HapticFeedback) {
          (window as any).Telegram.WebApp.HapticFeedback.notificationOccurred('error');
        }
      }
    } catch (err) {
      setAuthError('Ошибка проверки кода авторизации');
    } finally {
      setIsAuthenticating(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-200">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl shadow-lg p-6 sm:p-8 text-center relative overflow-hidden">
        {/* Subtle decorative glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-40 h-2 bg-indigo-500/80 rounded-b-full blur-xs" />

        {/* Maintenance Icon Badge with Secret Click Counter */}
        <div className="flex justify-center mb-5">
          <div
            onClick={handleSecretTap}
            className="w-18 h-18 rounded-3xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/70 dark:border-indigo-800/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shadow-xs cursor-pointer select-none active:scale-95 transition-transform"
            title="Сервисный экран (5 быстрых нажатий для аварийного входа)"
          >
            <Wrench className="w-9 h-9 animate-pulse" />
          </div>
        </div>

        {/* Heading */}
        <h1
          onClick={handleSecretTap}
          className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight select-none cursor-pointer mb-2"
        >
          Технические работы
        </h1>

        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-6">
          {message}
        </p>

        {/* Status card */}
        <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 rounded-2xl p-4 mb-6 text-left space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping inline-block" />
              Статус сервера:
            </span>
            <span className="text-amber-600 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-md border border-amber-200/60 dark:border-amber-800/40">
              Обслуживание
            </span>
          </div>

          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-500 dark:text-slate-400">Ориентировочно:</span>
            <span className="text-slate-700 dark:text-slate-300 font-medium">
              {estimatedEndTime || '~ 10–15 минут'}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <button
            type="button"
            onClick={handleRetryClick}
            disabled={isChecking}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-2xl shadow-sm transition-all active:scale-[0.99] disabled:opacity-70 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
            {isChecking ? 'Проверка связи...' : 'Проверить доступность'}
          </button>

          <button
            type="button"
            onClick={onContinueOffline}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-sm rounded-2xl border border-slate-200/80 dark:border-slate-700/60 transition-all active:scale-[0.99] cursor-pointer shadow-2xs"
          >
            <BookOpen className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            Открыть расписание офлайн
          </button>
        </div>

        {/* Hidden Admin Emergency Bypass Prompt */}
        {isAdminInputVisible && (
          <form onSubmit={handleAdminAuth} className="mt-6 pt-5 border-t border-slate-200/80 dark:border-slate-800 text-left animate-in fade-in duration-200">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200 mb-2">
              <Shield className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              Аварийный вход администратора:
            </div>

            <div className="flex gap-2">
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                value={adminPin}
                onChange={(e) => setAdminPin(e.target.value)}
                placeholder="PIN-код"
                className="flex-1 px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                autoFocus
              />
              <button
                type="submit"
                disabled={isAuthenticating || !adminPin.trim()}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-bold text-xs rounded-xl transition-all disabled:opacity-50 cursor-pointer"
              >
                {isAuthenticating ? 'Проверка...' : 'Войти'}
              </button>
            </div>

            {authError && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {authError}
              </p>
            )}
          </form>
        )}

        <div className="mt-6 text-[11px] text-slate-400 font-medium">
          СамГТУ • Автономный режим с кэшированием
        </div>
      </div>
    </div>
  );
};

export default MaintenanceScreen;
