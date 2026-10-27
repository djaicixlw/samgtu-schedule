import React, { useState, useMemo } from 'react';
import { UserRole } from '../types';
import { ShieldCheck, Key, CheckCircle2, RefreshCw, Wrench, ChevronDown, Download, Users, Bell } from 'lucide-react';
import { toast } from 'sonner';
import { claimStaffRole, getLocalStudents } from '../utils/attendanceStorage';
import { SAMGTU_GROUP_MAP } from '../utils/samgtuGroupMap';
import { fetchOfficialCycleWeeks, syncOfficialGroupSchedule, getLocalBackup } from '../utils/cloudSync';
import { registerScheduleAliases, markScheduleLoaded, readCachedSchedule, loadGroupSchedule, isScheduleLoaded } from '../utils/scheduleLoader';
import { compareWithOfficial } from '../utils/scheduleCompare';
import { convertOfficialSamgtuToWeekData } from '../utils/samgtuParser';
import { SCHEDULE_REGISTRY, AVAILABLE_GROUPS } from '../constants';
import { logger } from '../utils/logger';

interface AdminPanelProps {
  currentRole: UserRole;
  onRoleChange: (role: UserRole, targetGroupId?: string) => void;
  userEmail: string | null;
  currentGroupId?: string;
  onScheduleUpdated?: () => void;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ currentRole, onRoleChange, currentGroupId, onScheduleUpdated }) => {
  const [selectedAuditGroup, setSelectedAuditGroup] = useState(currentGroupId && SAMGTU_GROUP_MAP[currentGroupId] ? currentGroupId : 'ingt-310');
  const [isCheckingOfficial, setIsCheckingOfficial] = useState(false);
  const [isApplyingOfficial, setIsApplyingOfficial] = useState(false);
  const [isGroupPickerOpen, setIsGroupPickerOpen] = useState(false);
  const [auditResult, setAuditResult] = useState<{
    groupName: string;
    status: 'match' | 'diff' | 'error';
    summary: string;
    details: string[];
  } | null>(null);
  const [isSimulatingMaintenance, setIsSimulatingMaintenance] = useState(() => {
    return localStorage.getItem('simulate_maintenance') === 'true';
  });

  const groupStats = useMemo(() => {
    return AVAILABLE_GROUPS.map(grp => {
      const students = getLocalStudents(grp.id);
      const activeStudents = students.filter(s => !s.isArchived);
      const hasCustomOverrides = Boolean(localStorage.getItem(`schedule_overrides_${grp.id}`));
      const isReadyForPush = activeStudents.length > 0;
      return {
        id: grp.id,
        name: grp.name,
        course: grp.course,
        facultyId: grp.facultyId,
        studentCount: activeStudents.length,
        hasCustomOverrides,
        isReadyForPush,
      };
    });
  }, []);

  const handleToggleMaintenance = () => {
    const nextVal = !isSimulatingMaintenance;
    if (nextVal) {
      localStorage.setItem('simulate_maintenance', 'true');
      sessionStorage.removeItem('admin_maintenance_bypass');
      sessionStorage.removeItem('dismiss_maintenance');
      setIsSimulatingMaintenance(true);
      toast.warning('Режим техработ включен. При следующем обновлении отобразится экран обслуживания.');
    } else {
      localStorage.removeItem('simulate_maintenance');
      sessionStorage.removeItem('admin_maintenance_bypass');
      sessionStorage.removeItem('dismiss_maintenance');
      setIsSimulatingMaintenance(false);
      toast.success('Режим техработ выключен.');
    }
  };

  const [accessCode, setAccessCode] = useState('');

  const handleVerifyAccessCode = async () => {
    const code = accessCode.trim();
    if (!code) return;

    try {
      const authRes = await claimStaffRole(currentGroupId || 'admin', code);
      if (!authRes || !authRes.ok) {
        toast.error(authRes?.error || 'Неверный код доступа');
        return;
      }

      if (authRes.role === 'admin') {
        onRoleChange('admin');
        toast.success('Авторизован режим Главного Администратора');
        setAccessCode('');
      } else if (authRes.role === 'starosta' && authRes.gid) {
        onRoleChange('starosta', authRes.gid);
        toast.success(`Авторизован режим Старосты (${authRes.gid})`);
        setAccessCode('');
      }
    } catch {
      toast.error('Ошибка проверки кода доступа');
    }
  };

  const handleApplyOfficialSchedule = async (groupId: string) => {
    const groupConf = SAMGTU_GROUP_MAP[groupId];
    if (!groupConf) {
      toast.error('Данная группа не привязана к официальному API');
      return;
    }

    if (groupConf.lkVerified) {
      const ok = confirm(`⚠️ Внимание! Расписание группы ${groupConf.name} выверено по Личному Кабинету (ЛК СамГТУ).\n\nПубличный портал samgtu.ru может отставать от ЛК или содержать неполные данные. Сначала посмотрите расхождения в сверке.\n\nВы действительно хотите перезаписать проверенное расписание данными с портала?`);
      if (!ok) return;
    }

    setIsApplyingOfficial(true);
    logger.action('SYNC', `Admin initiated official schedule import for ${groupConf.name}`);

    try {
      const res = await syncOfficialGroupSchedule(groupId);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }

      if (res.weekData) {
        SCHEDULE_REGISTRY[groupId] = res.weekData;
        registerScheduleAliases(groupId, res.weekData);
        markScheduleLoaded(groupId);
      }

      setAuditResult({
        groupName: groupConf.name,
        status: 'match',
        summary: `Официальное расписание СамГТУ успешно применено в приложение (${res.message}).`,
        details: [
          'Все 4 недели актуализированы по официальному реестру',
          'Локальный кэш обновлен',
          'Изменения сразу активны в расписании'
        ]
      });

      toast.success(`Расписание ${groupConf.name} успешно обновлено!`);
      if (onScheduleUpdated) {
        onScheduleUpdated();
      }
    } catch (err: any) {
      toast.error(`Ошибка применения расписания: ${err?.message || 'Неизвестная ошибка'}`);
    } finally {
      setIsApplyingOfficial(false);
    }
  };

  const handleCheckOfficial = async (groupId: string) => {
    const groupConf = SAMGTU_GROUP_MAP[groupId];
    if (!groupConf) {
      toast.error('Данная группа не привязана к официальному API');
      return;
    }

    setIsCheckingOfficial(true);
    setAuditResult(null);
    logger.action('SYNC', `Admin initiated official schedule check for ${groupConf.name}`);

    try {
      // 1. Portal weeks that describe the schedule valid NOW (current week + next three).
      //    Weeks 1-4 of the semester are an incomplete draft on the portal: comparing with them produced "differences" that do not exist.
      const { rawWeeks, usedWeeks } = await fetchOfficialCycleWeeks(groupConf.samgtuGroupId);

      if (Object.keys(rawWeeks).length === 0) {
        setAuditResult({
          groupName: groupConf.name,
          status: 'error',
          summary: 'Сервер СамГТУ не вернул данные или временно недоступен. Проверьте сеть.',
          details: []
        });
        return;
      }

      // 2. Parse the official 4-week schedule
      const teachers = getLocalBackup(groupId).subjectTeachers || {};
      const { weekData: officialWeekData, totalLessons: officialTotalCount } = convertOfficialSamgtuToWeekData(groupId, rawWeeks, teachers);

      // 3. Read the app's schedule. A group that was never opened in this session has an EMPTY registry:
      //    load it first, otherwise every official lesson would be reported as "missing in the app".
      if (!isScheduleLoaded(groupId)) {
        try { await loadGroupSchedule(groupId); } catch (e) {}
      }
      let currentWeekData: any = SCHEDULE_REGISTRY[groupId];
      try {
        const customRaw = localStorage.getItem(`custom_schedule_${groupId}`);
        if (customRaw) {
          const parsed = JSON.parse(customRaw);
          if (parsed && typeof parsed === 'object') {
            currentWeekData = parsed;
          }
        }
      } catch (e) {}

      if (!currentWeekData) {
        const cached = readCachedSchedule(groupId);
        if (cached?.data) {
          currentWeekData = cached.data;
        }
      }

      // 4. Compare all weeks and days via scheduleCompare
      const weeksLabel = [1, 2, 3, 4].map(c => usedWeeks[c]).filter(Boolean).sort((a, b) => a - b).join(', ');
      const cmp = compareWithOfficial(currentWeekData, officialWeekData);

      if (cmp.status === 'no-local-data') {
        setAuditResult({
          groupName: groupConf.name,
          status: 'error',
          summary: 'Расписание этой группы не удалось загрузить в приложение, сравнивать не с чем. Откройте группу во вкладке «Пары» и повторите сверку.',
          details: []
        });
        return;
      }

      if (cmp.status === 'match') {
        setAuditResult({
          groupName: groupConf.name,
          status: 'match',
          summary: `Расписание группы ${groupConf.name} полностью совпадает с порталом СамГТУ (${officialTotalCount} пар на 4 недели, недели портала: ${weeksLabel}). Расхождений нет.`,
          details: []
        });
        toast.success(`Сверка ${groupConf.name}: 0 расхождений`);
      } else {
        const diffs = cmp.diffs;
        setAuditResult({
          groupName: groupConf.name,
          status: 'diff',
          summary: `Обнаружено ${diffs.length} расхождений (на портале: ${officialTotalCount} пар, в приложении: ${cmp.currentTotal} пар; недели портала: ${weeksLabel}).`
            + (groupConf.lkVerified
              ? ' Эталон этой группы: ЛК СамГТУ, публичный портал может отставать. Не нажимайте «Применить», пока не убедитесь, что портал прав.'
              : ' Нажмите «Применить», чтобы синхронизировать данные с порталом.'),
          details: diffs.slice(0, 10).concat(diffs.length > 10 ? [`...и еще ${diffs.length - 10} расхождений`] : [])
        });
        toast.warning(`Группа ${groupConf.name}: есть расхождения (${diffs.length})`);
      }
    } catch (err: any) {
      setAuditResult({
        groupName: groupConf.name,
        status: 'error',
        summary: `Ошибка при проверке: ${err?.message || 'Неизвестная ошибка'}`,
        details: []
      });
    } finally {
      setIsCheckingOfficial(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Role State Banner / Access Code Verification Form */}
      {currentRole === 'admin' ? (
        <div className="space-y-6">
          <div className="bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent border border-emerald-500/20 rounded-3xl p-6 shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shadow-md shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Режим Главного Администратора активен</h3>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Полный доступ ко всем функциям управления системой</p>
                </div>
              </div>
              <button
                onClick={() => { onRoleChange('student'); toast.info('Сессия администратора завершена'); }}
                className="px-3.5 py-2 text-xs font-bold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-all self-start sm:self-auto"
              >
                Выйти из админки
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Авторизация подтверждена. Вам доступны: глобальное редактирование расписания, сверка с СамГТУ, назначение ответственных преподавателей, сброс кэша и принудительная синхронизация с облаком.
            </p>
          </div>

          {/* SamGTU Schedule Sync Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <RefreshCw className={`w-5 h-5 ${isCheckingOfficial ? 'animate-spin' : ''}`} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Сверка расписания с публичным порталом СамГТУ</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Сверка с витриной samgtu.ru. Расписания из ЛК (lk.samgtu.ru) защищены от перезаписи</p>
                </div>
              </div>
              <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-2.5 py-1 rounded-full uppercase tracking-wider">
                API СамГТУ
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
              {/* Touch-Friendly Mobile Group Picker */}
              <div className="relative flex-1">
                <button
                  type="button"
                  onClick={() => setIsGroupPickerOpen(!isGroupPickerOpen)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white flex items-center justify-between min-h-[44px] cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors"
                >
                  <div className="flex items-center gap-2 truncate text-left">
                    <span className="font-bold">{SAMGTU_GROUP_MAP[selectedAuditGroup]?.name || selectedAuditGroup}</span>
                    <span className="text-[11px] text-slate-400 font-normal truncate">({SAMGTU_GROUP_MAP[selectedAuditGroup]?.samgtuName})</span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${isGroupPickerOpen ? 'rotate-180' : ''}`} />
                </button>

                {isGroupPickerOpen && (
                  <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-1.5 space-y-1">
                    {Object.entries(SAMGTU_GROUP_MAP).map(([gid, conf]) => (
                      <button
                        key={gid}
                        type="button"
                        onClick={() => {
                          setSelectedAuditGroup(gid);
                          setIsGroupPickerOpen(false);
                          setAuditResult(null);
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-medium transition-all flex items-center justify-between cursor-pointer ${
                          selectedAuditGroup === gid
                            ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-bold'
                            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                        }`}
                      >
                        <div className="flex flex-col">
                          <span className="font-bold">{conf.name}</span>
                          <span className="text-[10px] text-slate-400">{conf.samgtuName}</span>
                        </div>
                        {selectedAuditGroup === gid && <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={() => handleCheckOfficial(selectedAuditGroup)}
                disabled={isCheckingOfficial || isApplyingOfficial}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 min-h-[44px] cursor-pointer shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isCheckingOfficial ? 'animate-spin' : ''}`} />
                {isCheckingOfficial ? 'Сверяю...' : 'Запустить сверку'}
              </button>
              <button
                onClick={() => handleApplyOfficialSchedule(selectedAuditGroup)}
                disabled={isCheckingOfficial || isApplyingOfficial}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 min-h-[44px] cursor-pointer shrink-0"
                title="Принудительно загрузить и применить расписание СамГТУ на все 4 недели"
              >
                <Download className={`w-3.5 h-3.5 ${isApplyingOfficial ? 'animate-spin' : ''}`} />
                {isApplyingOfficial ? 'Обновляю...' : 'Синхронизировать'}
              </button>
            </div>

            {auditResult && (
              <div className={`p-4 rounded-2xl border text-xs space-y-3 ${
                auditResult.status === 'match'
                  ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40 text-emerald-900 dark:text-emerald-200'
                  : auditResult.status === 'diff'
                  ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40 text-amber-900 dark:text-amber-200'
                  : 'bg-red-50/60 dark:bg-red-950/20 border-red-200 dark:border-red-800/40 text-red-900 dark:text-red-200'
              }`}>
                <div className="flex items-center justify-between font-bold">
                  <span>Результат для группы {auditResult.groupName}:</span>
                  <span>{auditResult.status === 'match' ? '✅ Полное совпадение' : auditResult.status === 'diff' ? '⚠️ Есть расхождения' : '❌ Ошибка сети'}</span>
                </div>
                <p className="text-[11px] opacity-90">{auditResult.summary}</p>
                {auditResult.details.length > 0 && (
                  <ul className="list-disc list-inside space-y-1 text-[11px] pt-1">
                    {auditResult.details.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                )}


                {/* Prominent Action Button: Apply / Sync Official Schedule for ANY group */}
                {auditResult.status === 'diff' && (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => handleApplyOfficialSchedule(selectedAuditGroup)}
                      disabled={isApplyingOfficial || isCheckingOfficial}
                      className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 min-h-[44px] cursor-pointer"
                    >
                      <Download className={`w-4 h-4 ${isApplyingOfficial ? 'animate-spin' : ''}`} />
                      {isApplyingOfficial ? 'Синхронизирую все 4 недели из СамГТУ...' : 'Применить официальное расписание из СамГТУ'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Stage 5: Telegram Slots & Active Groups Breakdown */}
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Статус групп и готовность к рассылкам (Этап 5)
                  </span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300">
                  {groupStats.filter(g => g.isReadyForPush).length} из {groupStats.length} готовы
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Рассылки утренних дайджестов (07:30) и напоминаний за 24 ч будут активированы только для групп со сформированным списком студентов.
              </p>

              <div className="divide-y divide-slate-200/70 dark:divide-slate-700/60 max-h-60 overflow-y-auto rounded-xl border border-slate-200/60 dark:border-slate-700/50 bg-white dark:bg-slate-900/60">
                {groupStats.map(grp => (
                  <div key={grp.id} className="p-2.5 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center font-bold text-indigo-600 dark:text-indigo-400 text-[11px]">
                        {grp.course}
                      </div>
                      <div>
                        <div className="font-bold text-slate-900 dark:text-white leading-tight">
                          {grp.name}
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                          <Users className="w-3 h-3" />
                          <span>Студентов: {grp.studentCount}</span>
                          {grp.hasCustomOverrides && <span className="text-amber-500 font-semibold">• Свои правки</span>}
                        </div>
                      </div>
                    </div>

                    <div>
                      {grp.isReadyForPush ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                          <CheckCircle2 className="w-3 h-3" /> Готова к пушам
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          Ожидает старосту
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Maintenance Mode Controls */}
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-amber-500" />
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">Режим технических работ</span>
                </div>
                <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                  isSimulatingMaintenance 
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' 
                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                }`}>
                  {isSimulatingMaintenance ? 'ВКЛЮЧЕН (ТЕСТ)' : 'ВЫКЛЮЧЕН'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Включает экран-заглушку технических работ для проверки интерфейса обслуживания, кнопки офлайн-расписания и аварийного входа по коду доступа.
              </p>
              <button
                type="button"
                onClick={handleToggleMaintenance}
                className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  isSimulatingMaintenance
                    ? 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200'
                    : 'bg-amber-500 hover:bg-amber-600 text-white shadow-xs'
                }`}
              >
                <Wrench className="w-3.5 h-3.5" />
                {isSimulatingMaintenance ? 'Отключить режим техработ' : 'Активировать экран техработ'}
              </button>
            </div>
          </div>
        </div>
      ) : currentRole === 'starosta' ? (
        <div className="bg-gradient-to-br from-indigo-500/10 via-blue-500/5 to-transparent border border-indigo-500/20 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Режим Старосты активен</h3>
                <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">Доступны отметки посещаемости и редактирование пар группы</p>
              </div>
            </div>
            <button
              onClick={() => { onRoleChange('student'); toast.info('Сессия старосты завершена'); }}
              className="px-3.5 py-2 text-xs font-bold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-all self-start sm:self-auto"
            >
              Выйти
            </button>
          </div>
          <div className="pt-2 border-t border-indigo-100 dark:border-indigo-900/40">
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
              Для перехода в режим Главного Администратора введите код доступа администратора:
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="password"
                inputMode="text"
                maxLength={19}
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleVerifyAccessCode()}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none min-h-[44px]"
              />
              <button
                onClick={handleVerifyAccessCode}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm min-h-[44px]"
              >
                Повысить до Админа
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex items-center gap-3">
            <Key className="w-5 h-5 text-amber-500" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Авторизация по коду доступа</h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Для доступа к функциям Старосты или Главного Администратора введите ваш закрытый персональный код доступа.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="password"
              inputMode="text"
              maxLength={19}
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleVerifyAccessCode()}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none min-h-[44px]"
            />
            <button
              onClick={handleVerifyAccessCode}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm min-h-[44px]"
            >
              Подтвердить
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
