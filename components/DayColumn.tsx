import React, { useState, useMemo, useEffect, useRef } from 'react';
import { DaySchedule, Lesson } from '../types';
import ClassCard from './ClassCard';
import { 
  getDayCalendarDate, 
  getDayISODate, 
  samaraISO, 
  getSamaraDate, 
  getSemesterWeek, 
  parseTimeToMinutes, 
  getSamaraTimeHM 
} from '../utils/samaraDate';
import { useNow } from '../utils/useNow';
import { isPhysicalEducationLesson } from '../utils/scheduleLoader';
import EditLessonModal, { TeacherAssignmentScope } from './EditLessonModal';
import { Plus, Eye, EyeOff, CalendarCheck } from 'lucide-react';

interface DayColumnProps {
  daySchedule: DaySchedule;
  weekNumber?: number;
  userRole?: string;
  onUpdateLesson?: (lessonId: string, updated: Partial<Lesson>, applyScope?: TeacherAssignmentScope, lessonDayName?: string) => void;
  onResetLesson?: (lessonId: string) => void;
}

const DayColumn: React.FC<DayColumnProps> = ({ 
  daySchedule,
  weekNumber = 1,
  userRole,
  onUpdateLesson,
  onResetLesson,
}) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const canEdit = userRole?.toLowerCase() === 'admin' || userRole?.toLowerCase() === 'starosta';

  const liveNow = useNow(60000);
  const samaraToday = useMemo(() => getSamaraDate(liveNow), [liveNow]);
  const currentSemesterWeek = useMemo(() => getSemesterWeek(samaraToday), [samaraToday]);

  if (!daySchedule) return null;
  const calendarDate = getDayCalendarDate(daySchedule.dayName, weekNumber, samaraToday);
  const dayIso = getDayISODate(daySchedule.dayName, weekNumber, samaraToday);
  const isToday = dayIso === samaraISO(samaraToday) && weekNumber === currentSemesterWeek;

  const visibleLessons = daySchedule.lessons.filter(l => !l.isHidden && !isPhysicalEducationLesson(l));
  const hiddenLessons = daySchedule.lessons.filter(l => l.isHidden && !isPhysicalEducationLesson(l));

  // Auto-scroll logic: detect current pair (isCurrent) or next nearest upcoming pair
  const [curH, curM] = getSamaraTimeHM(liveNow);
  const curMinutes = curH * 60 + curM;

  const currentLesson = useMemo(() => {
    if (!isToday || visibleLessons.length === 0) return null;
    return visibleLessons.find(l => {
      const start = parseTimeToMinutes(l.timeStart);
      const end = parseTimeToMinutes(l.timeEnd);
      return start >= 0 && end >= 0 && curMinutes >= start && curMinutes <= end;
    }) || null;
  }, [isToday, visibleLessons, curMinutes]);

  const upcomingLesson = useMemo(() => {
    if (!isToday || visibleLessons.length === 0 || currentLesson) return null;
    const sorted = visibleLessons
      .filter(l => {
        const start = parseTimeToMinutes(l.timeStart);
        return start >= 0 && start > curMinutes;
      })
      .sort((a, b) => parseTimeToMinutes(a.timeStart) - parseTimeToMinutes(b.timeStart));
    return sorted[0] || null;
  }, [isToday, visibleLessons, currentLesson, curMinutes]);

  const targetScrollLessonId = currentLesson?.id || upcomingLesson?.id || null;
  const hasScrolledRef = useRef(false);

  useEffect(() => {
    if (!isToday || !targetScrollLessonId || hasScrolledRef.current) return;

    const timer = setTimeout(() => {
      const el = document.getElementById(`lesson-card-${targetScrollLessonId}`);
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        hasScrolledRef.current = true;
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [isToday, targetScrollLessonId]);

  const newLessonTemplate: Lesson = {
    id: `${daySchedule.dayName.toLowerCase()}_w${weekNumber}_extra_${Date.now()}`,
    timeStart: '08:00',
    timeEnd: '09:35',
    subject: '',
    type: 'Лекции',
    location: '',
    teacher: '',
    order: 1
  };

  return (
    <div className="flex flex-col w-full min-w-0 max-w-full">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
            {daySchedule.dayName}
          </h2>
          <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50/90 dark:bg-indigo-950/60 border border-indigo-200/60 dark:border-indigo-800/60 px-2.5 py-0.5 rounded-lg shadow-2xs">
            {calendarDate}
          </span>
        </div>

        <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 bg-slate-200/70 dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/60 px-2.5 py-0.5 rounded-full">
          {visibleLessons.length} {visibleLessons.length === 1 ? 'пара' : (visibleLessons.length >= 2 && visibleLessons.length <= 4) ? 'пары' : 'пар'}
        </span>
      </div>
      
      <div className="flex flex-col gap-4 w-full min-w-0">
        {visibleLessons.map((lesson) => (
          <div key={lesson.id} id={`lesson-card-${lesson.id}`} className="w-full">
            <ClassCard 
              lesson={lesson} 
              dayName={daySchedule.dayName}
              userRole={userRole}
              isCurrent={lesson.id === currentLesson?.id}
              onUpdateLesson={onUpdateLesson}
              onResetLesson={onResetLesson}
            />
          </div>
        ))}
        {visibleLessons.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 px-6 my-auto bg-white/70 dark:bg-slate-900/40 border border-dashed border-slate-200/90 dark:border-slate-800 rounded-3xl text-center shadow-2xs">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3 text-slate-400 dark:text-slate-500">
              <CalendarCheck className="w-6 h-6 stroke-[1.75]" />
            </div>
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Занятий нет
            </div>
            {canEdit && onUpdateLesson && (
              <button
                type="button"
                onClick={() => setIsAddModalOpen(true)}
                className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 font-bold text-xs rounded-xl transition-all border border-indigo-200/60 dark:border-transparent shadow-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Добавить пару
              </button>
            )}
          </div>
        )}

        {hiddenLessons.length > 0 && (
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShowHidden(!showHidden)}
              className="w-full py-2.5 px-3 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 bg-slate-100/70 dark:bg-slate-800/50 rounded-2xl transition-all border border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center gap-2"
            >
              {showHidden ? <EyeOff className="w-3.5 h-3.5 text-slate-500" /> : <Eye className="w-3.5 h-3.5 text-slate-500" />}
              {showHidden ? `Скрыть скрытые пары (${hiddenLessons.length})` : `Показать скрытые пары (${hiddenLessons.length})`}
            </button>

            {showHidden && (
              <div className="mt-3 flex flex-col gap-3 opacity-75">
                {hiddenLessons.map(lesson => (
                  <ClassCard
                    key={lesson.id}
                    lesson={lesson}
                    dayName={daySchedule.dayName}
                    userRole={userRole}
                    onUpdateLesson={onUpdateLesson}
                    onResetLesson={onResetLesson}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {isAddModalOpen && (
        <EditLessonModal
          lesson={newLessonTemplate}
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          onSave={(updated, scope) => {
            if (onUpdateLesson) {
              onUpdateLesson(newLessonTemplate.id, {
                ...newLessonTemplate,
                ...updated,
                dayName: daySchedule.dayName,
                week: weekNumber
              } as any, scope);
            }
          }}
          onReset={() => {}}
        />
      )}
    </div>
  );
};

export default DayColumn;