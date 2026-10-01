import React, { useState } from 'react';
import { DaySchedule, Lesson } from '../types';
import ClassCard from './ClassCard';
import { getDayCalendarDate } from '../attendance';
import EditLessonModal, { TeacherAssignmentScope } from './EditLessonModal';
import { Plus, Eye, EyeOff } from 'lucide-react';

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

  if (!daySchedule) return null;
  const calendarDate = getDayCalendarDate(daySchedule.dayName, weekNumber);

  const visibleLessons = daySchedule.lessons.filter(l => !l.isHidden);
  const hiddenLessons = daySchedule.lessons.filter(l => l.isHidden);

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
          <ClassCard 
            key={lesson.id} 
            lesson={lesson} 
            dayName={daySchedule.dayName}
            userRole={userRole}
            onUpdateLesson={onUpdateLesson}
            onResetLesson={onResetLesson}
          />
        ))}
        {visibleLessons.length === 0 && (
          <div className="p-8 bg-white/70 dark:bg-slate-900/40 border-2 border-dashed border-slate-200/90 dark:border-slate-800 rounded-3xl text-center space-y-3 shadow-2xs">
            <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
              В этот день занятий нет
            </div>
            <div className="text-[11px] text-slate-400">
              {daySchedule.dayName === 'Четверг' 
                ? 'День самостоятельной работы / Военная кафедра' 
                : daySchedule.dayName === 'Воскресенье'
                  ? 'Выходной день'
                  : 'Свободный от занятий день по учебному плану'}
            </div>
            {canEdit && onUpdateLesson && (
              <button
                type="button"
                onClick={() => setIsAddModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-bold text-xs rounded-xl transition-all border border-indigo-200/60 dark:border-transparent shadow-xs"
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