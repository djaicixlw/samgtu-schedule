import React, { useState } from 'react';
import { X, Check, RotateCcw, Link2, Plus, Trash2, ExternalLink } from 'lucide-react';
import { Lesson, HomeworkAttachment } from '../types';

export type TeacherAssignmentScope = 'none' | 'type' | 'all';

interface EditLessonModalProps {
  lesson: Lesson;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedLesson: Partial<Lesson>, applyScope?: TeacherAssignmentScope) => void;
  onReset: () => void;
}

const EditLessonModal: React.FC<EditLessonModalProps> = ({
  lesson,
  isOpen,
  onClose,
  onSave,
  onReset,
}) => {
  const [subject, setSubject] = useState(lesson.subject);
  const [teacher, setTeacher] = useState(lesson.teacher || '');
  const [location, setLocation] = useState(lesson.location || '');
  const [note, setNote] = useState(lesson.note || '');
  const [isCancelled, setIsCancelled] = useState<boolean>(!!lesson.isCancelled);
  const [isHidden, setIsHidden] = useState<boolean>(!!lesson.isHidden);
  const [applyScope, setApplyScope] = useState<TeacherAssignmentScope>('type');

  // Attachments & links
  const [attachments, setAttachments] = useState<HomeworkAttachment[]>(() => {
    return Array.isArray(lesson.attachments) ? [...lesson.attachments] : [];
  });
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');

  if (!isOpen) return null;

  const handleAddAttachment = () => {
    if (!newLinkUrl.trim()) return;
    let url = newLinkUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }
    const name = newLinkTitle.trim() || url.replace(/^https?:\/\//i, '').split('/')[0] || 'Ссылка к паре';
    setAttachments(prev => [...prev, { name, url, type: 'link' }]);
    setNewLinkTitle('');
    setNewLinkUrl('');
    setIsAddingLink(false);
  };

  const handleRemoveAttachment = (idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    onSave({
      subject,
      teacher,
      location,
      note,
      isCancelled,
      isHidden,
      attachments,
    }, applyScope);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl max-w-lg w-full max-h-[90dvh] sm:max-h-[85vh] flex flex-col shadow-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shrink-0">
          <div>
            <h3 className="font-bold text-base text-slate-900 dark:text-white">Редактирование данных пары</h3>
            <p className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold mt-0.5">
              {lesson.timeStart} - {lesson.timeEnd} • {lesson.type}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form id="edit-lesson-form" onSubmit={handleSubmit} className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
              Название предмета
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3.5 py-2.5 text-base sm:text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-slate-900 dark:text-white"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                Преподаватель (ФИО)
              </label>
              <input
                type="text"
                placeholder="ФИО преподавателя"
                value={teacher}
                onChange={(e) => setTeacher(e.target.value)}
                className="w-full px-3.5 py-2.5 text-base sm:text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                Аудитория / Корпус
              </label>
              <input
                type="text"
                placeholder="напр. Корпус 1, 109Б"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full px-3.5 py-2.5 text-base sm:text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-slate-900 dark:text-white"
              />
            </div>
          </div>

          {/* Granular Scope Selector */}
          <div className="p-3.5 bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 rounded-2xl space-y-2">
            <span className="text-[11px] font-bold text-indigo-900 dark:text-indigo-300 block">
              Куда применить преподавателя:
            </span>
            
            <div className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="teacherScope"
                  checked={applyScope === 'type'}
                  onChange={() => setApplyScope('type')}
                  className="w-4 h-4 text-indigo-600 focus:ring-indigo-500"
                />
                <span>На все «{lesson.type}» по предмету во всех 4 неделях</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="teacherScope"
                  checked={applyScope === 'all'}
                  onChange={() => setApplyScope('all')}
                  className="w-4 h-4 text-indigo-600 focus:ring-indigo-500"
                />
                <span>На ВСЕ виды занятий (лекции, практики, лабы) предмета</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="teacherScope"
                  checked={applyScope === 'none'}
                  onChange={() => setApplyScope('none')}
                  className="w-4 h-4 text-indigo-600 focus:ring-indigo-500"
                />
                <span>Только на эту конкретную пару</span>
              </label>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
              Заметка к паре (для всей группы)
            </label>
            <input
              type="text"
              placeholder="напр. Принести калькулятор, методичка №2"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full px-3.5 py-2.5 text-base sm:text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-slate-900 dark:text-white"
            />
          </div>

          {/* Attachments / Files / Links Section */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                <Link2 className="w-3.5 h-3.5 text-indigo-500" />
                <span>Материалы и ссылки к паре</span>
                {attachments.length > 0 && (
                  <span className="ml-1 text-[10px] bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.2 rounded-full font-bold">
                    {attachments.length}
                  </span>
                )}
              </div>
              {!isAddingLink && (
                <button
                  type="button"
                  onClick={() => setIsAddingLink(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  <Plus className="w-3 h-3" /> Добавить ссылку
                </button>
              )}
            </div>

            {/* Existing Attachments List */}
            {attachments.length > 0 && (
              <div className="space-y-1.5">
                {attachments.map((att, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2 p-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-700/50 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <ExternalLink className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                        {att.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(idx)}
                      className="text-slate-400 hover:text-red-500 transition-colors p-1"
                      title="Удалить ссылку"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add Link Form */}
            {isAddingLink && (
              <div className="space-y-2 p-2.5 bg-white dark:bg-slate-800/80 rounded-xl border border-indigo-100 dark:border-indigo-900/40">
                <input
                  type="text"
                  placeholder="Название (напр. Презентация / Диск / Moodle)"
                  value={newLinkTitle}
                  onChange={(e) => setNewLinkTitle(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-base sm:text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none"
                />
                <input
                  type="url"
                  placeholder="URL-ссылка (https://...)"
                  value={newLinkUrl}
                  onChange={(e) => setNewLinkUrl(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-base sm:text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none"
                />
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => { setIsAddingLink(false); setNewLinkTitle(''); setNewLinkUrl(''); }}
                    className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={handleAddAttachment}
                    disabled={!newLinkUrl.trim()}
                    className="px-3 py-1 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg transition-colors"
                  >
                    Прикрепить
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Lesson Cancellation Toggle (Rock-solid Clickable Container) */}
          <div 
            onClick={() => setIsCancelled(!isCancelled)}
            className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 cursor-pointer select-none ${
              isCancelled 
                ? 'bg-red-500/15 border-red-500/40 dark:bg-red-950/40 dark:border-red-800' 
                : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/60 hover:border-red-200 dark:hover:border-red-900/40'
            }`}
          >
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${isCancelled ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}`}>
                  Отмена пары на эту дату
                </span>
                {isCancelled && (
                  <span className="px-1.5 py-0.5 rounded-md text-[9px] font-extrabold uppercase bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
                    Отменена
                  </span>
                )}
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                {isCancelled ? 'Пара будет зачеркнута с красным бейджем для всей группы' : 'Включите, если занятие отменено преподавателем'}
              </span>
            </div>
            
            {/* Custom Rock-solid Toggle Switch */}
            <div className="relative inline-flex items-center shrink-0">
              <div className={`w-11 h-6 rounded-full transition-colors relative ${isCancelled ? 'bg-red-600' : 'bg-slate-300 dark:bg-slate-700'}`}>
                <div className={`w-5 h-5 bg-white rounded-full transition-transform absolute top-[2px] shadow-sm ${isCancelled ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} />
              </div>
            </div>
          </div>

          {/* Lesson Hidden / Exclude Toggle */}
          <div 
            onClick={() => setIsHidden(!isHidden)}
            className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 cursor-pointer select-none ${
              isHidden 
                ? 'bg-amber-500/15 border-amber-500/40 dark:bg-amber-950/40 dark:border-amber-800' 
                : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/60 hover:border-amber-200 dark:hover:border-amber-900/40'
            }`}
          >
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${isHidden ? 'text-amber-700 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}`}>
                  Скрыть пару из расписания
                </span>
                {isHidden && (
                  <span className="px-1.5 py-0.5 rounded-md text-[9px] font-extrabold uppercase bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                    Скрыта
                  </span>
                )}
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                {isHidden ? 'Пара будет полностью скрыта из расписания группы' : 'Включите, чтобы удалить пару из отображения (если ее нет в учебном плане)'}
              </span>
            </div>
            
            {/* Custom Rock-solid Toggle Switch */}
            <div className="relative inline-flex items-center shrink-0">
              <div className={`w-11 h-6 rounded-full transition-colors relative ${isHidden ? 'bg-amber-600' : 'bg-slate-300 dark:bg-slate-700'}`}>
                <div className={`w-5 h-5 bg-white rounded-full transition-transform absolute top-[2px] shadow-sm ${isHidden ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} />
              </div>
            </div>
          </div>
        </form>

        {/* Fixed Footer with Safe Area */}
        <div className="p-4 border-t border-slate-200/80 dark:border-slate-800 shrink-0 flex gap-2 pb-safe bg-white dark:bg-slate-900">
          <button
            type="button"
            onClick={() => {
              onReset();
              onClose();
            }}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 font-semibold text-xs rounded-xl transition-colors min-h-[44px]"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Сбросить
          </button>

          <button
            type="button"
            onClick={() => handleSubmit()}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-200 dark:shadow-none transition-all min-h-[44px] cursor-pointer"
          >
            <Check className="w-4 h-4" /> Сохранить для группы
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditLessonModal;
