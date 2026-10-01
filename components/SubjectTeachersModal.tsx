import React, { useState, useMemo } from 'react';
import { X, Check, UserCheck, RotateCcw, Search, BookOpen, PenTool, FlaskConical, Copy } from 'lucide-react';
import { SCHEDULE_REGISTRY } from '../constants';
import { toast } from 'sonner';

interface SubjectTeachersModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentGroupId: string;
  subjectTeachers: Record<string, string>;
  onSave: (updated: Record<string, string>) => void;
}

interface SubjectTypeInfo {
  type: string;
  defaultTeacher: string;
}

interface SubjectGroup {
  subject: string;
  types: SubjectTypeInfo[];
}

const SubjectTeachersModal: React.FC<SubjectTeachersModalProps> = ({
  isOpen,
  onClose,
  currentGroupId,
  subjectTeachers,
  onSave
}) => {
  // Extract all subjects and their existing lesson types for this group
  const subjectGroups: SubjectGroup[] = useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    const weeks = SCHEDULE_REGISTRY[currentGroupId] || {};

    Object.values(weeks).forEach(days => {
      days.forEach(day => {
        day.lessons.forEach(l => {
          if (!l.subject) return;
          if (!map.has(l.subject)) {
            map.set(l.subject, new Map());
          }
          const typesMap = map.get(l.subject)!;
          const lessonType = l.type || 'Занятие';
          if (!typesMap.has(lessonType)) {
            typesMap.set(lessonType, l.teacher || '');
          }
        });
      });
    });

    return Array.from(map.entries())
      .map(([subject, typesMap]) => ({
        subject,
        types: Array.from(typesMap.entries()).map(([type, defaultTeacher]) => ({
          type,
          defaultTeacher
        }))
      }))
      .sort((a, b) => a.subject.localeCompare(b.subject));
  }, [currentGroupId]);

  // Initial state mapping: "subject::type" -> teacher name
  const [teachers, setTeachers] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = { ...subjectTeachers };
    subjectGroups.forEach(group => {
      group.types.forEach(t => {
        const key = `${group.subject}::${t.type}`;
        if (!initial[key]) {
          // Check if there is a flat subject teacher or default
          initial[key] = subjectTeachers[group.subject] || t.defaultTeacher || '';
        }
      });
    });
    return initial;
  });

  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

  const handleTeacherChange = (subject: string, type: string, value: string) => {
    const key = `${subject}::${type}`;
    setTeachers(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleResetType = (subject: string, type: string, defaultTeacher: string) => {
    const key = `${subject}::${type}`;
    setTeachers(prev => ({
      ...prev,
      [key]: defaultTeacher
    }));
  };

  const handleApplyToAllTypes = (subject: string, teacherValue: string) => {
    if (!teacherValue.trim()) return;
    const group = subjectGroups.find(g => g.subject === subject);
    if (!group) return;

    setTeachers(prev => {
      const updated = { ...prev };
      group.types.forEach(t => {
        updated[`${subject}::${t.type}`] = teacherValue;
      });
      // Also update flat key for fallback
      updated[subject] = teacherValue;
      return updated;
    });

    toast.info(`Преподаватель скопирован на все виды занятий по «${subject}»`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(teachers);
    onClose();
  };

  const getTypeBadge = (type: string) => {
    const lower = type.toLowerCase();
    if (lower.includes('лекц')) {
      return (
        <span className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300">
          <BookOpen className="w-3 h-3" /> Лекции
        </span>
      );
    }
    if (lower.includes('практ')) {
      return (
        <span className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
          <PenTool className="w-3 h-3" /> Практические
        </span>
      );
    }
    if (lower.includes('лаб')) {
      return (
        <span className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300">
          <FlaskConical className="w-3 h-3" /> Лабораторные
        </span>
      );
    }
    return (
      <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
        {type}
      </span>
    );
  };

  const filteredGroups = subjectGroups.filter(group => {
    const query = searchQuery.toLowerCase();
    const matchesSubject = group.subject.toLowerCase().includes(query);
    const matchesTeacher = group.types.some(t => {
      const key = `${group.subject}::${t.type}`;
      return (teachers[key] || '').toLowerCase().includes(query);
    });
    return matchesSubject || matchesTeacher;
  });

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl max-w-2xl w-full max-h-[90dvh] sm:max-h-[85vh] flex flex-col shadow-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                Ответственные преподаватели
              </h3>
              <p className="text-xs text-slate-400">
                Раздельное назначение преподавателей на лекции, практики и лабы
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 pb-2 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Поиск по предмету или ФИО преподавателя..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-slate-900 dark:text-white"
            />
          </div>
        </div>

        {/* List of subjects */}
        <form id="teachers-form" onSubmit={handleSubmit} className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-4 px-4 pr-3">
          {filteredGroups.map(group => (
            <div 
              key={group.subject}
              className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/60 space-y-3"
            >
              {/* Subject Title */}
              <div className="flex justify-between items-start gap-2">
                <span className="text-xs font-bold text-slate-900 dark:text-white leading-snug">
                  {group.subject}
                </span>
              </div>

              {/* Types Inputs */}
              <div className="space-y-2.5">
                {group.types.map(t => {
                  const key = `${group.subject}::${t.type}`;
                  const currentValue = teachers[key] || '';

                  return (
                    <div 
                      key={t.type} 
                      className="bg-white dark:bg-slate-800/90 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-700/60 flex flex-col sm:flex-row sm:items-center gap-2"
                    >
                      <div className="sm:w-36 shrink-0 flex items-center justify-between">
                        {getTypeBadge(t.type)}
                        <button
                          type="button"
                          onClick={() => handleApplyToAllTypes(group.subject, currentValue)}
                          disabled={!currentValue.trim()}
                          className="sm:hidden text-[10px] text-slate-400 hover:text-indigo-600 disabled:opacity-30"
                          title="Скопировать этого преподавателя на остальные виды занятий"
                        >
                          Ко всем
                        </button>
                      </div>

                      <div className="flex-1 flex items-center gap-1.5">
                        <input
                          type="text"
                          placeholder="ФИО преподавателя"
                          value={currentValue}
                          onChange={(e) => handleTeacherChange(group.subject, t.type, e.target.value)}
                          className="flex-1 px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none dark:text-white"
                        />

                        <button
                          type="button"
                          onClick={() => handleResetType(group.subject, t.type, t.defaultTeacher)}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg transition-colors"
                          title="Сбросить до исходного"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleApplyToAllTypes(group.subject, currentValue)}
                          disabled={!currentValue.trim()}
                          className="hidden sm:flex items-center gap-1 px-2 py-1.5 text-[10px] font-semibold text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-300 bg-slate-100 dark:bg-slate-800 rounded-lg disabled:opacity-30 transition-all shrink-0"
                          title="Скопировать этого преподавателя на остальные виды занятий по этому предмету"
                        >
                          <Copy className="w-3 h-3" /> Ко всем видам
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </form>

        {/* Fixed Footer with Safe Area */}
        <div className="flex gap-2 p-4 pt-3 border-t border-slate-200/80 dark:border-slate-800 shrink-0 pb-safe bg-white dark:bg-slate-900">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold text-xs rounded-xl min-h-[44px]"
          >
            Отмена
          </button>
          <button
            type="submit"
            form="teachers-form"
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-200 dark:shadow-none transition-all min-h-[44px]"
          >
            <Check className="w-4 h-4" /> Сохранить для всей группы
          </button>
        </div>
      </div>
    </div>
  );
};

export default SubjectTeachersModal;
