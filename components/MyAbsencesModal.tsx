import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X,
  RefreshCw,
  Trash2,
  AlertTriangle,
  GraduationCap,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import {
  fetchMyAttendanceV3,
  unlinkStudentV3,
  getLocalStudentLink
} from '../utils/attendanceStorage';
import { toast } from 'sonner';

interface MyAbsencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUnlinked?: () => void;
}

interface AbsenceEntry {
  rawKey: string;
  dateStr: string;
  pairNum: string;
  type: 'e' | 'u';
}

const RUSSIAN_MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

function formatDateDisplay(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length === 2) {
    const month = parseInt(parts[0], 10) - 1;
    const day = parseInt(parts[1], 10);
    if (month >= 0 && month < 12 && !isNaN(day)) {
      return `${day} ${RUSSIAN_MONTHS[month]}`;
    }
  } else if (parts.length === 3) {
    const year = parts[0];
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    if (month >= 0 && month < 12 && !isNaN(day)) {
      return `${day} ${RUSSIAN_MONTHS[month]} ${year}`;
    }
  }
  return dateStr;
}

const MyAbsencesModal: React.FC<MyAbsencesModalProps> = ({
  isOpen,
  onClose,
  onUnlinked
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [gid, setGid] = useState<string>('');
  const [slot, setSlot] = useState<string>('');
  const [marks, setMarks] = useState<Record<string, 'e' | 'u'>>({});
  const [isLinked, setIsLinked] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    // Initial fill from local storage if available
    const local = getLocalStudentLink();
    if (local) {
      setGid(local.gid);
      setSlot(local.slot);
    }

    try {
      const res = await fetchMyAttendanceV3();
      if (res.ok) {
        setIsLinked(res.linked);
        if (res.linked) {
          if (res.gid) setGid(res.gid);
          if (res.slot) setSlot(res.slot);
          setMarks(res.marks || {});
        } else {
          setMarks({});
        }
      } else {
        setErrorMessage(res.error || 'Не удалось загрузить данные');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Ошибка сети при обращении к серверу');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  // Compute parsed absence items & statistics
  const { absenceList, totalHours, uHours, eHours, totalPairs, uPairs, ePairs } = useMemo(() => {
    const list: AbsenceEntry[] = [];
    let uCount = 0;
    let eCount = 0;

    Object.entries(marks).forEach(([key, type]) => {
      const dotIndex = key.lastIndexOf('.');
      const dateStr = dotIndex !== -1 ? key.substring(0, dotIndex) : key;
      const pairNum = dotIndex !== -1 ? key.substring(dotIndex + 1) : '1';

      list.push({ rawKey: key, dateStr, pairNum, type });
      if (type === 'u') uCount++;
      if (type === 'e') eCount++;
    });

    const totPairs = uCount + eCount;
    return {
      absenceList: list,
      totalHours: totPairs * 2,
      uHours: uCount * 2,
      eHours: eCount * 2,
      totalPairs: totPairs,
      uPairs: uCount,
      ePairs: eCount
    };
  }, [marks]);

  // Group absences by date, sorted descending
  const groupedAbsences = useMemo(() => {
    const map = new Map<string, AbsenceEntry[]>();
    absenceList.forEach((entry) => {
      const existing = map.get(entry.dateStr) || [];
      existing.push(entry);
      map.set(entry.dateStr, existing);
    });

    return Array.from(map.entries())
      .map(([dateStr, items]) => ({
        dateStr,
        formattedDate: formatDateDisplay(dateStr),
        items: items.sort((a, b) => Number(a.pairNum) - Number(b.pairNum))
      }))
      .sort((a, b) => b.dateStr.localeCompare(a.dateStr));
  }, [absenceList]);

  const handleDeleteData = async () => {
    setIsDeleting(true);
    try {
      const res = await unlinkStudentV3();
      if (res.ok) {
        toast.success('Привязка и данные посещаемости успешно удалены');
        setShowConfirmDelete(false);
        onUnlinked?.();
        onClose();
      } else {
        toast.error(res.error || 'Не удалось удалить данные');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Ошибка сети при обращении к серверу');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl max-w-lg w-full max-h-[92dvh] sm:max-h-[85vh] flex flex-col shadow-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden relative">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white leading-tight">
                Мои пропуски
              </h3>
              <p className="text-xs text-slate-400">
                Личный журнал посещаемости
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={loadData}
              disabled={isLoading}
              title="Обновить данные"
              className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-indigo-600' : ''}`} />
            </button>
            <button
              onClick={onClose}
              aria-label="Закрыть"
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-5 flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-4">
          {/* Status info bar */}
          <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-medium">Группа:</span>
              <span className="text-xs font-bold text-slate-900 dark:text-white uppercase">
                {gid || '—'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 font-medium">Слот:</span>
              <span className="font-mono text-xs font-extrabold px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/40">
                {slot || '—'}
              </span>
            </div>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
              <p className="text-xs text-red-800 dark:text-red-200 font-medium leading-snug">
                {errorMessage}
              </p>
            </div>
          )}

          {!isLinked ? (
            <div className="text-center py-8 px-4 bg-slate-50 dark:bg-slate-800/40 rounded-3xl border border-slate-200/80 dark:border-slate-700/60 space-y-2">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                Вы не привязаны к группе
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Возможно, срок действия привязки истёк или вы удалили свои данные.
              </p>
            </div>
          ) : (
            <>
              {/* Summary Hours Statistics */}
              <div className="grid grid-cols-3 gap-2">
                {/* Total */}
                <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 text-center">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Всего</div>
                  <div className="text-xl font-extrabold text-slate-900 dark:text-white mt-0.5">
                    {totalHours} <span className="text-xs font-semibold text-slate-400">ч</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5 font-medium">
                    {totalPairs} пар
                  </div>
                </div>

                {/* Unexcused (Н) */}
                <div className="bg-rose-50/70 dark:bg-rose-950/30 p-3 rounded-2xl border border-rose-200/70 dark:border-rose-900/40 text-center">
                  <div className="text-[10px] uppercase font-bold text-rose-600 dark:text-rose-400">Н (неуваж.)</div>
                  <div className="text-xl font-extrabold text-rose-700 dark:text-rose-300 mt-0.5">
                    {uHours} <span className="text-xs font-semibold text-rose-400">ч</span>
                  </div>
                  <div className="text-[10px] text-rose-500/80 dark:text-rose-400/80 mt-0.5 font-medium">
                    {uPairs} пар
                  </div>
                </div>

                {/* Excused (УП) */}
                <div className="bg-amber-50/70 dark:bg-amber-950/30 p-3 rounded-2xl border border-amber-200/70 dark:border-amber-900/40 text-center">
                  <div className="text-[10px] uppercase font-bold text-amber-600 dark:text-amber-400">УП (уваж.)</div>
                  <div className="text-xl font-extrabold text-amber-700 dark:text-amber-300 mt-0.5">
                    {eHours} <span className="text-xs font-semibold text-amber-400">ч</span>
                  </div>
                  <div className="text-[10px] text-amber-500/80 dark:text-amber-400/80 mt-0.5 font-medium">
                    {ePairs} пар
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                <Clock className="w-3.5 h-3.5" />
                <span>Каждая пара = 2 академических часа</span>
              </div>

              {/* Absences List Grouped by Date */}
              <div className="space-y-3 pt-1">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Список пропущенных занятий</span>
                </h4>

                {groupedAbsences.length === 0 ? (
                  <div className="p-6 text-center bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Пропусков не зафиксировано
                    </p>
                    <p className="text-[11px] text-slate-400">
                      В текущем месяце у вас 100% посещаемость 🎉
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {groupedAbsences.map((group) => (
                      <div
                        key={group.dateStr}
                        className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 p-3.5 space-y-2"
                      >
                        <div className="flex justify-between items-center border-b border-slate-200/60 dark:border-slate-700/40 pb-2">
                          <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                            {group.formattedDate}
                          </span>
                          <span className="text-[10px] font-semibold text-slate-400 font-mono">
                            {group.dateStr}
                          </span>
                        </div>

                        <div className="space-y-1.5">
                          {group.items.map((item) => (
                            <div
                              key={item.rawKey}
                              className="flex items-center justify-between py-1.5 px-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/40 text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-700 dark:text-slate-300">
                                  {item.pairNum} пара
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  (2 ч)
                                </span>
                              </div>

                              <div>
                                {item.type === 'u' ? (
                                  <span className="px-2 py-0.5 rounded-md font-bold text-[10px] bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-200/70 dark:border-rose-900/50">
                                    Н • Неуважительная
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-md font-bold text-[10px] bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200/70 dark:border-amber-900/50">
                                    УП • Уважительная
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Revoke consent / Delete data action */}
          <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setShowConfirmDelete(true)}
              className="w-full py-2.5 px-3 rounded-xl font-semibold text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors flex items-center justify-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Удалить мои данные (отозвать согласие)</span>
            </button>
          </div>
        </div>

        {/* Confirmation Modal Overlay */}
        {showConfirmDelete && (
          <div className="absolute inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/40 flex items-center justify-center text-red-600 dark:text-red-400 shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                    Удалить мои данные?
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                    Вы уверены? Привязка вашего Telegram-аккаунта и все отметки посещаемости будут немедленно и безвозвратно удалены с сервера.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setShowConfirmDelete(false)}
                  className="w-1/2 py-2 px-3 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleDeleteData}
                  className="w-1/2 py-2 px-3 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white shadow-sm transition-all flex items-center justify-center gap-1.5"
                >
                  {isDeleting ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <span>Удалить всё</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MyAbsencesModal;
