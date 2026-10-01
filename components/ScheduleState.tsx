import React from 'react';
import { RefreshCw, AlertCircle, CalendarOff } from 'lucide-react';
import { LoadFailReason } from '../utils/scheduleLoader';

export interface ScheduleStateProps {
  status: 'loading' | 'error' | 'empty';
  groupName: string;
  errorReason?: LoadFailReason | string | null;
  onRetry?: () => void;
}

export function getScheduleErrorMessage(reason?: LoadFailReason | string | null): string {
  switch (reason) {
    case 'network':
    case 'timeout':
      return 'Не удалось загрузить расписание. Проверьте подключение к интернету.';
    case 'not_found':
      return 'Файл расписания для группы пока не найден в базе.';
    case 'empty':
      return 'Расписание для выбранной группы пока пустое.';
    case 'invalid':
      return 'Ошибка структуры данных расписания.';
    default:
      return 'Не удалось загрузить расписание. Проверьте подключение к интернету.';
  }
}

export const ScheduleState: React.FC<ScheduleStateProps> = ({
  status,
  groupName,
  errorReason,
  onRetry,
}) => {
  if (status === 'loading') {
    return (
      <div className="space-y-4 w-full max-w-full">
        {/* Header loading badge */}
        <div className="flex items-center justify-between p-4 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin shrink-0" />
            <div className="flex flex-col">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                Загрузка расписания {groupName ? `(${groupName})` : ''}...
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                Подключение к базе данных 4-недельного цикла
              </span>
            </div>
          </div>
          <div className="h-6 w-16 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
        </div>

        {/* Skeleton day header */}
        <div className="flex items-center justify-between gap-2 pt-2">
          <div className="flex items-center gap-2">
            <div className="h-6 w-28 bg-slate-200 dark:bg-slate-700/60 rounded-lg animate-pulse" />
            <div className="h-5 w-20 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
          </div>
          <div className="h-5 w-14 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse" />
        </div>

        {/* Skeleton cards */}
        <div className="space-y-3">
          {[1, 2, 3].map((item) => (
            <div
              key={item}
              className="p-4 bg-white dark:bg-slate-800/80 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs animate-pulse space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="h-5 w-24 bg-slate-200 dark:bg-slate-700/70 rounded-md" />
                <div className="h-5 w-20 bg-indigo-100/70 dark:bg-indigo-900/40 rounded-md" />
              </div>
              <div className="space-y-1.5">
                <div className="h-4 w-3/4 bg-slate-200 dark:bg-slate-700/70 rounded-md" />
                <div className="h-3.5 w-1/2 bg-slate-100 dark:bg-slate-800 rounded-md" />
              </div>
              <div className="flex items-center gap-4 pt-1">
                <div className="h-3 w-1/3 bg-slate-100 dark:bg-slate-800 rounded-md" />
                <div className="h-3 w-1/4 bg-slate-100 dark:bg-slate-800 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center p-6 my-8 mx-auto max-w-md bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/50 rounded-3xl shadow-xs text-center">
        <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 flex items-center justify-center mb-3">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
          {groupName ? `Ошибка загрузки группы ${groupName}` : 'Ошибка загрузки расписания'}
        </h3>
        <p className="text-xs text-slate-600 dark:text-slate-300 max-w-sm mb-5 leading-relaxed">
          {getScheduleErrorMessage(errorReason)}
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-bold rounded-xl shadow-xs transition-all min-h-[44px]"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Повторить попытку</span>
          </button>
        )}
      </div>
    );
  }

  // status === 'empty'
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 my-8 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl shadow-xs text-center max-w-md mx-auto">
      <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-3">
        <CalendarOff className="w-6 h-6" />
      </div>
      <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
        На этой неделе нет занятий
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm">
        {groupName
          ? `Для группы ${groupName} занятия на выбранную неделю отсутствуют.`
          : 'Расписание занятий на эту неделю отсутствует.'}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center justify-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 active:scale-95 text-slate-700 dark:text-slate-300 text-xs font-medium rounded-xl transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Повторить попытку</span>
        </button>
      )}
    </div>
  );
};

export default ScheduleState;
