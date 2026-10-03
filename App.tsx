import React, { useState, useEffect, useLayoutEffect, useMemo, Suspense, useRef } from 'react';
import { ThemePref, getThemePref, setThemePref, syncTelegramTheme } from './utils/theme';
import { SCHEDULE_REGISTRY, AVAILABLE_GROUPS, FACULTIES, createEmptyWeek } from './constants';
import { getSemesterWeek, getWeekDateRange, getDayISODate, useAttendance, getSamaraISODate } from './attendance';
import { getSamaraDate } from './utils/samaraDate';
import { useNow } from './utils/useNow';
import SwipeableDays from './components/SwipeableDays';
import BottomNav from './components/BottomNav';
import TabErrorBoundary from './components/TabErrorBoundary';
import { Toaster, toast } from 'sonner';
import { UserRole, Lesson, GroupConfig, WeekData } from './types';
import { TeacherAssignmentScope } from './components/EditLessonModal';
import { fetchGroupCloudData, pushGroupCloudData, sanitizeTeachers, sanitizeOverrides, WORKER_BASE } from './utils/cloudSync';
import { SEED_SCHEDULE_OVERRIDES, SEED_SUBJECT_TEACHERS, getSeedSubjectTeachers } from './defaultData';
import { verifyPinCode } from './utils/auth';
import { logger } from './utils/logger';
import { getCanonicalGroupKey, normalizeSamgtuGroupName } from './utils/samgtuParser';
import ScheduleState from './components/ScheduleState';
import { loadGroupSchedule, isScheduleLoaded, reloadGroupSchedule, LoadFailReason } from './utils/scheduleLoader';
import { getLocalStudentLink, claimStaffRole } from './utils/attendanceStorage';
import {
  LogIn, LogOut, Calendar, BookOpen, Bug, ClipboardCheck, Sun, Moon,
  GraduationCap, Users, RefreshCw, Shield, User as UserIcon, Key, UserCheck, ChevronDown,
  Search, Plus, X, Terminal, RotateCcw, Database
} from 'lucide-react';

// Code-split heavy tabs and modals to keep the initial client bundle ultra-light for students
const AttendanceTracker = React.lazy(() => import('./components/AttendanceTracker'));
const HomeworkTracker = React.lazy(() => import('./components/HomeworkTracker'));
const SubjectTeachersModal = React.lazy(() => import('./components/SubjectTeachersModal'));
const GroupManager = React.lazy(() => import('./components/GroupManager'));
const AdminPanel = React.lazy(() => import('./components/AdminPanel'));
const BugReportModal = React.lazy(() => import('./components/BugReportModal'));
const DebugLogsModal = React.lazy(() => import('./components/DebugLogsModal'));
const MaintenanceScreen = React.lazy(() => import('./components/MaintenanceScreen'));
const ConsentModal = React.lazy(() => import('./components/ConsentModal'));
const StudentLinkModal = React.lazy(() => import('./components/StudentLinkModal'));
const MyAbsencesModal = React.lazy(() => import('./components/MyAbsencesModal'));
const PrivacyPolicyModal = React.lazy(() => import('./components/PrivacyPolicyModal'));

interface UserProfile {
  displayName?: string | null;
  email?: string | null;
}

const TabFallback: React.FC = () => (
  <div className="flex items-center justify-center p-12 min-h-[200px]">
    <div className="flex flex-col items-center gap-2.5 text-slate-400">
      <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      <span className="text-xs font-medium">Загрузка модуля...</span>
    </div>
  </div>
);

declare global {
  interface Window {
    Telegram?: any;
  }
}

