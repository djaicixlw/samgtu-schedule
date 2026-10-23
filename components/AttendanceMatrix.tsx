import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, ChevronDown, Copy, Download, Filter, HelpCircle, Layers, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  useAttendance,
  BLOCKS,
  getDayName,
  TIME_SLOTS,
  getSemesterWeek,
  getDayISODate,
  getDayCalendarDate,
  getWeekDateRange,
  STUDENTS_REGISTRY
} from '../attendance';
import { SCHEDULE_REGISTRY, AVAILABLE_GROUPS } from '../constants';
import { Lesson, Student, WeekData } from '../types';
import { getLocalStudents } from '../utils/attendanceStorage';
import { loadGroupSchedule, isPhysicalEducationLesson, isPhysicalEducationLessonId } from '../utils/scheduleLoader';

export interface AttendanceMatrixProps {
  currentGroupId: string;
  userRole?: string;
  refreshTrigger?: number;
}

const DAYS_OF_WEEK = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'] as const;

const DAY_SHORT: Record<string, string> = {
  'Понедельник': 'Пн',
  'Вторник': 'Вт',
  'Среда': 'Ср',
  'Четверг': 'Чт',
  'Пятница': 'Пт',
  'Суббота': 'Сб',
};

const PAIRS = [1, 2, 3, 4, 5, 6] as const;

/**
 * Determines pair slot number (1..6) for a lesson.
 */
function getLessonSlotNumber(lesson: Lesson): number {
  if (lesson.order && lesson.order >= 1 && lesson.order <= 6) {
    return lesson.order;
  }
  for (const [key, slot] of Object.entries(TIME_SLOTS)) {
    if (lesson.timeStart === slot.timeStart) {
      return Number(key);
    }
  }
  const match = lesson.id.match(/-(\d+)$/);
  if (match) {
    const num = Number(match[1]);
    if (num >= 1 && num <= 6) return num;
  }
  return 1;
}

const SEMESTER_MONTHS = [
  { id: '2026-09', name: 'Сентябрь', refDate: '2026-09-15' },
  { id: '2026-10', name: 'Октябрь', refDate: '2026-10-15' },
  { id: '2026-11', name: 'Ноябрь', refDate: '2026-11-15' },
  { id: '2026-12', name: 'Декабрь', refDate: '2026-12-15' },
  { id: '2027-01', name: 'Январь', refDate: '2027-01-15' }
] as const;

