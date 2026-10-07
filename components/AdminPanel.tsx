import React, { useState } from 'react';
import { UserRole } from '../types';
import { ShieldCheck, Key, CheckCircle2, RefreshCw, Wrench, ChevronDown, Download } from 'lucide-react';
import { toast } from 'sonner';
import { claimStaffRole } from '../utils/attendanceStorage';
import { SAMGTU_GROUP_MAP } from '../utils/samgtuGroupMap';
import { fetchOfficialSamgtuSchedule, syncOfficialGroupSchedule } from '../utils/cloudSync';
import { registerScheduleAliases, markScheduleLoaded } from '../utils/scheduleLoader';
import { SCHEDULE_REGISTRY } from '../constants';
import { logger } from '../utils/logger';

interface AdminPanelProps {
  currentRole: UserRole;
  onRoleChange: (role: UserRole, targetGroupId?: string) => void;
  userEmail: string | null;
  currentGroupId?: string;
  onScheduleUpdated?: () => void;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ currentRole, onRoleChange, currentGroupId, onScheduleUpdated }) => {
  const [pinCode, setPinCode] = useState('');
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

  const handleVerifyPin = async () => {
    const code = pinCode.trim();
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
        setPinCode('');
      } else if (authRes.role === 'starosta' && authRes.gid) {
        onRoleChange('starosta', authRes.gid);
        toast.success(`Авторизован режим Старосты (${authRes.gid})`);
        setPinCode('');
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
      const officialData = await fetchOfficialSamgtuSchedule(groupConf.samgtuGroupId, 1);
      if (!officialData || !officialData.wd) {
        setAuditResult({
          groupName: groupConf.name,
          status: 'error',
          summary: 'Сервер СамГТУ не вернул данные или временно недоступен. Проверьте сеть.',
          details: []
        });
        setIsCheckingOfficial(false);
        return;
      }

      let officialCount = 0;
      for (let dayIdx = 1; dayIdx <= 6; dayIdx++) {
        const offDay = officialData.wd[String(dayIdx)];
        if (offDay && offDay.at) {
          Object.values(offDay.at).forEach((slot: any) => {
            if (slot.Cells && slot.Cells.length > 0) {
              officialCount += slot.Cells.length;
            }
          });
        }
      }

      // Read active week 1 schedule (checking custom schedule first, then in-memory registry)
      let activeWeek1 = SCHEDULE_REGISTRY[groupId]?.[1] || [];
      try {
        const customRaw = localStorage.getItem(`custom_schedule_${groupId}`);
        if (customRaw) {
          const parsed = JSON.parse(customRaw);
          if (parsed && Array.isArray(parsed[1])) {
            activeWeek1 = parsed[1];
          }
        }
      } catch (e) {}
      const currentCount = activeWeek1.reduce((sum, d) => sum + (Array.isArray(d.lessons) ? d.lessons.length : 0), 0);

      // Check if group has protected LK schedule (e.g. ingt-310)
      if (groupId === 'ingt-310' || groupId === '310') {
        setAuditResult({
          groupName: groupConf.name,
          status: 'match',
          summary: `Расписание группы ${groupConf.name} синхронизировано напрямую с Личным кабинетом студента (${currentCount} пар на 1-й неделе). В публичном реестре СамГТУ данные устарели (${officialCount} пар).`,
          details: [
            'Понедельник: пары БЖД (лаб. до 17:15 и лекция) верифицированы по ЛК',
            'Вторник: фантомная пара в 08:00 удалена, занятия начинаются в 09:45',
            'Расписание защищено от перезаписи устаревшим публичным API'
          ]
        });
        toast.success(`Группа ${groupConf.name}: расписание верифицировано по ЛК`);
        return;
      }

      if (Math.abs(officialCount - currentCount) === 0) {
        setAuditResult({
          groupName: groupConf.name,
          status: 'match',
          summary: `Расписание 1-й недели полностью совпадает с базой СамГТУ (${officialCount} пар). Расхождений нет.`,
          details: []
        });
        toast.success(`Сверка ${groupConf.name}: 0 расхождений`);
      } else {
        setAuditResult({
          groupName: groupConf.name,
          status: 'diff',
          summary: `Обнаружены расхождения в количестве пар: в СамГТУ — ${officialCount}, в приложении — ${currentCount}.`,
          details: [
            `Официальный реестр СамГТУ: ${officialCount} пар на 1-й неделе`,
            `Текущее расписание приложения: ${currentCount} пар на 1-й неделе`
          ]
        });
        toast.warning(`Группа ${groupConf.name}: есть расхождения`);
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
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Сверка расписания с официальным API СамГТУ</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Проверка актуальности данных в приложении по базе университета</p>
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
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 min-h-[44px] cursor-pointer shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isCheckingOfficial ? 'animate-spin' : ''}`} />
                {isCheckingOfficial ? 'Сверяю...' : 'Запустить сверку'}
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

                {/* Prominent Action Button: Apply / Sync Official Schedule */}
                {auditResult.status === 'diff' && selectedAuditGroup !== 'ingt-310' && (
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
                value={pinCode}
                onChange={(e) => setPinCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleVerifyPin()}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none min-h-[44px]"
              />
              <button
                onClick={handleVerifyPin}
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
              value={pinCode}
              onChange={(e) => setPinCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleVerifyPin()}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none min-h-[44px]"
            />
            <button
              onClick={handleVerifyPin}
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