const App: React.FC = () => {
  const [pref, setPref] = useState<ThemePref>(() => getThemePref());
  const [tgScheme, setTgScheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined' && window.Telegram?.WebApp?.colorScheme) {
      return window.Telegram.WebApp.colorScheme;
    }
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  });

  const darkMode = pref === 'auto' ? tgScheme === 'dark' : pref === 'dark';
  const [activeTab, setActiveTab] = useState<'schedule' | 'homework' | 'attendance' | 'group' | 'admin' | 'profile'>('schedule');
  const [user, setUser] = useState<UserProfile | null>(null);
  
  // Default role is 'student' for unauthenticated users
  const [userRole, setUserRole] = useState<UserRole>(() => {
    return (localStorage.getItem('user_role') as UserRole) || (localStorage.getItem('auth_role') as UserRole) || 'student';
  });

  // Track which group this starosta has authority over
  const [starostaGroupId, setStarostaGroupId] = useState<string | null>(() => {
    return localStorage.getItem('starosta_group_id') || localStorage.getItem('auth_group') || null;
  });

  const [isAuthReady, setIsAuthReady] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [quickPin, setQuickPin] = useState('');
  const [isSubjectTeachersModalOpen, setIsSubjectTeachersModalOpen] = useState(false);

  // Student group binding: check if student has already bound their group
  const [boundGroupId, setBoundGroupId] = useState<string | null>(() => {
    return localStorage.getItem('my_group_id') || null;
  });
  const [isGroupSelectionModalOpen, setIsGroupSelectionModalOpen] = useState(() => {
    return !localStorage.getItem('my_group_id');
  });

  // Blind Server v3 student modals state
  const [isConsentModalOpen, setIsConsentModalOpen] = useState(false);
  const [isStudentLinkModalOpen, setIsStudentLinkModalOpen] = useState(false);
  const [isMyAbsencesModalOpen, setIsMyAbsencesModalOpen] = useState(false);

  const handleOpenMyAbsences = () => {
    const link = getLocalStudentLink();
    if (link) {
      setIsMyAbsencesModalOpen(true);
    } else {
      setIsConsentModalOpen(true);
    }
  };

  const handleConsentGiven = () => {
    setIsConsentModalOpen(false);
    setIsStudentLinkModalOpen(true);
  };

  const handleLinkSuccess = () => {
    setIsStudentLinkModalOpen(false);
    setIsMyAbsencesModalOpen(true);
  };

  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);
  const [groupCodeInput, setGroupCodeInput] = useState('');
  const [isClaimingStaff, setIsClaimingStaff] = useState(false);

  const handleClaimGroupCode = async () => {
    const clean = groupCodeInput.trim().toUpperCase();
    if (!clean) {
      toast.error('Введите код группы или администратора');
      return;
    }
    setIsClaimingStaff(true);
    try {
      const res = await claimStaffRole(currentGroupId, clean);
      if (res.ok) {
        if (res.role === 'admin') {
          toast.success('Права администратора подтверждены!');
          setUserRole('admin');
          localStorage.setItem('user_role', 'admin');
          localStorage.setItem('auth_role', 'admin');
          setGroupCodeInput('');
          return;
        }
        toast.success('Права старосты подтверждены через Telegram!');
        setUserRole('starosta');
        setStarostaGroupId(currentGroupId);
        localStorage.setItem('user_role', 'starosta');
        localStorage.setItem('auth_role', 'starosta');
        localStorage.setItem('starosta_group_id', currentGroupId);
        localStorage.setItem('auth_group', currentGroupId);
        localStorage.setItem('my_group_id', currentGroupId);
        setBoundGroupId(currentGroupId);
        setGroupCodeInput('');
      } else {
        toast.error(res.error || 'Неверный код группы или администратора');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка сети');
    } finally {
      setIsClaimingStaff(false);
    }
  };

  // Multi-group & custom groups state with self-healing deduplication
  const [customGroups, setCustomGroups] = useState<GroupConfig[]>(() => {
    try {
      const saved = localStorage.getItem('custom_groups');
      const parsed: GroupConfig[] = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(parsed) || parsed.length === 0) return [];

      const builtInKeys = new Set(AVAILABLE_GROUPS.map(g => getCanonicalGroupKey(g)));
      const seenCustomKeys = new Set<string>();
      const sanitized: GroupConfig[] = [];

      for (const cg of parsed) {
        if (!cg || !cg.id || !cg.name) continue;
        const key = getCanonicalGroupKey(cg);
        // If it already exists in built-in AVAILABLE_GROUPS (e.g. 110, 111, 113), drop custom duplicate
        if (builtInKeys.has(key)) continue;
        if (seenCustomKeys.has(key)) continue;
        seenCustomKeys.add(key);
        sanitized.push(cg);
      }

      if (sanitized.length !== parsed.length) {
        localStorage.setItem('custom_groups', JSON.stringify(sanitized));
      }
      return sanitized;
    } catch (e) {
      return [];
    }
  });

  const allAvailableGroups = useMemo(() => {
    const map = new Map<string, GroupConfig>();
    AVAILABLE_GROUPS.forEach(g => {
      const key = getCanonicalGroupKey(g);
      map.set(key, g);
    });
    customGroups.forEach(g => {
      const key = getCanonicalGroupKey(g);
      if (!map.has(key)) {
        map.set(key, g);
      }
    });
    return Array.from(map.values());
  }, [customGroups]);

  // Group selection filter states for the modal
  const [selectedFacultyFilter, setSelectedFacultyFilter] = useState<string>('all');
  const [selectedCourseFilter, setSelectedCourseFilter] = useState<number>(0);
  const [groupSearchQuery, setGroupSearchQuery] = useState<string>('');
  const [isAddingCustomGroup, setIsAddingCustomGroup] = useState<boolean>(false);
  const [newGroupName, setNewGroupName] = useState<string>('');
  const [newGroupFaculty, setNewGroupFaculty] = useState<string>('ingt');
  const [newGroupCourse, setNewGroupCourse] = useState<number>(1);
  const [isBugReportModalOpen, setIsBugReportModalOpen] = useState<boolean>(false);
  const [isDebugLogsModalOpen, setIsDebugLogsModalOpen] = useState<boolean>(false);

  // Maintenance Mode states
  const [isMaintenanceMode, setIsMaintenanceMode] = useState<boolean>(() => {
    return localStorage.getItem('simulate_maintenance') === 'true';
  });
  const [maintenanceMessage, setMaintenanceMessage] = useState<string>(
    'Ведутся плановые технические работы по обновлению базы данных расписания.'
  );
  const [maintenanceUntil, setMaintenanceUntil] = useState<string | null>(null);
  const [isMaintenanceDismissed, setIsMaintenanceDismissed] = useState<boolean>(() => {
    return sessionStorage.getItem('admin_maintenance_bypass') === 'true' || sessionStorage.getItem('dismiss_maintenance') === 'true';
  });

  const checkMaintenanceStatus = async () => {
    if (localStorage.getItem('simulate_maintenance') === 'true') {
      setIsMaintenanceMode(true);
      return;
    }
    try {
      const res = await fetch(`${WORKER_BASE}/status`, { signal: AbortSignal.timeout(3500) });
      if (res.ok) {
        const data = await res.json();
        if (data.maintenance) {
          setIsMaintenanceMode(true);
          if (data.message) setMaintenanceMessage(data.message);
          if (data.estimatedEndTime) setMaintenanceUntil(data.estimatedEndTime);
          return;
        }
      }
      setIsMaintenanceMode(false);
    } catch {
      setIsMaintenanceMode(false);
    }
  };

  useEffect(() => {
    checkMaintenanceStatus();
  }, []);

  const headerTapCountRef = React.useRef<number>(0);
  const lastHeaderTapTimeRef = React.useRef<number>(0);
  const lastVisibilitySyncRef = useRef<number>(0);

  const handleHeaderTitleTap = () => {
    const now = Date.now();
    if (now - lastHeaderTapTimeRef.current < 600) {
      headerTapCountRef.current += 1;
      if (headerTapCountRef.current >= 5) {
        headerTapCountRef.current = 0;
        if (effectiveRole === 'admin') {
          setIsDebugLogsModalOpen(true);
          logger.action('UI', 'Debug console opened via 5-tap gesture on header');
          if (typeof window !== 'undefined' && window.Telegram?.WebApp?.HapticFeedback) {
            window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
          }
          toast.info('Режим диагностики активирован');
        }
      }
    } else {
      headerTapCountRef.current = 1;
    }
    lastHeaderTapTimeRef.current = now;
  };

  // Multi-group state: defaults to bound group, then saved selection, then 3-ИНГТ-110
  const [currentGroupId, setCurrentGroupId] = useState<string>(() => {
    const bound = localStorage.getItem('my_group_id');
    if (bound) return bound;
    const saved = localStorage.getItem('selected_group_id');
    if (saved === 'ingt-1') return 'ingt-301';
    if (saved === 'faid-110') return 'faid-310';
    if (saved) return saved;
    return 'ingt-310';
  });

  const [isScheduleLoading, setIsScheduleLoading] = useState<boolean>(() => !isScheduleLoaded(currentGroupId));
  const [scheduleLoadError, setScheduleLoadError] = useState<LoadFailReason | null>(null);

  // Effective Role: Starosta only has edit rights in their designated group.
  // When viewing other groups, they become a read-only 'student'.
  // Global admin PIN 2808 has full access across all groups.
  const effectiveRole: UserRole = useMemo(() => {
    if (userRole === 'admin') return 'admin';
    if (userRole === 'starosta') {
      const activeGroup = starostaGroupId || localStorage.getItem('starosta_group_id') || localStorage.getItem('auth_group');
      if (activeGroup && currentGroupId.toLowerCase() === activeGroup.toLowerCase()) {
        return 'starosta';
      }
      return 'student';
    }
    return 'student';
  }, [userRole, starostaGroupId, currentGroupId]);

  const canEdit = effectiveRole === 'admin' || effectiveRole === 'starosta';

  const handleSelectGroup = (groupId: string) => {
    setBoundGroupId(groupId);
    setCurrentGroupId(groupId);
    try {
      localStorage.setItem('my_group_id', groupId);
      localStorage.setItem('selected_group_id', groupId);
    } catch (e) {}
    setIsGroupSelectionModalOpen(false);
    const grp = allAvailableGroups.find(g => g.id === groupId);
    toast.success(`Выбрана группа ${grp?.name || groupId}`);

    if (!isScheduleLoaded(groupId)) {
      setIsScheduleLoading(true);
      setScheduleLoadError(null);
      loadGroupSchedule(groupId).then((result) => {
        setIsScheduleLoading(false);
        if (result.ok === false) {
          setScheduleLoadError(result.reason);
        } else {
          setScheduleLoadError(null);
        }
        setRefreshTrigger(prev => prev + 1);
      }).catch(() => {
        setIsScheduleLoading(false);
        setScheduleLoadError('network');
      });
    } else {
      setIsScheduleLoading(false);
      setScheduleLoadError(null);
      setRefreshTrigger(prev => prev + 1);
    }
  };

  const handleRetryScheduleLoad = () => {
    setIsScheduleLoading(true);
    setScheduleLoadError(null);
    loadGroupSchedule(currentGroupId).then((result) => {
      setIsScheduleLoading(false);
      if (result.ok === false) {
        setScheduleLoadError(result.reason);
      } else {
        setScheduleLoadError(null);
      }
      setRefreshTrigger(prev => prev + 1);
    }).catch(() => {
      setIsScheduleLoading(false);
      setScheduleLoadError('network');
    });
  };

  const handleCreateCustomGroup = (e: React.FormEvent) => {
    e.preventDefault();
    const rawInput = newGroupName.trim();
    if (!rawInput) {
      toast.error('Введите номер группы');
      return;
    }

    const facObj = FACULTIES.find(f => f.id === newGroupFaculty) || { shortName: newGroupFaculty.toUpperCase() };
    const facShort = facObj.shortName;

    // Smart canonical normalization:
    let cleanName = rawInput.toUpperCase();
    let detectedCourse = newGroupCourse;

    // Case 1: Just numbers entered, e.g. "111", "110", "109", "101"
    if (/^\d{3,4}$/.test(rawInput)) {
      cleanName = `${newGroupCourse}-${facShort}-${rawInput}`;
    } else {
      // Case 2: User entered "3-ИНГТ-110" or "3 ИНГТ 110" or "24ИНГТ-110" or "3ингт110"
      const matchFull = rawInput.match(/^([1-6])[\s_-]*([а-яёa-z]+)[\s_-]*(\d+)/i);
      if (matchFull) {
        detectedCourse = parseInt(matchFull[1], 10);
        cleanName = `${matchFull[1]}-${matchFull[2].toUpperCase()}-${matchFull[3]}`;
      } else {
        const firstChar = rawInput.charAt(0);
        if (/^[1-6]$/.test(firstChar)) {
          detectedCourse = parseInt(firstChar, 10);
        }
      }
    }

    // Check if cleanName is a known group or matches any existing group in allAvailableGroups
    const cleanLower = cleanName.toLowerCase();
    const cleanNoDashes = cleanLower.replace(/[^a-z0-9а-яё]/gi, '');
    const cleanKey = getCanonicalGroupKey(cleanName);

    const existingMatch = allAvailableGroups.find(g => {
      const gKey = getCanonicalGroupKey(g);
      if (gKey && cleanKey && gKey === cleanKey) return true;
      const gNameLower = g.name.toLowerCase();
      const gIdLower = g.id.toLowerCase();
      const gNoDashes = gNameLower.replace(/[^a-z0-9а-яё]/gi, '');
      const gIdNoDashes = gIdLower.replace(/[^a-z0-9а-яё]/gi, '');
      return (
        gNameLower === cleanLower ||
        gIdLower === cleanLower ||
        gNoDashes === cleanNoDashes ||
        gIdNoDashes === cleanNoDashes ||
        (/^\d{3,4}$/.test(rawInput) && g.course === newGroupCourse && g.facultyId === newGroupFaculty && (g.name.endsWith(rawInput) || g.id.endsWith(rawInput)))
      );
    });

    if (existingMatch) {
      handleSelectGroup(existingMatch.id);
      toast.info(`Группа ${existingMatch.name} уже есть в списке и была выбрана!`);
      setNewGroupName('');
      setIsAddingCustomGroup(false);
      return;
    }

    // Validation: prevent random gibberish or empty groups
    if (cleanName.length < 3 || !/\d/.test(cleanName)) {
      toast.error('Пожалуйста, укажите корректный номер группы СамГТУ (например: 2-ИАИТ-108)');
      return;
    }

    const norm = normalizeSamgtuGroupName(cleanName);
    const generatedId = (norm.id && norm.id !== 'custom-group') ? norm.id : cleanName.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '-');

    const newGroup: GroupConfig = {
      id: generatedId,
      name: cleanName,
      facultyId: newGroupFaculty,
      course: detectedCourse,
      degree: detectedCourse === 5 ? 'Специалитет' : 'Бакалавриат'
    };

    // Ensure empty schedule is initialized so app never crashes
    if (!SCHEDULE_REGISTRY[generatedId]) {
      SCHEDULE_REGISTRY[generatedId] = {
        1: createEmptyWeek(),
        2: createEmptyWeek(),
        3: createEmptyWeek(),
        4: createEmptyWeek()
      };
    }

    const updated = [
      ...customGroups.filter(g => {
        const k = getCanonicalGroupKey(g);
        return k !== cleanKey && k !== generatedId && g.id !== generatedId && g.name.toLowerCase() !== cleanLower;
      }),
      newGroup
    ];
    setCustomGroups(updated);
    try {
      localStorage.setItem('custom_groups', JSON.stringify(updated));
    } catch (e) {}

    handleSelectGroup(generatedId);
    setNewGroupName('');
    setIsAddingCustomGroup(false);
  };

  const filteredGroups = useMemo(() => {
    const q = groupSearchQuery.toLowerCase().trim();
    const matched = allAvailableGroups.filter(grp => {
      // Global search across all faculties if user typed 2+ characters
      if (q.length >= 2) {
        const matchName = grp.name.toLowerCase().includes(q);
        const fac = FACULTIES.find(f => f.id === grp.facultyId);
        const matchFac = fac?.name.toLowerCase().includes(q) || fac?.shortName.toLowerCase().includes(q);
        return matchName || matchFac;
      }
      if (selectedFacultyFilter !== 'all') {
        if (selectedFacultyFilter === 'asa' && grp.facultyId === 'faid') {
          // match FAID as part of ASA
        } else if (grp.facultyId !== selectedFacultyFilter) {
          return false;
        }
      }
      if (selectedCourseFilter !== 0 && grp.course !== selectedCourseFilter) {
        return false;
      }
      if (q) {
        const matchName = grp.name.toLowerCase().includes(q);
        const fac = FACULTIES.find(f => f.id === grp.facultyId);
        const matchFac = fac?.name.toLowerCase().includes(q) || fac?.shortName.toLowerCase().includes(q);
        if (!matchName && !matchFac) return false;
      }
      return true;
    });

    // Secondary strict pass through uniqueMap by getCanonicalGroupKey to guarantee zero duplicates
    const uniqueMap = new Map<string, GroupConfig>();
    for (const g of matched) {
      const key = getCanonicalGroupKey(g);
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, g);
      }
    }
    return Array.from(uniqueMap.values());
  }, [allAvailableGroups, selectedFacultyFilter, selectedCourseFilter, groupSearchQuery]);

  const currentGroupConfig = useMemo(() => {
    return allAvailableGroups.find(g => g.id === currentGroupId) || allAvailableGroups[0];
  }, [currentGroupId, allAvailableGroups]);

  const currentFaculty = useMemo(() => {
    return FACULTIES.find(f => f.id === currentGroupConfig?.facultyId) || FACULTIES[0];
  }, [currentGroupConfig]);

  // Load attendance records and markAttendance for cross-linking cancelled lessons
  const { records: attendanceRecords, markAttendance } = useAttendance(
    canEdit, 
    currentGroupId, 
    refreshTrigger
  );

  // Calculate current week automatically based on Samara time (UTC+4) starting Aug 31, 2026
  const liveNow = useNow(60000);
  const samaraNow = useMemo(() => getSamaraDate(liveNow), [liveNow]);
  const currentWeek = useMemo(() => getSemesterWeek(samaraNow, currentGroupId), [samaraNow, currentGroupId]);
  const [selectedWeek, setSelectedWeek] = useState<number>(currentWeek);

  // Global Subject Teachers mapping (e.g. subject -> teacher)
  const [subjectTeachers, setSubjectTeachers] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem(`subject_teachers_${currentGroupId}`);
      const parsed = saved ? JSON.parse(saved) : {};
      const defaultTeachers = getSeedSubjectTeachers(currentGroupId);
      return sanitizeTeachers({ ...defaultTeachers, ...parsed }, currentGroupId);
    } catch (e) {
      return sanitizeTeachers({ ...getSeedSubjectTeachers(currentGroupId) }, currentGroupId);
    }
  });

  // Schedule Overrides (Edited teachers, rooms, notes per lesson)
  const [scheduleOverrides, setScheduleOverrides] = useState<Record<string, Partial<Lesson>>>(() => {
    try {
      const saved = localStorage.getItem(`schedule_overrides_${currentGroupId}`);
      if (saved !== null) {
        return sanitizeOverrides(JSON.parse(saved));
      }
      return sanitizeOverrides({ ...SEED_SCHEDULE_OVERRIDES });
    } catch (e) {
      return sanitizeOverrides({ ...SEED_SCHEDULE_OVERRIDES });
    }
  });

  useEffect(() => {
    setSelectedWeek(currentWeek);
  }, [currentWeek]);

  // Sync group selection and reload group-specific overrides and teachers
  useEffect(() => {
    try {
      localStorage.setItem('selected_group_id', currentGroupId);
    } catch (e) {}
    logger.info('SCHEDULE', `Current group switched to: ${currentGroupId}`);
    try {
      const savedOv = localStorage.getItem(`schedule_overrides_${currentGroupId}`);
      setScheduleOverrides(savedOv ? sanitizeOverrides(JSON.parse(savedOv)) : sanitizeOverrides({ ...SEED_SCHEDULE_OVERRIDES }));
    } catch {
      setScheduleOverrides(sanitizeOverrides({ ...SEED_SCHEDULE_OVERRIDES }));
    }
    try {
      const savedSt = localStorage.getItem(`subject_teachers_${currentGroupId}`);
      const defaultTeachers = getSeedSubjectTeachers(currentGroupId);
      setSubjectTeachers(savedSt ? sanitizeTeachers({ ...defaultTeachers, ...JSON.parse(savedSt) }, currentGroupId) : sanitizeTeachers({ ...defaultTeachers }, currentGroupId));
    } catch {
      setSubjectTeachers(sanitizeTeachers({ ...getSeedSubjectTeachers(currentGroupId) }, currentGroupId));
    }

    // On-demand load group schedule chunk if not loaded yet
    if (!isScheduleLoaded(currentGroupId)) {
      setIsScheduleLoading(true);
      setScheduleLoadError(null);
      loadGroupSchedule(currentGroupId).then((result) => {
        setIsScheduleLoading(false);
        if (result.ok === false) {
          setScheduleLoadError(result.reason);
        } else {
          setScheduleLoadError(null);
        }
        setRefreshTrigger(prev => prev + 1);
      }).catch(() => {
        setIsScheduleLoading(false);
        setScheduleLoadError('network');
      });
    } else {
      setIsScheduleLoading(false);
      setScheduleLoadError(null);
    }
  }, [currentGroupId]);

  // Telegram WebApp theme listener, safe area insets and logging
  // Note: SDK initialization (window.Telegram.WebApp.ready(), window.Telegram.WebApp.expand(),
  // disableVerticalSwipes) is executed before render() in index.tsx via initTelegram().
  useEffect(() => {
    const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
    if (tg) {
      try {
        logger.info('UI', 'Telegram WebApp initialized', {
          platform: tg.platform,
          version: tg.version
        });
      } catch (e) {
        logger.warn('UI', 'Failed to initialize Telegram WebApp SDK', e);
      }

      const h = () => {
        if (tg.colorScheme) {
          setTgScheme(tg.colorScheme);
        }
      };

      tg.onEvent?.('themeChanged', h);

      const updateInsets = () => {
        if (tg.safeAreaInset) {
          document.documentElement.style.setProperty('--tg-safe-area-inset-bottom', `${tg.safeAreaInset.bottom}px`);
        }
        if (tg.contentSafeAreaInset) {
          document.documentElement.style.setProperty('--tg-content-safe-area-inset-top', `${tg.contentSafeAreaInset.top}px`);
        }
      };

      const hasSafeArea = tg.isVersionAtLeast?.('8.0');
      if (hasSafeArea) {
        updateInsets();
        tg.onEvent?.('safeAreaChanged', updateInsets);
        tg.onEvent?.('contentSafeAreaChanged', updateInsets);
      }

      return () => {
        tg.offEvent?.('themeChanged', h);
        if (hasSafeArea) {
          tg.offEvent?.('safeAreaChanged', updateInsets);
          tg.offEvent?.('contentSafeAreaChanged', updateInsets);
        }
      };
    }
  }, []);

  // Save role to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('user_role', userRole);
    } catch (e) {}
  }, [userRole]);

  // Theme class application and Telegram UI synchronization without FOUC
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    syncTelegramTheme(darkMode);
  }, [darkMode]);

  // Load custom imported schedule from localStorage if present
  useEffect(() => {
    try {
      const savedSchedule = localStorage.getItem(`custom_schedule_${currentGroupId}`);
      if (savedSchedule) {
        SCHEDULE_REGISTRY[currentGroupId] = JSON.parse(savedSchedule);
      }
    } catch (e) {}
  }, [currentGroupId]);

  // Real-time Cloud Sync for Subject Teachers and Schedule Overrides (via universal REST cloud)
  useEffect(() => {
    let isMounted = true;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveFailures = 0;
    let activeController: AbortController | null = null;

    const abortActiveRequest = () => {
      if (activeController) {
        activeController.abort();
        activeController = null;
      }
    };

    const getNextDelay = (failures: number): number => {
      // Exponential backoff: 15s -> 30s -> 60s max
      const base = Math.min(60000, 15000 * Math.pow(2, failures));
      // Jitter ±3 seconds (±3000ms)
      const jitter = (Math.random() * 6000) - 3000;
      return Math.max(5000, Math.min(60000, Math.round(base + jitter)));
    };

    const scheduleNextPoll = () => {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      if (!isMounted || document.hidden) return;

      const delay = getNextDelay(consecutiveFailures);
      pollTimer = setTimeout(async () => {
        if (!isMounted || document.hidden) return;
        await loadCloud(false);
      }, delay);
    };

    const loadCloud = async (force: boolean = false) => {
      if (!isMounted) return;
      abortActiveRequest();

      const controller = new AbortController();
      activeController = controller;

      try {
        const cloud = await fetchGroupCloudData(force, currentGroupId, controller.signal);
        if (controller.signal.aborted || !isMounted) return;

        const isNetworkFailure = !cloud || (cloud as any).lastUpdated === 0;
        if (isNetworkFailure) {
          consecutiveFailures++;
        } else {
          consecutiveFailures = 0;
          lastVisibilitySyncRef.current = Date.now();

          if ((cloud as any).schedule !== undefined) {
            SCHEDULE_REGISTRY[currentGroupId] = (cloud as any).schedule;
          }

          const lastLocalEdit = Number(localStorage.getItem(`last_local_edit_${currentGroupId}`) || 0);
          const isRecentLocalEdit = Date.now() - lastLocalEdit < 30000;
          const cloudTimestamp = (cloud as any).lastUpdated ? new Date((cloud as any).lastUpdated).getTime() : 0;
          const shouldSkipOverrides = isRecentLocalEdit && cloudTimestamp <= lastLocalEdit;

          if (cloud.scheduleOverrides !== undefined && !shouldSkipOverrides) {
            const cleanOv = sanitizeOverrides(cloud.scheduleOverrides);
            setScheduleOverrides(cleanOv);
            try {
              localStorage.setItem(`schedule_overrides_${currentGroupId}`, JSON.stringify(cleanOv));
            } catch (e) {}
          }
          if (cloud.subjectTeachers !== undefined && !shouldSkipOverrides) {
            const cleanSt = sanitizeTeachers(cloud.subjectTeachers, currentGroupId);
            setSubjectTeachers(cleanSt);
            try {
              localStorage.setItem(`subject_teachers_${currentGroupId}`, JSON.stringify(cleanSt));
            } catch (e) {}
          }

          if (cloud.students !== undefined && Array.isArray(cloud.students) && cloud.students.length > 0) {
            try {
              localStorage.setItem(`students_${currentGroupId}`, JSON.stringify(cloud.students));
            } catch (e) {}
          } else {
            try {
              const localRaw = localStorage.getItem(`students_${currentGroupId}`);
              if (localRaw) {
                const localParsed = JSON.parse(localRaw);
                if (Array.isArray(localParsed) && localParsed.length > 0) {
                  pushGroupCloudData({ students: localParsed }, currentGroupId).catch(console.warn);
                }
              }
            } catch (e) {}
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          consecutiveFailures++;
        }
      } finally {
        if (isMounted && !document.hidden) {
          scheduleNextPoll();
        }
      }
    };

    lastVisibilitySyncRef.current = Date.now();
    loadCloud(true);

    const handleVisibilityOrFocus = () => {
      if (document.hidden || document.visibilityState !== 'visible') {
        if (pollTimer) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
        return;
      }

      const now = Date.now();
      if (now - lastVisibilitySyncRef.current < 5000) {
        if (!pollTimer) {
          scheduleNextPoll();
        }
        return;
      }

      lastVisibilitySyncRef.current = now;
      loadCloud(true);
    };

    window.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      isMounted = false;
      abortActiveRequest();
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      window.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [currentGroupId]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setRefreshTrigger(prev => prev + 1);
    try {
      const cloud = await fetchGroupCloudData(true, currentGroupId);
      if (cloud) {
        if (cloud.scheduleOverrides !== undefined) {
          const cleanOv = sanitizeOverrides(cloud.scheduleOverrides);
          setScheduleOverrides(cleanOv);
          try {
            localStorage.setItem(`schedule_overrides_${currentGroupId}`, JSON.stringify(cleanOv));
          } catch (e) {}
        }
        if (cloud.subjectTeachers !== undefined) {
          const cleanSt = sanitizeTeachers(cloud.subjectTeachers, currentGroupId);
          setSubjectTeachers(cleanSt);
          try {
            localStorage.setItem(`subject_teachers_${currentGroupId}`, JSON.stringify(cleanSt));
          } catch (e) {}
        }
      }
      lastVisibilitySyncRef.current = Date.now();
    } catch (e) {}
    toast.success('Данные обновлены');
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleQuickPinLogin = async () => {
    const pin = quickPin.trim();
    if (!pin) return;

    try {
      const authRes = await verifyPinCode(pin);
      if (!authRes) {
        toast.error('Неверный PIN-код доступа');
        return;
      }

      if (authRes.role === 'admin') {
        setUserRole('admin');
        localStorage.setItem('user_role', 'admin');
        setStarostaGroupId(null);
        localStorage.removeItem('starosta_group_id');
        toast.success('Активирован режим ГЛАВНОГО АДМИНИСТРАТОРА (все группы)');
        setQuickPin('');
      } else if (authRes.role === 'starosta' && authRes.targetGroupId) {
        setUserRole('starosta');
        setStarostaGroupId(authRes.targetGroupId);
        localStorage.setItem('user_role', 'starosta');
        localStorage.setItem('starosta_group_id', authRes.targetGroupId);
        setCurrentGroupId(authRes.targetGroupId);
        localStorage.setItem('my_group_id', authRes.targetGroupId);
        setBoundGroupId(authRes.targetGroupId);
        toast.success(`Активирован режим СТАРОСТЫ (${authRes.groupName || authRes.targetGroupId})`);
        setQuickPin('');
      }
    } catch {
      toast.error('Ошибка проверки PIN-кода');
    }
  };

  const handleLogout = async () => {
    setUserRole('student');
    setUser(null);
    setStarostaGroupId(null);
    try {
      localStorage.removeItem('user_role');
      localStorage.setItem('user_role', 'student');
      localStorage.removeItem('auth_role');
      localStorage.removeItem('starosta_group_id');
      localStorage.removeItem('auth_group');
      sessionStorage.removeItem('admin_maintenance_bypass');
    } catch (e) {}
    setActiveTab('schedule');
    toast.success('Вы вышли из системы. Включен режим Студента (Гостя)');
  };

  const handleClearScheduleCache = async () => {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('sched_cache_v1:') || key.startsWith('sched_cache_') || key.startsWith('cached_schedule_') || key.startsWith('custom_schedule_'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));

      if (typeof window !== 'undefined' && 'caches' in window) {
        const cacheKeys = await window.caches.keys();
        await Promise.all(cacheKeys.map(k => window.caches.delete(k)));
      }

      toast.success('Кэш расписания очищен. Обновляю расписание из сети...');
      await reloadGroupSchedule(currentGroupId);
      setRefreshTrigger(prev => prev + 1);
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (e) {
      toast.error('Не удалось очистить кэш расписания');
    }
  };

  // Schedule Customization Handlers (Editing Teacher, Room, Notes, Attachments, Cancellations)
  const handleUpdateLesson = async (
    lessonId: string, 
    updatedLesson: Partial<Lesson>, 
    applyScope: TeacherAssignmentScope = 'type',
    lessonDayName?: string
  ) => {
    if (!canEdit) {
      toast.error('Только Староста своей группы или Администратор могут редактировать пары');
      return;
    }

    try {
      localStorage.setItem('last_local_edit_' + currentGroupId, String(Date.now()));
    } catch (e) {}

    const currentOverride = scheduleOverrides[lessonId] || {};
    const merged = {
      ...currentOverride,
      ...updatedLesson
    };

    // If note is emptied or whitespace, delete the note property so it does not persist
    if (updatedLesson.note !== undefined && updatedLesson.note.trim() === '') {
      delete merged.note;
    }

    // Cancellation is always date-specific and stored in attendanceRecords for the selected date (not global across all weeks)
    delete merged.isCancelled;

    const updated = {
      ...scheduleOverrides,
      [lessonId]: merged
    };

    // If this lesson has no customized properties left, remove it from overrides
    if (Object.keys(merged).length === 0) {
      delete updated[lessonId];
    }

    setScheduleOverrides(updated);
    try {
      localStorage.setItem(`schedule_overrides_${currentGroupId}`, JSON.stringify(updated));
    } catch (e) {}

    // Find the original lesson to know its type, default teacher, etc.
    let originalLesson: Lesson | undefined;
    const weeks = SCHEDULE_REGISTRY[currentGroupId] || {};
    for (const days of Object.values(weeks)) {
      for (const day of days) {
        const found = day.lessons.find(l => l.id === lessonId);
        if (found) {
          originalLesson = found;
          break;
        }
      }
      if (originalLesson) break;
    }

    const lessonType = originalLesson?.type || updatedLesson.type || 'Занятие';
    const originalTeacher = originalLesson?.teacher || '';
    const currentTeacher = currentOverride.teacher !== undefined 
      ? currentOverride.teacher 
      : (subjectTeachers[`${updatedLesson.subject}::${lessonType}`] || subjectTeachers[updatedLesson.subject || ''] || originalTeacher);

    const isTeacherChanged = updatedLesson.teacher !== undefined && updatedLesson.teacher.trim() !== currentTeacher.trim();
    const isNoteChanged = updatedLesson.note !== undefined && updatedLesson.note !== (currentOverride.note || '');
    const isLocationChanged = updatedLesson.location !== undefined && updatedLesson.location !== (currentOverride.location || originalLesson?.location || '');
    const isCancelledChanged = updatedLesson.isCancelled !== undefined;
    const isAttachmentsChanged = updatedLesson.attachments !== undefined;

    // Resolve accurate dayName and isoDate:
    let resolvedDayName = lessonDayName;
    if (!resolvedDayName) {
      const allDays = Object.values(SCHEDULE_REGISTRY[currentGroupId] || {}).flatMap(days => days);
      const targetDay = allDays.find(d => d.lessons.some(l => l.id === lessonId));
      resolvedDayName = targetDay?.dayName || 'Понедельник';
    }
    const isoDate = getDayISODate(resolvedDayName, selectedWeek);

    // ALWAYS synchronize attendance cancellation if updatedLesson.isCancelled was provided:
    if (isCancelledChanged) {
      const existingAtt = attendanceRecords.find(r => r.date === isoDate && r.lessonId === lessonId);
      markAttendance(
        isoDate, 
        lessonId, 
        existingAtt?.absentStudentIds || [], 
        existingAtt?.excusedStudentIds || [], 
        !!updatedLesson.isCancelled
      );
    }

    // Handle Teacher Assignment Scope (only if teacher actually changed!):
    if (isTeacherChanged && updatedLesson.subject && updatedLesson.teacher) {
      if (applyScope === 'type') {
        const key = `${updatedLesson.subject}::${lessonType}`;
        const updatedTeachers = {
          ...subjectTeachers,
          [key]: updatedLesson.teacher
        };
        setSubjectTeachers(updatedTeachers);
        try {
          localStorage.setItem(`subject_teachers_${currentGroupId}`, JSON.stringify(updatedTeachers));
        } catch (e) {}

        // Push to REST Cloud immediately (syncs to all classmates)
        pushGroupCloudData({ scheduleOverrides: updated, subjectTeachers: updatedTeachers }, currentGroupId);

        if (isNoteChanged) {
          toast.success('Преподаватель и заметка к паре сохранены');
        } else {
          toast.success(`Преподаватель «${updatedLesson.teacher}» назначен на все «${lessonType}»`);
        }
      } else if (applyScope === 'all') {
        const updatedTeachers = {
          ...subjectTeachers,
          [updatedLesson.subject]: updatedLesson.teacher
        };

        // Also update all types for this subject
        const weeks = SCHEDULE_REGISTRY[currentGroupId] || {};
        Object.values(weeks).forEach(days => {
          days.forEach(day => {
            day.lessons.forEach(l => {
              if (l.subject === updatedLesson.subject) {
                updatedTeachers[`${l.subject}::${l.type}`] = updatedLesson.teacher!;
              }
            });
          });
        });

        setSubjectTeachers(updatedTeachers);
        try {
          localStorage.setItem(`subject_teachers_${currentGroupId}`, JSON.stringify(updatedTeachers));
        } catch (e) {}

        // Push to REST Cloud immediately (syncs to all classmates)
        pushGroupCloudData({ scheduleOverrides: updated, subjectTeachers: updatedTeachers }, currentGroupId);

        if (isNoteChanged) {
          toast.success('Преподаватель (на все пары) и заметка сохранены');
        } else {
          toast.success(`Преподаватель «${updatedLesson.teacher}» назначен на ВСЕ виды занятий предмета`);
        }
      } else {
        // Push single pair override to cloud
        pushGroupCloudData({ scheduleOverrides: updated }, currentGroupId);
        toast.success(isNoteChanged ? 'Преподаватель и заметка к паре сохранены' : 'Преподаватель пары обновлен');
      }
    } else if (isCancelledChanged) {
      pushGroupCloudData({ scheduleOverrides: updated }, currentGroupId);
      if (updatedLesson.isCancelled) {
        toast.warning('Пара отменена на эту дату');
      } else {
        toast.success('Пара восстановлена в расписании');
      }
    } else if (isAttachmentsChanged) {
      pushGroupCloudData({ scheduleOverrides: updated }, currentGroupId);
      toast.success('Материалы к паре сохранены для группы');
    } else if (isNoteChanged) {
      // Only note was changed:
      pushGroupCloudData({ scheduleOverrides: updated }, currentGroupId);
      toast.success(updatedLesson.note ? 'Заметка к паре добавлена для всей группы!' : 'Заметка к паре удалена');
    } else if (isLocationChanged) {
      // Only location was changed:
      pushGroupCloudData({ scheduleOverrides: updated }, currentGroupId);
      toast.success('Аудитория пары обновлена для группы');
    } else {
      // Push single pair override to cloud
      pushGroupCloudData({ scheduleOverrides: updated }, currentGroupId);
      toast.success('Данные пары сохранены для группы');
    }
  };

  const handleSaveSubjectTeachers = async (updated: Record<string, string>) => {
    try {
      localStorage.setItem('last_local_edit_' + currentGroupId, String(Date.now()));
    } catch (e) {}
    setSubjectTeachers(updated);
    try {
      localStorage.setItem(`subject_teachers_${currentGroupId}`, JSON.stringify(updated));
    } catch (e) {}

    // Push to REST Cloud immediately
    pushGroupCloudData({ subjectTeachers: updated }, currentGroupId);

    toast.success('Список преподавателей сохранен для всех 4 недель расписания');
  };

  const handleResetLesson = async (lessonId: string) => {
    if (!canEdit) return;

    try {
      localStorage.setItem('last_local_edit_' + currentGroupId, String(Date.now()));
    } catch (e) {}

    // Find original lesson
    let originalLesson: Lesson | undefined;
    const weeks = SCHEDULE_REGISTRY[currentGroupId] || {};
    for (const days of Object.values(weeks)) {
      for (const day of days) {
        const found = day.lessons.find(l => l.id === lessonId);
        if (found) {
          originalLesson = found;
          break;
        }
      }
      if (originalLesson) break;
    }

    const updated = { ...scheduleOverrides };
    delete updated[lessonId];

    // If subjectTeachers has an override, explicitly restore original lesson teacher
    if (originalLesson) {
      const typeKey = `${originalLesson.subject}::${originalLesson.type}`;
      if (subjectTeachers[typeKey] || subjectTeachers[originalLesson.subject]) {
        updated[lessonId] = { teacher: originalLesson.teacher };
      }
    }

    setScheduleOverrides(updated);
    try {
      localStorage.setItem(`schedule_overrides_${currentGroupId}`, JSON.stringify(updated));
    } catch (e) {}

    // Also un-cancel in attendance if it was cancelled
    const allDays = Object.values(SCHEDULE_REGISTRY[currentGroupId] || {}).flatMap(days => days);
    const targetDay = allDays.find(d => d.lessons.some(l => l.id === lessonId));
    const dayName = targetDay?.dayName || 'Понедельник';
    const isoDate = getDayISODate(dayName, selectedWeek);
    const existingAtt = attendanceRecords.find(r => r.date === isoDate && r.lessonId === lessonId);
    if (existingAtt && existingAtt.isCancelled) {
      markAttendance(isoDate, lessonId, existingAtt.absentStudentIds, existingAtt.excusedStudentIds || [], false);
    }

    // Push reset to REST Cloud immediately
    pushGroupCloudData({ scheduleOverrides: updated }, currentGroupId);

    toast.info('Пара сброшена до исходного расписания');
  };

  // Merge default schedule with subject teachers, attendance cancellations, overrides & custom lessons
  const currentSchedule = useMemo(() => {
    const rawSchedule = SCHEDULE_REGISTRY[currentGroupId]?.[selectedWeek];
    if (!Array.isArray(rawSchedule)) return [];

    return rawSchedule.map(day => {
      if (!day || !day.dayName) return { dayName: 'Понедельник', lessons: [] };
      const isoDate = getDayISODate(day.dayName, selectedWeek);

      // 31 августа - лето, до начала семестра. Категорически 0 пар!
      if (isoDate === '2026-08-31') {
        return {
          dayName: day.dayName,
          lessons: []
        };
      }

      let sourceLessons = Array.isArray(day.lessons) ? day.lessons : [];
      // Для последующих циклов 1-й недели (28 сентября и далее) понедельник берется из числителя (Неделя 3) если пуст
      if (day.dayName === 'Понедельник' && sourceLessons.length === 0 && isoDate !== '2026-08-31') {
        const w3Mon = SCHEDULE_REGISTRY[currentGroupId]?.[3]?.find(d => d.dayName === 'Понедельник');
        if (w3Mon && Array.isArray(w3Mon.lessons) && w3Mon.lessons.length > 0) {
          sourceLessons = w3Mon.lessons;
        }
      }

      const standardLessons = sourceLessons.map(lesson => {
        if (!lesson || !lesson.id) return lesson;
        const override = scheduleOverrides[lesson.id] || {};
        const teacherByType = subjectTeachers[`${lesson.subject}::${lesson.type}`];
        const flatTeacher = subjectTeachers[lesson.subject];
        const resolvedTeacher = override.teacher !== undefined ? override.teacher : (teacherByType || flatTeacher || lesson.teacher || '');
        
        // Check if this lesson is marked as cancelled on this specific date in Attendance tracker
        const isCancelledInAttendance = attendanceRecords.some(
          r => r.date === isoDate && r.lessonId === lesson.id && r.isCancelled
        );

        return {
          ...lesson,
          ...override,
          teacher: resolvedTeacher,
          isCancelled: isCancelledInAttendance,
          isHidden: !!override.isHidden
        };
      }).filter(Boolean);

      // Include dynamically added custom lessons for empty days / weeks
      const customLessons: Lesson[] = Object.entries(scheduleOverrides)
        .filter(([id, rawOv]) => {
          const ov = rawOv as Partial<Lesson> & { dayName?: string };
          const isCustom = id.includes('_extra_') || id.includes('_custom_');
          const matchesDay = ov.dayName === day.dayName || id.startsWith(`${day.dayName.toLowerCase()}_w${selectedWeek}_`);
          const notAlreadyIncluded = !day.lessons.some(l => l.id === id);
          return isCustom && matchesDay && notAlreadyIncluded;
        })
        .map(([id, rawOv]) => {
          const ov = rawOv as Partial<Lesson>;
          return {
            id,
            timeStart: ov.timeStart || '08:00',
            timeEnd: ov.timeEnd || '09:35',
            subject: ov.subject || 'Новая пара',
            type: ov.type || 'Лекции',
            location: ov.location || '',
            teacher: ov.teacher || '',
            order: ov.order || (standardLessons.length + 1),
            ...ov
          } as Lesson;
        });

      const allLessons = [...standardLessons, ...customLessons].sort((a, b) => 
        (a.timeStart || '').localeCompare(b.timeStart || '')
      );

      return {
        ...day,
        lessons: allLessons
      };
    });
  }, [currentGroupId, selectedWeek, scheduleOverrides, attendanceRecords, subjectTeachers, refreshTrigger]);

  if (isMaintenanceMode && !isMaintenanceDismissed) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center text-white text-xs">Загрузка...</div>}>
        <MaintenanceScreen
          message={maintenanceMessage}
          estimatedEndTime={maintenanceUntil}
          onRetry={async () => {
            await checkMaintenanceStatus();
            if (!isMaintenanceMode) {
              toast.success('Сервер доступен! Расписание обновлено.');
            } else {
              toast.info('Технические работы еще продолжаются.');
            }
          }}
          onContinueOffline={() => {
            sessionStorage.setItem('dismiss_maintenance', 'true');
            setIsMaintenanceDismissed(true);
            toast.info('Включен автономный режим просмотра расписания');
          }}
          onAdminBypass={() => {
            sessionStorage.setItem('admin_maintenance_bypass', 'true');
            setIsMaintenanceDismissed(true);
          }}
        />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-clip bg-[#eaeff5] dark:bg-slate-950 text-slate-900 dark:text-white transition-colors duration-200 pb-28">
      <Toaster position="top-center" offset={75} richColors />

      {/* Header with Safe Area Inset */}
      <header className="sticky top-0 z-40 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-300/80 dark:border-slate-800 w-full pt-safe shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div 
                onClick={handleHeaderTitleTap}
                className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-white font-bold text-lg shadow-md shadow-indigo-200 dark:shadow-none cursor-pointer select-none active:scale-95 transition-transform"
                title="Расписание СамГТУ (5 быстрых тапов открывают диагностику)"
              >
                {currentGroupConfig.course}
              </div>
              <div 
                onClick={handleHeaderTitleTap}
                className="cursor-pointer select-none"
                title="5 быстрых тапов открывают консоль диагностики"
              >
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-bold text-slate-900 dark:text-white leading-tight">
                    Расписание {currentGroupConfig.name}
                  </h1>
                  {effectiveRole !== 'student' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLogout();
                      }}
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-900 dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-800/40 transition-colors"
                      title="Нажмите, чтобы выйти в гостевой режим"
                    >
                      {effectiveRole === 'admin' ? 'Админ (выйти)' : 'Староста (выйти)'}
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-400 font-medium">
                  {currentFaculty.shortName} • СамГТУ
                </p>
              </div>
            </div>

            {/* Desktop Navigation Tabs (Senior Review P0) */}
            <nav className="hidden sm:flex items-center gap-1 bg-slate-100/90 border border-slate-200/60 dark:border-transparent dark:bg-slate-800/80 p-1 rounded-2xl">
              <button
                onClick={() => setActiveTab('schedule')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'schedule'
                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" /> Расписание
              </button>
              <button
                onClick={() => setActiveTab('homework')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'homework'
                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" /> ДЗ
              </button>
              {(effectiveRole === 'admin' || effectiveRole === 'starosta') && (
                <button
                  onClick={() => setActiveTab('attendance')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                    activeTab === 'attendance'
                      ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <ClipboardCheck className="w-3.5 h-3.5" /> Посещение
                </button>
              )}
              {(effectiveRole === 'admin' || effectiveRole === 'starosta') && (
                <button
                  onClick={() => setActiveTab('group')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                    activeTab === 'group'
                      ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" /> Группа
                </button>
              )}
              {effectiveRole === 'admin' && (
                <button
                  onClick={() => setActiveTab('admin')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                    activeTab === 'admin'
                      ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <Shield className="w-3.5 h-3.5" /> Админ
                </button>
              )}
              <button
                onClick={() => setActiveTab('profile')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'profile'
                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <UserIcon className="w-3.5 h-3.5" /> Профиль
              </button>
            </nav>

            <div className="flex items-center gap-2">
              <button
                onClick={handleOpenMyAbsences}
                className="p-2 rounded-xl text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors"
                title="Мои пропуски"
                aria-label="Мои пропуски"
              >
                <GraduationCap className="w-4 h-4" />
              </button>

              <button
                onClick={() => setIsBugReportModalOpen(true)}
                className="p-2 rounded-xl text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                title="Сообщить об ошибке / Баг-репорт"
              >
                <Bug className="w-4 h-4" />
              </button>

              <button
                onClick={handleRefresh}
                className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="Обновить данные"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-indigo-600' : ''}`} />
              </button>

              <button
                onClick={() => {
                  const nextPref: ThemePref = darkMode ? 'light' : 'dark';
                  setPref(nextPref);
                  setThemePref(nextPref);
                }}
                className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="Переключить тему"
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Group and Week Controls */}
          <div className="mt-3 space-y-2 pt-2 border-t border-slate-200/70 dark:border-slate-800/80">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setSelectedFacultyFilter(currentGroupConfig.facultyId === 'faid' ? 'asa' : currentGroupConfig.facultyId);
                    setSelectedCourseFilter(currentGroupConfig.course || 0);
                    setIsGroupSelectionModalOpen(true);
                  }}
                  className="text-xs font-bold text-slate-900 dark:text-slate-100 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700/80 border border-slate-200/90 dark:border-slate-700/80 rounded-xl px-2.5 py-1.5 min-h-[36px] flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                  title="Выбрать факультет, курс и группу"
                >
                  {effectiveRole === 'starosta' && <Shield className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />}
                  <span>{currentGroupConfig.name}</span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">({currentGroupConfig.course} курс)</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </button>
              </div>
              
              <div className="flex items-center gap-2">
                {canEdit && activeTab === 'schedule' && (
                  <button
                    onClick={() => setIsSubjectTeachersModalOpen(true)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold rounded-xl transition-all border border-indigo-200/50 dark:border-transparent"
                  >
                    <UserCheck className="w-3.5 h-3.5" /> Преподаватели
                  </button>
                )}
                
                <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${
                  effectiveRole === 'admin' 
                    ? 'bg-purple-50 text-purple-700 border-purple-200/70 dark:bg-purple-900/30 dark:text-purple-300 dark:border-transparent' 
                    : effectiveRole === 'starosta' 
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-200/70 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-transparent' 
                      : 'bg-slate-100 text-slate-700 border-slate-200/70 dark:bg-slate-800 dark:text-slate-400 dark:border-transparent'
                }`}>
                  {effectiveRole === 'admin' ? 'admin' : (userRole === 'starosta' ? (effectiveRole === 'starosta' ? 'starosta' : 'гость (студент)') : 'student')}
                </span>
              </div>
            </div>

            {/* 4-Week Cycle Switcher - Grid of 4 equal buttons (Zero overflow!) */}
            {activeTab === 'schedule' && (
              <div className="space-y-1.5 w-full">
                <div className="grid grid-cols-4 gap-1.5 bg-slate-200/60 dark:bg-slate-800/90 border border-slate-200/60 dark:border-transparent p-1 rounded-2xl w-full">
                  {[1, 2, 3, 4].map(w => (
                    <button
                      key={w}
                      onClick={() => setSelectedWeek(w)}
                      className={`py-1.5 text-center rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        selectedWeek === w
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      Нед. {w} {w === currentWeek && '★'}
                    </button>
                  ))}
                </div>
                <div className="text-center text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Даты недели: <span className="text-indigo-600 dark:text-indigo-400 font-bold">{getWeekDateRange(selectedWeek, samaraNow)}</span>
                  {selectedWeek === currentWeek && <span className="text-amber-600 dark:text-amber-400 font-semibold ml-1.5">(Текущая)</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 py-6 w-full max-w-full pb-28 sm:pb-24">
        {activeTab === 'schedule' && (
          <TabErrorBoundary tabName="Расписание">
            {isScheduleLoading ? (
              <ScheduleState
                status="loading"
                groupName={currentGroupConfig.name}
              />
            ) : scheduleLoadError && (currentSchedule.length === 0 || !currentSchedule.some(d => d.lessons && d.lessons.length > 0)) ? (
              <ScheduleState
                status="error"
                groupName={currentGroupConfig.name}
                errorReason={scheduleLoadError}
                onRetry={handleRetryScheduleLoad}
              />
            ) : currentSchedule.length === 0 ? (
              <ScheduleState
                status="empty"
                groupName={currentGroupConfig.name}
                onRetry={handleRetryScheduleLoad}
              />
            ) : (
              <SwipeableDays 
                key={`${currentGroupId}-w${selectedWeek}`}
                days={currentSchedule} 
                weekNumber={selectedWeek}
                userRole={effectiveRole}
                onUpdateLesson={handleUpdateLesson}
                onResetLesson={handleResetLesson}
              />
            )}
          </TabErrorBoundary>
        )}

        {activeTab === 'homework' && (
          <TabErrorBoundary tabName="Домашние задания">
            <Suspense fallback={<TabFallback />}>
              <HomeworkTracker
                currentGroupId={currentGroupId}
                userRole={effectiveRole}
                refreshTrigger={refreshTrigger}
              />
            </Suspense>
          </TabErrorBoundary>
        )}

        {activeTab === 'attendance' && (
          <TabErrorBoundary tabName="Посещаемость">
            <Suspense fallback={<TabFallback />}>
              {canEdit ? (
                <AttendanceTracker
                  isAuthenticated={canEdit}
                  userRole={effectiveRole}
                  userEmail={user?.email || null}
                  currentGroupId={currentGroupId}
                  refreshTrigger={refreshTrigger}
                />
              ) : (
                <div className="max-w-md mx-auto p-6 sm:p-8 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 text-center space-y-4 shadow-xs my-8">
                  <div className="w-12 h-12 mx-auto bg-amber-50 dark:bg-amber-900/30 rounded-2xl flex items-center justify-center text-amber-600 dark:text-amber-400">
                    <Key className="w-6 h-6" />
                  </div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Доступ только для старосты
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Журнал посещаемости и ведомости деканата защищены по стандарту 152-ФЗ. Для доступа введите PIN-код старосты в разделе «Вход».
                  </p>
                  <button
                    onClick={() => setActiveTab('profile')}
                    className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition-colors"
                  >
                    Перейти ко входу
                  </button>
                </div>
              )}
            </Suspense>
          </TabErrorBoundary>
        )}

        {activeTab === 'group' && (
          <TabErrorBoundary tabName="Управление группой">
            <Suspense fallback={<TabFallback />}>
              <GroupManager
                currentGroupId={currentGroupId}
                userRole={effectiveRole}
              />
            </Suspense>
          </TabErrorBoundary>
        )}

        {activeTab === 'admin' && (
          <TabErrorBoundary tabName="Панель администратора">
            <Suspense fallback={<TabFallback />}>
              <AdminPanel
                currentRole={effectiveRole}
                currentGroupId={currentGroupId}
                onRoleChange={(role, targetGroup) => {
                  setUserRole(role);
                  if (role === 'starosta' && targetGroup) {
                    setStarostaGroupId(targetGroup);
                    try { localStorage.setItem('starosta_group_id', targetGroup); } catch (e) {}
                  } else if (role !== 'starosta') {
                    setStarostaGroupId(null);
                    try { localStorage.removeItem('starosta_group_id'); } catch (e) {}
                  }
                  if (targetGroup) {
                    setCurrentGroupId(targetGroup);
                    try { localStorage.setItem('my_group_id', targetGroup); } catch (e) {}
                    setBoundGroupId(targetGroup);
                  }
                }}
                userEmail={user?.email || null}
                onScheduleUpdated={() => {
                  reloadGroupSchedule(currentGroupId).then(() => {
                    setRefreshTrigger(prev => prev + 1);
                  });
                }}
              />
            </Suspense>
          </TabErrorBoundary>
        )}

        {activeTab === 'profile' && (
          <TabErrorBoundary tabName="Профиль">
            <div className="max-w-md mx-auto bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-xs border border-slate-200/90 dark:border-slate-800 space-y-6">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 mx-auto bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <UserIcon className="w-8 h-8" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {user ? user.displayName || user.email : (effectiveRole === 'starosta' ? `Староста ${currentGroupConfig.name}` : (effectiveRole === 'admin' ? 'Администратор' : `Студент ${currentGroupConfig.name}`))}
              </h2>
              {effectiveRole !== 'student' && (
                <div className="flex items-center justify-between p-3.5 bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-900/40 rounded-2xl text-left">
                  <div className="flex items-start gap-2.5">
                    <Shield className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                    <div>
                      <span className="text-xs font-bold text-amber-900 dark:text-amber-200">
                        {effectiveRole === 'admin' ? 'Режим: Главный администратор' : `Режим: Староста группы ${currentGroupConfig.name}`}
                      </span>
                      <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-snug mt-0.5">
                        Вам доступны журнал посещаемости, ведомости деканата и редактирование данных группы.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shrink-0 transition-colors shadow-xs ml-2"
                  >
                    Выйти
                  </button>
                </div>
              )}
            </div>

            {/* Academic Group Binding */}
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/50 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                  <GraduationCap className="w-4 h-4 text-indigo-500" />
                  <span>Ваша учебная группа</span>
                </div>
                <span className="text-xs font-extrabold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-2.5 py-0.5 rounded-lg">
                  {currentGroupConfig.name}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Расписание, посещаемость и домашние задания привязаны к этой группе.
              </p>
              <button
                onClick={() => setIsGroupSelectionModalOpen(true)}
                className="w-full py-2.5 px-4 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-bold text-xs rounded-xl transition-all shadow-sm min-h-[44px] flex items-center justify-center gap-2"
              >
                <Users className="w-3.5 h-3.5 text-indigo-500" />
                Сменить учебную группу
              </button>
            </div>

            {/* Schedule Cache Clearance Card */}
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/50 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                  <Database className="w-4 h-4 text-amber-500" />
                  <span>Кэш расписания</span>
                </div>
                <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-md border border-amber-200/60 dark:border-amber-900/40">
                  Офлайн-хранилище
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Очищает сохраненные копии расписания групп и запрашивает свежие данные из сети. Ваши личные заметки, пароли и посещаемость не будут затронуты.
              </p>
              <button
                onClick={handleClearScheduleCache}
                className="w-full py-2.5 px-4 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-bold text-xs rounded-xl transition-all shadow-sm min-h-[44px] flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-3.5 h-3.5 text-amber-500" />
                Очистить кэш расписания и обновить
              </button>
            </div>

            {/* Bug Report & Support Card */}
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/50 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                  <Bug className="w-4 h-4 text-red-500" />
                  <span>Поддержка и баг-репорт</span>
                </div>
                <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded-md">
                  СамГТУ
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Заметили неточность в расписании или ошибку в работе приложения? Отправьте отчет со скриншотом.
              </p>
              <button
                onClick={() => setIsBugReportModalOpen(true)}
                className="w-full py-2.5 px-4 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 font-bold text-xs rounded-xl border border-red-200 dark:border-red-900/40 transition-all flex items-center justify-center gap-1.5 min-h-[44px]"
              >
                <Bug className="w-3.5 h-3.5" />
                Сообщить об ошибке разработчику
              </button>
            </div>

            {/* Student Attendance & My Absences */}
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/50 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                <UserCheck className="w-4 h-4 text-indigo-500" />
                <span>Посещаемость и мои пропуски</span>
              </div>
              <p className="text-[11px] text-slate-400">
                {getLocalStudentLink()
                  ? `Учет подключен для группы ${getLocalStudentLink()?.gid.toUpperCase()}. Ваши имя и фамилия на сервер не передаются.`
                  : 'Подключите личный просмотр пропущенных пар по коду от старосты группы.'}
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleOpenMyAbsences}
                  className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-all shadow-sm min-h-[44px] flex items-center justify-center gap-2"
                >
                  <GraduationCap className="w-4 h-4" />
                  {getLocalStudentLink() ? 'Открыть мои пропуски' : 'Подключить учет пропусков по коду'}
                </button>
              </div>
            </div>

            {/* Privacy Policy Card */}
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/50 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                <Shield className="w-4 h-4 text-indigo-500" />
                <span>Конфиденциальность</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Как защищены ваши данные, почему сервер не знает фамилий и как удалить свои сведения в один клик.
              </p>
              <button
                onClick={() => setIsPrivacyModalOpen(true)}
                className="w-full py-2.5 px-4 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-bold text-xs rounded-xl transition-all shadow-sm min-h-[44px] flex items-center justify-center gap-2"
              >
                <Shield className="w-3.5 h-3.5 text-indigo-500" />
                Политика конфиденциальности
              </button>
            </div>

            {/* Diagnostics & In-App Console Card - Only visible to Admin */}
            {effectiveRole === 'admin' && (
              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                    <Terminal className="w-4 h-4 text-emerald-500" />
                    <span>Логи и диагностика</span>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-md">
                    Консоль
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Мобильная консоль разработчика для просмотра логов, ошибок и состояния приложения на смартфоне.
                </p>
                <button
                  onClick={() => {
                    logger.action('UI', 'Debug console opened from Profile tab');
                    setIsDebugLogsModalOpen(true);
                  }}
                  className="w-full py-2.5 px-4 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-bold text-xs rounded-xl transition-all shadow-sm min-h-[44px] flex items-center justify-center gap-2"
                >
                  <Terminal className="w-3.5 h-3.5 text-emerald-500" />
                  Логи и диагностика
                </button>
              </div>
            )}

            {/* Starosta Group Code Login */}
            {userRole === 'student' && (
              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                    <Key className="w-4 h-4 text-indigo-500" />
                    <span>Вход для старосты и администратора</span>
                  </div>
                  <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded-md">
                    Доступ
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Введите секретный код группы или код администратора для подтверждения прав.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={groupCodeInput}
                    onChange={(e) => setGroupCodeInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && handleClaimGroupCode()}
                    placeholder="XXXX-XXXX-XXXX-XXXX"
                    className="flex-1 px-3 py-2.5 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white uppercase tracking-wider focus:outline-none min-h-[44px]"
                  />
                  <button
                    onClick={handleClaimGroupCode}
                    disabled={isClaimingStaff}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl transition-all shadow-sm shrink-0 min-h-[44px]"
                  >
                    {isClaimingStaff ? 'Проверка...' : 'Войти'}
                  </button>
                </div>
              </div>
            )}

            {effectiveRole !== 'student' && (
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 py-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 font-semibold rounded-2xl hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors text-sm min-h-[44px]"
              >
                <LogOut className="w-4 h-4" /> Выйти в режим Студента
              </button>
            )}
            </div>
          </TabErrorBoundary>
        )}
      </main>

      {/* Bottom Navigation */}
      <BottomNav
        currentTab={activeTab}
        onTabChange={setActiveTab}
        userRole={effectiveRole}
        isLoggedIn={canEdit || !!user}
      />

      {/* Global Subject Teachers Modal */}
      {isSubjectTeachersModalOpen && (
        <Suspense fallback={null}>
          <SubjectTeachersModal
            isOpen={isSubjectTeachersModalOpen}
            onClose={() => setIsSubjectTeachersModalOpen(false)}
            currentGroupId={currentGroupId}
            subjectTeachers={subjectTeachers}
            onSave={handleSaveSubjectTeachers}
          />
        </Suspense>
      )}

      {/* Group Selection Modal (Faculty / Course / Group Hierarchy) */}
      {isGroupSelectionModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl max-w-lg w-full max-h-[92dvh] sm:max-h-[85vh] flex flex-col shadow-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-200/80 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
                  <GraduationCap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    Выбор учебной группы
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Факультет • Курс • Номер группы СамГТУ
                  </p>
                </div>
              </div>
              {boundGroupId && (
                <button
                  onClick={() => setIsGroupSelectionModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Search and Filters */}
            <div className="p-4 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 shrink-0 space-y-3">
              {/* Quick Search & LK Import Button */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={groupSearchQuery}
                    onChange={(e) => setGroupSearchQuery(e.target.value)}
                    placeholder="Поиск по номеру (например, 110, ИАИТ, 101)..."
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* 1. Faculty filter chips */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Факультет / Институт</span>
                  {selectedFacultyFilter !== 'all' && (
                    <button
                      onClick={() => setSelectedFacultyFilter('all')}
                      className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Сбросить
                    </button>
                  )}
                </div>
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                  <button
                    onClick={() => setSelectedFacultyFilter('all')}
                    className={`px-2.5 py-1 text-xs font-bold rounded-xl whitespace-nowrap transition-all ${
                      selectedFacultyFilter === 'all'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    Все ({FACULTIES.filter(f => f.id !== 'faid').length})
                  </button>
                  {FACULTIES.filter(f => f.id !== 'faid').map(fac => (
                    <button
                      key={fac.id}
                      onClick={() => setSelectedFacultyFilter(fac.id)}
                      className={`px-2.5 py-1 text-xs font-bold rounded-xl whitespace-nowrap transition-all ${
                        selectedFacultyFilter === fac.id
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                      }`}
                      title={fac.name}
                    >
                      {fac.shortName}
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. Course filter chips */}
              <div>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Курс</span>
                <div className="flex gap-1.5">
                  {[
                    { label: 'Все', value: 0 },
                    { label: '1 курс', value: 1 },
                    { label: '2 курс', value: 2 },
                    { label: '3 курс', value: 3 },
                    { label: '4 курс', value: 4 },
                    { label: '5 курс', value: 5 }
                  ].map(c => (
                    <button
                      key={c.value}
                      onClick={() => setSelectedCourseFilter(c.value)}
                      className={`flex-1 py-1 text-xs font-bold rounded-xl text-center transition-all ${
                        selectedCourseFilter === c.value
                          ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 3. Group List Body */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-2">
              {filteredGroups.length > 0 ? (
                filteredGroups.map(grp => {
                  const isSelected = currentGroupId === grp.id;
                  const faculty = FACULTIES.find(f => f.id === grp.facultyId);
                  return (
                    <button
                      key={grp.id}
                      onClick={() => handleSelectGroup(grp.id)}
                      className={`w-full p-3.5 rounded-2xl border text-left flex items-center justify-between transition-all ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-900/20 text-indigo-900 dark:text-indigo-100 shadow-sm'
                          : 'border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-bold flex items-center gap-2">
                          <span>{grp.name}</span>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                            {grp.course} курс
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {faculty?.name || faculty?.shortName || grp.facultyId.toUpperCase()}
                        </div>
                      </div>
                      {isSelected && (
                        <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })
              ) : (
                <div className="text-center py-8 space-y-2">
                  <p className="text-xs text-slate-400">
                    Группы по выбранным фильтрам не найдены.
                  </p>
                  <button
                    onClick={() => setIsAddingCustomGroup(true)}
                    className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    Добавить свою группу вручную
                  </button>
                </div>
              )}
            </div>

            {/* Footer with Custom Group Adder */}
            <div className="p-4 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 shrink-0 space-y-3 pb-safe">
              {!isAddingCustomGroup ? (
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setIsAddingCustomGroup(true)}
                    className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Добавить номер другой группы СамГТУ</span>
                  </button>
                  {boundGroupId && (
                    <button
                      type="button"
                      onClick={() => setIsGroupSelectionModalOpen(false)}
                      className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors"
                    >
                      Закрыть
                    </button>
                  )}
                </div>
              ) : (
                <form onSubmit={handleCreateCustomGroup} className="space-y-3 bg-white dark:bg-slate-800 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">Добавление новой группы</span>
                    <button
                      type="button"
                      onClick={() => setIsAddingCustomGroup(false)}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="sm:col-span-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Факультет</label>
                      <select
                        value={newGroupFaculty}
                        onChange={(e) => setNewGroupFaculty(e.target.value)}
                        className="w-full text-xs font-medium px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none"
                      >
                        {FACULTIES.filter(f => f.id !== 'faid').map(fac => (
                          <option key={fac.id} value={fac.id}>
                            {fac.shortName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Курс</label>
                      <select
                        value={newGroupCourse}
                        onChange={(e) => setNewGroupCourse(parseInt(e.target.value, 10))}
                        className="w-full text-xs font-medium px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none"
                      >
                        {[1, 2, 3, 4, 5].map(c => (
                          <option key={c} value={c}>{c} курс</option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Номер группы</label>
                      <input
                        type="text"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        placeholder="2-ИАИТ-108"
                        className="w-full text-xs px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsAddingCustomGroup(false)}
                      className="px-3 py-1.5 text-xs text-slate-500 font-semibold hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl"
                    >
                      Отмена
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-sm"
                    >
                      Сохранить и выбрать
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bug Report Modal */}
      {isBugReportModalOpen && (
        <Suspense fallback={null}>
          <BugReportModal
            isOpen={isBugReportModalOpen}
            onClose={() => setIsBugReportModalOpen(false)}
            currentGroupId={currentGroupId}
            currentGroupName={currentGroupConfig.name}
            currentCourse={currentGroupConfig.course}
            userRole={effectiveRole}
          />
        </Suspense>
      )}

      {/* In-App Mobile Diagnostics Console Modal */}
      {isDebugLogsModalOpen && (
        <Suspense fallback={null}>
          <DebugLogsModal
            isOpen={isDebugLogsModalOpen}
            onClose={() => setIsDebugLogsModalOpen(false)}
          />
        </Suspense>
      )}

      {/* Student Consent Modal */}
      {isConsentModalOpen && (
        <Suspense fallback={null}>
          <ConsentModal
            isOpen={isConsentModalOpen}
            onClose={() => setIsConsentModalOpen(false)}
            onConsent={handleConsentGiven}
          />
        </Suspense>
      )}

      {/* Student Invite Code Link Modal */}
      {isStudentLinkModalOpen && (
        <Suspense fallback={null}>
          <StudentLinkModal
            isOpen={isStudentLinkModalOpen}
            onClose={() => setIsStudentLinkModalOpen(false)}
            onSuccess={handleLinkSuccess}
          />
        </Suspense>
      )}

      {/* Student My Absences Modal */}
      {isMyAbsencesModalOpen && (
        <Suspense fallback={null}>
          <MyAbsencesModal
            isOpen={isMyAbsencesModalOpen}
            onClose={() => setIsMyAbsencesModalOpen(false)}
            onUnlinked={() => setIsMyAbsencesModalOpen(false)}
          />
        </Suspense>
      )}

      {/* Privacy Policy Modal */}
      {isPrivacyModalOpen && (
        <Suspense fallback={null}>
          <PrivacyPolicyModal
            isOpen={isPrivacyModalOpen}
            onClose={() => setIsPrivacyModalOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
};

export default App;
