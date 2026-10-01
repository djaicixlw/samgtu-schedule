import React, { useState } from 'react';
import { Lesson } from '../types';
import { MapPin, User, Users, Info, Edit3, ExternalLink, Link2 } from 'lucide-react';
import EditLessonModal, { TeacherAssignmentScope } from './EditLessonModal';

interface ClassCardProps {
  lesson: Lesson;
  dayName?: string;
  userRole?: string;
  onUpdateLesson?: (lessonId: string, updated: Partial<Lesson>, applyScope?: TeacherAssignmentScope, lessonDayName?: string) => void;
  onResetLesson?: (lessonId: string) => void;
}

const ClassCard: React.FC<ClassCardProps> = ({ 
  lesson, 
  dayName,
  userRole = 'student',
  onUpdateLesson,
  onResetLesson,
}) => {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const canEdit = userRole.toLowerCase() === 'admin' || userRole.toLowerCase() === 'starosta';

  // Determine badge color based on lesson type
  const getTypeColor = (type: string) => {
    const lowerType = type.toLowerCase();
    if (lowerType.includes('лекц')) return 'bg-blue-100/90 text-blue-900 border border-blue-300/80 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/40 font-bold';
    if (lowerType.includes('прак')) return 'bg-emerald-100/90 text-emerald-900 border border-emerald-300/80 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40 font-bold';
    if (lowerType.includes('лаб')) return 'bg-amber-100/90 text-amber-900 border border-amber-300/80 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40 font-bold';
    return 'bg-slate-200/80 text-slate-800 border border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 font-bold';
  };

  const formatGroups = (groups: string) => {
    return groups.replace(/2-ИНГТ-24ИНГТ-/g, '');
  };

  const isCancelled = lesson.isCancelled;

  return (
    <>
      <div className={`w-full rounded-2xl p-4 transition-all duration-200 h-full flex flex-col justify-between ${
        isCancelled
          ? 'bg-slate-100/70 dark:bg-slate-900/40 border border-red-200 dark:border-red-900/30 opacity-75 shadow-xs'
          : 'bg-white dark:bg-slate-900 border border-slate-300/80 dark:border-slate-800/90 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.03)] hover:shadow-md hover:border-slate-400/80 dark:hover:border-slate-700'
      }`}>
        <div>
          <div className="flex justify-between items-start mb-2.5">
            <div className="flex flex-col">
              <span className={`text-base font-bold leading-tight ${isCancelled ? 'text-slate-400 line-through' : 'text-slate-900 dark:text-white'}`}>
                {lesson.timeStart}
              </span>
              <span className="text-[11px] text-slate-600 dark:text-slate-400 font-semibold">
                - {lesson.timeEnd}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
              {isCancelled && (
                <span className="px-2 py-0.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wide bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
                  Отменена
                </span>
              )}
              <span className={`px-2.5 py-0.5 rounded-lg text-[10px] uppercase font-bold tracking-wide ${getTypeColor(lesson.type)}`}>
                {lesson.type.replace(/заняти[ея]|работ[аы]/gi, '').trim() || lesson.type}
              </span>
            </div>
          </div>
          
          <h3 className={`font-semibold mb-2.5 text-sm leading-snug [hyphens:auto] [word-break:break-word] ${
            isCancelled 
              ? 'text-slate-400 dark:text-slate-500 line-through decoration-red-500 decoration-2' 
              : 'text-slate-900 dark:text-slate-100'
          }`}>
            {lesson.subject}
          </h3>

          {lesson.note && lesson.note.trim() !== '' && (
            <div className="mb-2.5 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200/60 dark:border-amber-700/30 rounded-xl flex items-start gap-1.5 text-xs text-amber-900 dark:text-amber-300">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="leading-tight text-[11px] font-medium">{lesson.note.trim()}</span>
            </div>
          )}
        </div>

        <div className="space-y-2 mt-2 pt-3 border-t border-slate-200/90 dark:border-slate-800">
          <div className="flex items-start gap-2">
            <MapPin className="w-3.5 h-3.5 text-slate-500 dark:text-slate-500 mt-0.5 shrink-0" />
            <span className="text-xs text-slate-800 dark:text-slate-300 font-semibold">
              {lesson.location || 'Аудитория уточняется'}
            </span>
          </div>
          
          <div className="flex items-start gap-2">
            <User className="w-3.5 h-3.5 text-slate-500 dark:text-slate-500 mt-0.5 shrink-0" />
            <span className="text-xs text-slate-700 dark:text-slate-400 font-medium">
              {lesson.teacher || 'Преподаватель не назначен'}
            </span>
          </div>

          {lesson.groups && (
            <div className="flex items-start gap-2">
              <Users className="w-3.5 h-3.5 text-slate-500 dark:text-slate-500 mt-0.5 shrink-0" />
              <span className="text-[10px] text-slate-600 dark:text-slate-400 w-full break-words leading-tight">
                <span className="font-bold text-slate-800 dark:text-slate-200">Группы:</span> {formatGroups(lesson.groups)}
              </span>
            </div>
          )}

          {/* Attached Files & Links */}
          {lesson.attachments && lesson.attachments.length > 0 && (
            <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800 space-y-1.5">
              <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <Link2 className="w-3 h-3 text-indigo-500" />
                Материалы к паре:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {lesson.attachments.map((att, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (att.url) {
                        if (typeof window !== 'undefined' && window.Telegram?.WebApp?.openLink) {
                          window.Telegram.WebApp.openLink(att.url);
                        } else {
                          window.open(att.url, '_blank', 'noopener,noreferrer');
                        }
                      }
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-indigo-700 dark:text-indigo-300 text-[11px] font-semibold rounded-lg transition-all border border-indigo-200/60 dark:border-slate-700 cursor-pointer"
                  >
                    <ExternalLink className="w-3 h-3 text-indigo-500 shrink-0" />
                    <span className="truncate max-w-[160px]">{att.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Edit button for Starosta and Admin */}
          {canEdit && (
            <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800/80 flex justify-end">
              <button
                onClick={() => setIsEditModalOpen(true)}
                className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-100 hover:bg-slate-200/80 border border-slate-300/80 dark:border-transparent dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-300 text-xs font-bold rounded-xl transition-all shadow-2xs"
              >
                <Edit3 className="w-3.5 h-3.5" /> Редактировать данные пары
              </button>
            </div>
          )}
        </div>
      </div>

      {isEditModalOpen && (
        <EditLessonModal
          lesson={lesson}
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          onSave={(updated, applyScope) => onUpdateLesson && onUpdateLesson(lesson.id, updated, applyScope, dayName)}
          onReset={() => onResetLesson && onResetLesson(lesson.id)}
        />
      )}
    </>
  );
};

export default ClassCard;