export const AttendanceMatrix: React.FC<AttendanceMatrixProps> = ({
  currentGroupId,
  userRole = 'student',
  refreshTrigger = 0
}) => {
  const normalizedRole = (userRole || '').toLowerCase();
  const canEdit = normalizedRole === 'admin' || normalizedRole === 'starosta';

  // Navigation mode: Weekly Grid or Semester Summary
  const [mode, setMode] = useState<'week' | 'semester'>('week');

  // Semester view submode: Cumulative blocks or Subject breakdown
  const [summaryView, setSummaryView] = useState<'cumulative' | 'subjects'>('cumulative');

  // Week selection (1..4)
  const currentWeekNumber = useMemo(() => {
    try {
      return getSemesterWeek(new Date(), currentGroupId) || 1;
    } catch {
      return 1;
    }
  }, [currentGroupId]);

  const [selectedWeek, setSelectedWeek] = useState<number>(currentWeekNumber);
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const y = now.getFullYear();
    const currentKey = `${y}-${m}`;
    const found = SEMESTER_MONTHS.find(sm => sm.id === currentKey);
    return found ? found.id : '2026-10';
  });

  const activeReferenceDate = useMemo(() => {
    const m = SEMESTER_MONTHS.find(sm => sm.id === selectedMonth);
    return m ? m.refDate : undefined;
  }, [selectedMonth]);

  const [selectedSubject, setSelectedSubject] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Attendance hook
  const { records, markAttendance, getAttendance } = useAttendance(true, currentGroupId, refreshTrigger);

  const getCleanStudents = (gid: string): Student[] => {
    const local = getLocalStudents(gid);
    if (local.length > 0) return local;
    const fallback = STUDENTS_REGISTRY[gid] || [];
    if (fallback.length > 0 && fallback.every(s => /^Студент\s+\d+$/i.test(s.name.trim()))) {
      return [];
    }
    return fallback;
  };

  // Load and refresh student roster
  const [students, setStudents] = useState<Student[]>(() => getCleanStudents(currentGroupId));

  useEffect(() => {
    setStudents(getCleanStudents(currentGroupId));
  }, [currentGroupId, refreshTrigger]);

  // Load and cache schedule data for group
  const [scheduleData, setScheduleData] = useState<WeekData>(() => SCHEDULE_REGISTRY[currentGroupId] || {});

  useEffect(() => {
    if (!currentGroupId) return;
    if (SCHEDULE_REGISTRY[currentGroupId] && Object.keys(SCHEDULE_REGISTRY[currentGroupId]).length > 0) {
      setScheduleData(SCHEDULE_REGISTRY[currentGroupId]);
    }
    loadGroupSchedule(currentGroupId)
      .then(res => {
        if (res.ok && res.data) {
          setScheduleData(res.data);
        }
      })
      .catch(() => {});
  }, [currentGroupId]);

  // Map lessonId to Lesson object across all weeks
  const { lessonMap, groupSubjects } = useMemo(() => {
    const map = new Map<string, Lesson>();
    const subjects = new Set<string>();

    const activeSchedule = (scheduleData && Object.keys(scheduleData).length > 0)
      ? scheduleData
      : (SCHEDULE_REGISTRY[currentGroupId] || {});

    for (let w = 1; w <= 4; w++) {
      const days = activeSchedule[w] || [];
      for (const d of days) {
        for (const l of d.lessons) {
          if (l.id) {
            map.set(l.id, l);
          }
          if (l.subject && l.subject.trim() && !isPhysicalEducationLesson(l)) {
            subjects.add(l.subject.trim());
          }
        }
      }
    }

    return {
      lessonMap: map,
      groupSubjects: Array.from(subjects).sort((a, b) => a.localeCompare(b, 'ru'))
    };
  }, [scheduleData, currentGroupId]);

  const activeStudents = useMemo(() => {
    return students
      .filter(s => !s.isArchived)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [students]);

  // Filter students by search query
  const filteredStudents = useMemo(() => {
    if (!searchQuery.trim()) return activeStudents;
    const query = searchQuery.trim().toLowerCase();
    return activeStudents.filter(s => s.name.toLowerCase().includes(query));
  }, [activeStudents, searchQuery]);

  // Handle cell click in week grid to cycle status: Present -> Absent -> Excused -> Present
  const handleCellToggle = (studentId: number, dayISO: string, lesson: Lesson) => {
    if (!canEdit) return;
    const record = getAttendance(dayISO, lesson.id);
    if (record.isCancelled) {
      toast.info('Пара отменена — отметки не ставятся');
      return;
    }

    const isExcused = (record.excusedStudentIds || []).includes(studentId);
    const isAbsent = !isExcused && record.absentStudentIds.includes(studentId);

    let nextAbsent = record.absentStudentIds.filter(id => id !== studentId);
    let nextExcused = (record.excusedStudentIds || []).filter(id => id !== studentId);

    const studentName = students.find(s => s.id === studentId)?.name || 'Студент';
    let statusLabel = 'Присутствует';

    if (!isAbsent && !isExcused) {
      // Present -> Absent (Н)
      nextAbsent.push(studentId);
      statusLabel = 'Н (пропуск)';
    } else if (isAbsent) {
      // Absent -> Excused (УП)
      nextExcused.push(studentId);
      statusLabel = 'УП (уважительная)';
    } else {
      // Excused -> Present
      statusLabel = 'Присутствует';
    }

    markAttendance(dayISO, lesson.id, nextAbsent, nextExcused, false, lesson.hours || record.hours || 2);
    toast.success(`${studentName}: ${statusLabel}`, { duration: 1500 });
  };

  // Pre-calculate cumulative hours for each student across blocks and subjects
  const studentCumulativeStats = useMemo(() => {
    return activeStudents.map(student => {
      // 4 blocks: [Block1, Block2, Block3, Block4]
      const blockAbs = [0, 0, 0, 0];
      const blockExc = [0, 0, 0, 0];
      const subjectHours: Record<string, { abs: number; exc: number; total: number }> = {};

      records.forEach(rec => {
        if (rec.isCancelled) return;
        const lesson = lessonMap.get(rec.lessonId);
        if (lesson && isPhysicalEducationLesson(lesson)) return;
        if (!lesson && isPhysicalEducationLessonId(rec.lessonId, currentGroupId)) return;

        const isExcused = (rec.excusedStudentIds || []).includes(student.id);
        const isAbsent = !isExcused && rec.absentStudentIds.includes(student.id);
        if (!isAbsent && !isExcused) return;

        const subjName = lesson?.subject?.trim() || 'Другое';
        const hours = lesson?.hours || rec.hours || 2;

        // Track per-subject hours
        if (!subjectHours[subjName]) {
          subjectHours[subjName] = { abs: 0, exc: 0, total: 0 };
        }
        if (isExcused) {
          subjectHours[subjName].exc += hours;
          subjectHours[subjName].total += hours;
        } else {
          subjectHours[subjName].abs += hours;
          subjectHours[subjName].total += hours;
        }

        // Apply subject filter if active
        if (selectedSubject !== 'all' && subjName !== selectedSubject) {
          return;
        }

        // Map date to block
        BLOCKS.forEach((b, idx) => {
          if (rec.date >= b.start && rec.date <= b.end) {
            if (isExcused) {
              blockExc[idx] += hours;
            } else {
              blockAbs[idx] += hours;
            }
          }
        });
      });

      // Cumulative calculations:
      // Block 1: Period 1 sum
      const b1Total = blockAbs[0] + blockExc[0];
      // Block 2: Cumulative Block 1 + Block 2 (for dean's office submission)
      const b2Period = blockAbs[1] + blockExc[1];
      const b2Cumulative = b1Total + b2Period;
      // Block 3: Cumulative B1 + B2 + B3
      const b3Period = blockAbs[2] + blockExc[2];
      const b3Cumulative = b2Cumulative + b3Period;
      // Block 4: Cumulative B1 + B2 + B3 + B4
      const b4Period = blockAbs[3] + blockExc[3];
      const b4Cumulative = b3Cumulative + b4Period;

      const totalAbs = blockAbs.reduce((acc, v) => acc + v, 0);
      const totalExc = blockExc.reduce((acc, v) => acc + v, 0);
      const grandTotal = totalAbs + totalExc;

      return {
        ...student,
        blockAbs,
        blockExc,
        b1Total,
        b2Period,
        b2Cumulative,
        b3Cumulative,
        b4Cumulative,
        totalAbs,
        totalExc,
        grandTotal,
        subjectHours
      };
    });
  }, [activeStudents, records, lessonMap, selectedSubject]);

  // Filtered stats for active search query
  const filteredCumulativeStats = useMemo(() => {
    if (!searchQuery.trim()) return studentCumulativeStats;
    const q = searchQuery.trim().toLowerCase();
    return studentCumulativeStats.filter(s => s.name.toLowerCase().includes(q));
  }, [studentCumulativeStats, searchQuery]);

  // Overall group totals for semester summary
  const groupTotals = useMemo(() => {
    let groupB1 = 0;
    let groupB2Cumulative = 0;
    let groupGrandTotal = 0;

    studentCumulativeStats.forEach(s => {
      groupB1 += s.b1Total;
      groupB2Cumulative += s.b2Cumulative;
      groupGrandTotal += s.grandTotal;
    });

    return { groupB1, groupB2Cumulative, groupGrandTotal };
  }, [studentCumulativeStats]);

  // Copy text representation of current view to clipboard
  const handleCopyCurrentView = async () => {
    const groupName = AVAILABLE_GROUPS.find(g => g.id === currentGroupId)?.name || currentGroupId;

    if (mode === 'week') {
      const weekRange = getWeekDateRange(selectedWeek, activeReferenceDate);
      const lines: string[] = [
        `Табель посещаемости — Группа ${groupName}`,
        `Неделя ${selectedWeek} (${weekRange})`,
        ''
      ];

      filteredStudents.forEach((student, idx) => {
        let absentHours = 0;
        let excusedHours = 0;

        DAYS_OF_WEEK.forEach(dayName => {
          const dayISO = getDayISODate(dayName, selectedWeek, activeReferenceDate);
          const activeSchedule = (scheduleData && Object.keys(scheduleData).length > 0)
            ? scheduleData
            : (SCHEDULE_REGISTRY[currentGroupId] || {});
          const daySchedule = activeSchedule[selectedWeek]?.find(d => d.dayName === dayName);

          PAIRS.forEach(pairNum => {
            const lesson = daySchedule?.lessons.find(l => getLessonSlotNumber(l) === pairNum && !isPhysicalEducationLesson(l));
            if (!lesson) return;
            const rec = getAttendance(dayISO, lesson.id);
            if (rec.isCancelled) return;
            const lessonHours = lesson.hours || rec?.hours || 2;
            if ((rec.excusedStudentIds || []).includes(student.id)) {
              excusedHours += lessonHours;
            } else if (rec.absentStudentIds.includes(student.id)) {
              absentHours += lessonHours;
            }
          });
        });

        const total = absentHours + excusedHours;
        lines.push(`${idx + 1}. ${student.name}: ${total} ч (Н: ${absentHours}, УП: ${excusedHours})`);
      });

      try {
        await navigator.clipboard.writeText(lines.join('\n'));
        toast.success('Табель недели скопирован в буфер обмена');
      } catch {
        toast.error('Не удалось скопировать табель');
      }
    } else {
      const subjTitle = selectedSubject === 'all' ? 'Все предметы (общий итог)' : selectedSubject;
      const lines: string[] = [
        `Сводка пропусков — Группа ${groupName}`,
        `Предмет: ${subjTitle}`,
        `КУМУЛЯТИВНЫЙ УЧЕТ ЧАСОВ (накопительный итог для деканата):`,
        ''
      ];

      filteredCumulativeStats.forEach((s, idx) => {
        lines.push(
          `${idx + 1}. ${s.name}: Блок 1: ${s.b1Total} ч | Блок 2 (накоп. Б1+Б2): ${s.b2Cumulative} ч | Итого: ${s.grandTotal} ч (Н: ${s.totalAbs}, УП: ${s.totalExc})`
        );
      });

      try {
        await navigator.clipboard.writeText(lines.join('\n'));
        toast.success('Кумулятивная сводка скопирована в буфер обмена');
      } catch {
        toast.error('Не удалось скопировать сводку');
      }
    }
  };

  // Active weekly schedule for the selected week
  const activeWeekSchedule = useMemo(() => {
    const active = (scheduleData && Object.keys(scheduleData).length > 0)
      ? scheduleData
      : (SCHEDULE_REGISTRY[currentGroupId] || {});
    return active[selectedWeek] || [];
  }, [scheduleData, currentGroupId, selectedWeek]);

  return (
    <div className="space-y-5">
      {/* Top Controls & Switcher */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        {/* Mode Switcher */}
        <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
          <button
            type="button"
            onClick={() => setMode('week')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              mode === 'week'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Сетка недели (шахматка)
          </button>
          <button
            type="button"
            onClick={() => setMode('semester')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              mode === 'semester'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Сводка семестра (накопительно)
          </button>
        </div>

        {/* Search input & Copy button */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:w-60">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Поиск студента..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <button
            type="button"
            onClick={handleCopyCurrentView}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl transition-colors cursor-pointer"
            title="Скопировать текущие данные табеля"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Скопировать</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODE A: WEEKLY DETAILED GRID (ШАХМАТКА)                                   */}
      {/* ========================================================================= */}
      {mode === 'week' && (
        <div className="space-y-4">
          {/* Week & Month Selector Bar */}
          <div className="space-y-3 p-4 bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-800">
            {/* Month Selector Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1 shrink-0">Месяц:</span>
              {SEMESTER_MONTHS.map(m => {
                const isSelected = selectedMonth === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedMonth(m.id)}
                    className={`px-3 py-1 text-xs rounded-xl font-semibold whitespace-nowrap transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-600 text-white shadow-xs font-bold'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {m.name}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2.5 border-t border-slate-200/60 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <div>
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    Неделя {selectedWeek}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 ml-2">
                    ({getWeekDateRange(selectedWeek, activeReferenceDate)})
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4].map(w => {
                  const isSelected = selectedWeek === w;
                  const isCurrent = currentWeekNumber === w;
                  return (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setSelectedWeek(w)}
                      className={`px-3 py-1.5 text-xs rounded-xl font-semibold transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-600 text-white shadow-xs font-bold'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      Неделя {w} {isCurrent && <span className="text-[10px] opacity-80">(тек.)</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Table Container with Horizontal Scroll */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="overflow-x-auto max-w-full">
              <table className="w-full text-left text-xs border-collapse">
                {/* Header tier 1: Days of week */}
                <thead className="bg-slate-100 dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th
                      rowSpan={2}
                      className="sticky left-0 z-20 bg-slate-100 dark:bg-slate-800 p-3 min-w-[180px] max-w-[220px] font-bold text-slate-900 dark:text-white border-r border-slate-200 dark:border-slate-700 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]"
                    >
                      Студент ({filteredStudents.length})
                    </th>

                    {DAYS_OF_WEEK.map(dayName => {
                      const dayLabel = getDayCalendarDate(dayName, selectedWeek, activeReferenceDate);
                      return (
                        <th
                          key={dayName}
                          colSpan={6}
                          className="p-2 text-center font-bold border-r border-slate-200 dark:border-slate-700/80 bg-slate-100/90 dark:bg-slate-800/60"
                        >
                          <span className="text-slate-900 dark:text-white">{DAY_SHORT[dayName]}</span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-normal ml-1.5">
                            {dayLabel}
                          </span>
                        </th>
                      );
                    })}

                    <th
                      rowSpan={2}
                      className="p-3 text-center font-bold min-w-[80px] bg-slate-100 dark:bg-slate-800"
                    >
                      Итого нед.
                    </th>
                  </tr>

                  {/* Header tier 2: Pairs 1..6 */}
                  <tr className="border-b border-slate-200 dark:border-slate-700 text-[10px] text-slate-500 dark:text-slate-400">
                    {DAYS_OF_WEEK.map(dayName => {
                      const daySchedule = activeWeekSchedule.find(d => d.dayName === dayName);

                      return PAIRS.map(pairNum => {
                        const lesson = daySchedule?.lessons.find(l => getLessonSlotNumber(l) === pairNum && !isPhysicalEducationLesson(l));
                        const hasLesson = Boolean(lesson);

                        return (
                          <th
                            key={`${dayName}-${pairNum}`}
                            className={`p-1 text-center font-semibold border-r border-slate-200 dark:border-slate-700/60 min-w-[32px] ${
                              hasLesson
                                ? 'text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50/40 dark:bg-indigo-950/20'
                                : 'text-slate-400 dark:text-slate-500'
                            }`}
                            title={lesson ? `${lesson.subject} (${lesson.timeStart}-${lesson.timeEnd})` : `Пара ${pairNum}`}
                          >
                            {pairNum}
                          </th>
                        );
                      });
                    })}
                  </tr>
                </thead>

                {/* Rows: Students */}
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {filteredStudents.length === 0 ? (
                    <tr>
                      <td colSpan={38} className="p-8 text-center text-slate-400 text-xs">
                        Студенты не найдены
                      </td>
                    </tr>
                  ) : (
                    filteredStudents.map((student, studentIdx) => {
                      let studentWeekAbsHours = 0;
                      let studentWeekExcHours = 0;

                      return (
                        <tr
                          key={student.id}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          {/* Sticky student name column */}
                          <td className="sticky left-0 z-10 bg-white dark:bg-slate-900 p-2.5 font-medium text-slate-900 dark:text-slate-100 border-r border-slate-200 dark:border-slate-700/80 truncate shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                            <span className="text-slate-400 text-[11px] mr-1.5 font-mono">
                              {studentIdx + 1}.
                            </span>
                            <span title={student.name}>{student.name}</span>
                          </td>

                          {/* Grid cells: Days x Pairs */}
                          {DAYS_OF_WEEK.map(dayName => {
                            const dayISO = getDayISODate(dayName, selectedWeek, activeReferenceDate);
                            const daySchedule = activeWeekSchedule.find(d => d.dayName === dayName);

                            return PAIRS.map(pairNum => {
                              const lesson = daySchedule?.lessons.find(l => getLessonSlotNumber(l) === pairNum && !isPhysicalEducationLesson(l));

                              if (!lesson) {
                                return (
                                  <td
                                    key={`${dayName}-${pairNum}`}
                                    className="p-1 text-center border-r border-slate-200/60 dark:border-slate-800 text-slate-300 dark:text-slate-700 select-none text-[11px]"
                                  >
                                    —
                                  </td>
                                );
                              }

                              const record = getAttendance(dayISO, lesson.id);

                              if (record.isCancelled) {
                                return (
                                  <td
                                    key={`${dayName}-${pairNum}`}
                                    className="p-1 text-center border-r border-slate-200/60 dark:border-slate-800 text-slate-400 dark:text-slate-600 line-through text-[11px]"
                                    title="Пара отменена"
                                  >
                                    —
                                  </td>
                                );
                              }

                              const isExcused = (record.excusedStudentIds || []).includes(student.id);
                              const isAbsent = !isExcused && record.absentStudentIds.includes(student.id);

                              if (isExcused) {
                                studentWeekExcHours += 2;
                              } else if (isAbsent) {
                                studentWeekAbsHours += 2;
                              }

                              return (
                                <td
                                  key={`${dayName}-${pairNum}`}
                                  onClick={() => handleCellToggle(student.id, dayISO, lesson)}
                                  className={`p-1 text-center border-r border-slate-200/60 dark:border-slate-800 select-none transition-colors ${
                                    canEdit ? 'cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-950/40' : 'cursor-default'
                                  }`}
                                  title={`${student.name} — ${lesson.subject} (Пара ${pairNum}, ${lesson.timeStart}-${lesson.timeEnd})${canEdit ? ' • Нажмите для смены отметки' : ''}`}
                                >
                                  {isAbsent ? (
                                    <span className="inline-flex items-center justify-center min-w-[20px] px-1 py-0.5 rounded text-[10px] font-bold bg-red-100 dark:bg-red-950/70 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800">
                                      Н
                                    </span>
                                  ) : isExcused ? (
                                    <span className="inline-flex items-center justify-center min-w-[20px] px-1 py-0.5 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                                      УП
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center justify-center w-5 h-5 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                                      ✓
                                    </span>
                                  )}
                                </td>
                              );
                            });
                          })}

                          {/* Student Week Summary Column */}
                          <td className="p-2.5 text-center font-bold text-slate-800 dark:text-slate-200 bg-slate-50/60 dark:bg-slate-900/60">
                            {studentWeekAbsHours + studentWeekExcHours > 0 ? (
                              <div className="flex flex-col items-center leading-tight">
                                <span className="text-red-600 dark:text-red-400 text-xs">
                                  {studentWeekAbsHours + studentWeekExcHours} ч
                                </span>
                                <span className="text-[10px] text-slate-400 font-normal">
                                  {studentWeekAbsHours}н / {studentWeekExcHours}уп
                                </span>
                              </div>
                            ) : (
                              <span className="text-slate-300 dark:text-slate-600 text-xs">0</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Table Legend */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
            <div className="flex flex-wrap items-center gap-4 text-slate-600 dark:text-slate-400">
              <span className="font-semibold text-slate-800 dark:text-slate-200">Обозначения:</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓</span>
                <span>Присутствовал</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="px-1 py-0.5 rounded text-[10px] font-bold bg-red-100 dark:bg-red-950/70 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800">
                  Н
                </span>
                <span>Пропуск (2 ч)</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="px-1 py-0.5 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                  УП
                </span>
                <span>Уважительная (2 ч)</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-slate-400 select-none">—</span>
                <span>Пары нет / отменена</span>
              </span>
            </div>

            {canEdit && (
              <span className="text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">
                Подсказка: кликайте по ячейкам для быстрой смены статуса (Прис → Н → УП)
              </span>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE B: SEMESTER SUMMARY (КУМУЛЯТИВНЫЙ УЧЕТ ЧАСОВ ДЛЯ ДЕКАНАТА)          */}
      {/* ========================================================================= */}
      {mode === 'semester' && (
        <div className="space-y-4">
          {/* Controls Bar: Subject Filter & Metric Cards */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-200 dark:border-slate-800">
            {/* Subject Filter */}
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <Filter className="w-4 h-4 text-slate-400 shrink-0" />
              <label htmlFor="subject-filter-select" className="text-xs font-bold text-slate-700 dark:text-slate-300 shrink-0">
                Предмет:
              </label>
              <select
                id="subject-filter-select"
                value={selectedSubject}
                onChange={e => setSelectedSubject(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 truncate"
              >
                <option value="all">Все предметы (общий итог по семестру)</option>
                {groupSubjects.map(subj => (
                  <option key={subj} value={subj}>
                    {subj}
                  </option>
                ))}
              </select>
            </div>

            {/* Sub-view toggle (Cumulative Blocks vs Subject Breakdown) */}
            <div className="flex items-center gap-1.5 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => setSummaryView('cumulative')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
                  summaryView === 'cumulative'
                    ? 'bg-indigo-600 text-white shadow-xs font-bold'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
                }`}
              >
                Кумулятивно (по блокам)
              </button>
              <button
                type="button"
                onClick={() => setSummaryView('subjects')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
                  summaryView === 'subjects'
                    ? 'bg-indigo-600 text-white shadow-xs font-bold'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
                }`}
              >
                По предметам
              </button>
            </div>
          </div>

          {/* Quick Stats Badges for Starosta / Dean Submission */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">
                Студентов в группе
              </span>
              <span className="text-lg font-bold text-slate-900 dark:text-white mt-0.5 block">
                {activeStudents.length}
              </span>
            </div>

            <div className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">
                Блок 1 (пропуски)
              </span>
              <span className="text-lg font-bold text-slate-800 dark:text-slate-200 mt-0.5 block">
                {groupTotals.groupB1} ч.
              </span>
            </div>

            <div className="p-3.5 bg-indigo-50/70 dark:bg-indigo-950/30 rounded-2xl border border-indigo-200 dark:border-indigo-800 shadow-xs">
              <span className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 block">
                Блок 2 (накоп. Б1+Б2)
              </span>
              <span className="text-lg font-bold text-indigo-900 dark:text-indigo-200 mt-0.5 block">
                {groupTotals.groupB2Cumulative} ч.
              </span>
              <span className="text-[10px] text-indigo-600/80 dark:text-indigo-400 block mt-0.5">
                для ведомости в деканат
              </span>
            </div>

            <div className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">
                Итого за семестр
              </span>
              <span className="text-lg font-bold text-red-600 dark:text-red-400 mt-0.5 block">
                {groupTotals.groupGrandTotal} ч.
              </span>
            </div>
          </div>

          {/* VIEW 1: CUMULATIVE BLOCKS TABLE */}
          {summaryView === 'cumulative' && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
              <div className="overflow-x-auto max-w-full">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="sticky left-0 z-20 bg-slate-100 dark:bg-slate-800 p-3 min-w-[190px] font-bold text-slate-900 dark:text-white border-r border-slate-200 dark:border-slate-700 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                        Студент
                      </th>

                      {/* Block 1 */}
                      <th className="p-3 text-center min-w-[110px] border-r border-slate-200 dark:border-slate-700">
                        <div className="font-bold text-slate-900 dark:text-white">Блок 1</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">
                          31.08 – 27.09
                        </div>
                      </th>

                      {/* Block 2 Cumulative (Crucial for Dean submission) */}
                      <th className="p-3 text-center min-w-[140px] border-r border-slate-200 dark:border-slate-700 bg-indigo-50/50 dark:bg-indigo-950/20">
                        <div className="font-bold text-indigo-700 dark:text-indigo-300">
                          Блок 2 (накопительно)
                        </div>
                        <div className="text-[10px] text-indigo-600/80 dark:text-indigo-400 font-semibold">
                          Блок 1 + Блок 2 (в деканат)
                        </div>
                      </th>

                      {/* Block 3 */}
                      <th className="p-3 text-center min-w-[110px] border-r border-slate-200 dark:border-slate-700">
                        <div className="font-bold text-slate-900 dark:text-white">Блок 3</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">
                          накопит. Б1–Б3
                        </div>
                      </th>

                      {/* Block 4 */}
                      <th className="p-3 text-center min-w-[110px] border-r border-slate-200 dark:border-slate-700">
                        <div className="font-bold text-slate-900 dark:text-white">Блок 4</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">
                          накопит. Б1–Б4
                        </div>
                      </th>

                      {/* Grand Total */}
                      <th className="p-3 text-center min-w-[120px] font-bold text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800">
                        Итого пропусков
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {filteredCumulativeStats.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-400 text-xs">
                          Студенты не найдены
                        </td>
                      </tr>
                    ) : (
                      filteredCumulativeStats.map((s, idx) => (
                        <tr
                          key={s.id}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          {/* Student Name */}
                          <td className="sticky left-0 z-10 bg-white dark:bg-slate-900 p-2.5 font-medium text-slate-900 dark:text-slate-100 border-r border-slate-200 dark:border-slate-700/80 truncate shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                            <span className="text-slate-400 text-[11px] mr-1.5 font-mono">
                              {idx + 1}.
                            </span>
                            <span title={s.name}>{s.name}</span>
                          </td>

                          {/* Block 1 */}
                          <td className="p-2.5 text-center border-r border-slate-200/60 dark:border-slate-800">
                            {s.b1Total > 0 ? (
                              <div className="flex flex-col items-center leading-tight">
                                <span className="font-semibold text-slate-800 dark:text-slate-200">
                                  {s.b1Total} ч
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {s.blockAbs[0]}н / {s.blockExc[0]}уп
                                </span>
                              </div>
                            ) : (
                              <span className="text-slate-300 dark:text-slate-600">—</span>
                            )}
                          </td>

                          {/* Block 2 Cumulative (Б1 + Б2) */}
                          <td className="p-2.5 text-center border-r border-slate-200/60 dark:border-slate-800 bg-indigo-50/20 dark:bg-indigo-950/10">
                            {s.b2Cumulative > 0 ? (
                              <div className="flex flex-col items-center leading-tight">
                                <span className="font-bold text-indigo-700 dark:text-indigo-300">
                                  {s.b2Cumulative} ч
                                </span>
                                <span className="text-[10px] text-indigo-600/70 dark:text-indigo-400 font-normal">
                                  (период Б2: +{s.b2Period} ч)
                                </span>
                              </div>
                            ) : (
                              <span className="text-slate-300 dark:text-slate-600">—</span>
                            )}
                          </td>

                          {/* Block 3 Cumulative */}
                          <td className="p-2.5 text-center border-r border-slate-200/60 dark:border-slate-800">
                            {s.b3Cumulative > 0 ? (
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                {s.b3Cumulative} ч
                              </span>
                            ) : (
                              <span className="text-slate-300 dark:text-slate-600">—</span>
                            )}
                          </td>

                          {/* Block 4 Cumulative */}
                          <td className="p-2.5 text-center border-r border-slate-200/60 dark:border-slate-800">
                            {s.b4Cumulative > 0 ? (
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                {s.b4Cumulative} ч
                              </span>
                            ) : (
                              <span className="text-slate-300 dark:text-slate-600">—</span>
                            )}
                          </td>

                          {/* Grand Total */}
                          <td className="p-2.5 text-center bg-slate-50/60 dark:bg-slate-900/60">
                            {s.grandTotal > 0 ? (
                              <div className="flex flex-col items-center leading-tight">
                                <span className="font-bold text-red-600 dark:text-red-400">
                                  {s.grandTotal} ч
                                </span>
                                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                  {s.totalAbs}н / {s.totalExc}уп
                                </span>
                              </div>
                            ) : (
                              <span className="text-slate-300 dark:text-slate-600">0 ч</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VIEW 2: SUBJECTS BREAKDOWN TABLE */}
          {summaryView === 'subjects' && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
              <div className="overflow-x-auto max-w-full">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="sticky left-0 z-20 bg-slate-100 dark:bg-slate-800 p-3 min-w-[190px] font-bold text-slate-900 dark:text-white border-r border-slate-200 dark:border-slate-700 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                        Студент
                      </th>

                      {groupSubjects.map(subj => (
                        <th
                          key={subj}
                          className="p-2.5 text-center min-w-[130px] max-w-[170px] font-bold border-r border-slate-200 dark:border-slate-700 truncate"
                          title={subj}
                        >
                          <span className="block truncate text-slate-900 dark:text-white">
                            {subj}
                          </span>
                        </th>
                      ))}

                      <th className="p-3 text-center min-w-[100px] font-bold text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800">
                        Всего (ч)
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {filteredCumulativeStats.length === 0 ? (
                      <tr>
                        <td colSpan={groupSubjects.length + 2} className="p-8 text-center text-slate-400 text-xs">
                          Студенты не найдены
                        </td>
                      </tr>
                    ) : (
                      filteredCumulativeStats.map((s, idx) => (
                        <tr
                          key={s.id}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          {/* Student Name */}
                          <td className="sticky left-0 z-10 bg-white dark:bg-slate-900 p-2.5 font-medium text-slate-900 dark:text-slate-100 border-r border-slate-200 dark:border-slate-700/80 truncate shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                            <span className="text-slate-400 text-[11px] mr-1.5 font-mono">
                              {idx + 1}.
                            </span>
                            <span title={s.name}>{s.name}</span>
                          </td>

                          {/* Subjects columns */}
                          {groupSubjects.map(subj => {
                            const data = s.subjectHours[subj];
                            const hours = data?.total || 0;

                            return (
                              <td
                                key={subj}
                                className="p-2 text-center border-r border-slate-200/60 dark:border-slate-800"
                              >
                                {hours > 0 ? (
                                  <div className="flex flex-col items-center leading-tight">
                                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                                      {hours} ч
                                    </span>
                                    <span className="text-[10px] text-slate-400">
                                      {data.abs}н / {data.exc}уп
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-slate-300 dark:text-slate-600">—</span>
                                )}
                              </td>
                            );
                          })}

                          {/* Total */}
                          <td className="p-2.5 text-center font-bold text-red-600 dark:text-red-400 bg-slate-50/60 dark:bg-slate-900/60">
                            {s.grandTotal > 0 ? `${s.grandTotal} ч` : '0 ч'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AttendanceMatrix;
