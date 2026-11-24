import React, { useState } from 'react';
import { Calendar, Clock, MapPin, User, Plus, Edit2, Trash2, GraduationCap, X, Check } from 'lucide-react';
import { ExamItem, ExamType, UserRole } from '../types';
import { toast } from 'sonner';

interface ExamScheduleViewProps {
  currentGroupId: string;
  userRole?: UserRole;
  exams: ExamItem[];
  onSaveExam: (exam: ExamItem) => Promise<void>;
  onDeleteExam: (examId: string) => Promise<void>;
  isSessionActive?: boolean;
}

const EXAM_TYPE_STYLES: Record<ExamType, { bg: string; text: string; border: string }> = {
  'Экзамен': {
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    text: 'text-rose-700 dark:text-rose-300',
    border: 'border-rose-200 dark:border-rose-800/60'
  },
  'Консультация': {
    bg: 'bg-sky-50 dark:bg-sky-950/40',
    text: 'text-sky-700 dark:text-sky-300',
    border: 'border-sky-200 dark:border-sky-800/60'
  },
  'Зачёт': {
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-200 dark:border-amber-800/60'
  },
  'Диф. зачёт': {
    bg: 'bg-purple-50 dark:bg-purple-950/40',
    text: 'text-purple-700 dark:text-purple-300',
    border: 'border-purple-200 dark:border-purple-800/60'
  }
};

const RU_MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

const RU_DAYS = [
  'Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'
];

function formatExamDate(dateStr: string): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr || '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const dayOfWeek = RU_DAYS[dateObj.getDay()];
  const monthName = RU_MONTHS[m - 1];
  return `${d} ${monthName} ${y} г. (${dayOfWeek})`;
}

export const ExamScheduleView: React.FC<ExamScheduleViewProps> = ({
  currentGroupId,
  userRole = 'student',
  exams = [],
  onSaveExam,
  onDeleteExam,
  isSessionActive = false
}) => {
  const canEdit = userRole === 'admin' || userRole === 'starosta';

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExam, setEditingExam] = useState<ExamItem | null>(null);

  // Form states
  const [formDate, setFormDate] = useState('');
  const [formTime, setFormTime] = useState('09:00');
  const [formSubject, setFormSubject] = useState('');
  const [formType, setFormType] = useState<ExamType>('Экзамен');
  const [formLocation, setFormLocation] = useState('');
  const [formTeacher, setFormTeacher] = useState('');
  const [formNote, setFormNote] = useState('');

  const openAddModal = () => {
    setEditingExam(null);
    setFormDate('');
    setFormTime('09:00');
    setFormSubject('');
    setFormType('Экзамен');
    setFormLocation('');
    setFormTeacher('');
    setFormNote('');
    setIsModalOpen(true);
  };

  const openEditModal = (exam: ExamItem) => {
    setEditingExam(exam);
    setFormDate(exam.date);
    setFormTime(exam.time || '09:00');
    setFormSubject(exam.subject);
    setFormType(exam.type || 'Экзамен');
    setFormLocation(exam.location || '');
    setFormTeacher(exam.teacher || '');
    setFormNote(exam.note || '');
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSubject.trim()) {
      toast.error('Укажите название предмета');
      return;
    }
    if (!formDate.trim()) {
      toast.error('Выберите дату');
      return;
    }

    const examItem: ExamItem = {
      id: editingExam?.id || `ex_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      date: formDate.trim(),
      time: formTime.trim() || '09:00',
      subject: formSubject.trim(),
      type: formType,
      location: formLocation.trim() || 'Уточняется',
      teacher: formTeacher.trim() || undefined,
      note: formNote.trim() || undefined,
      updatedAt: Date.now()
    };

    try {
      await onSaveExam(examItem);
      setIsModalOpen(false);
      toast.success(editingExam ? 'Экзамен обновлён' : 'Экзамен добавлен');
    } catch {
      toast.error('Не удалось сохранить экзамен');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Удалить этот экзамен из расписания группы?')) return;
    try {
      await onDeleteExam(id);
      toast.success('Экзамен удалён');
    } catch {
      toast.error('Не удалось удалить экзамен');
    }
  };

  // Sort exams chronologically
  const sortedExams = [...exams].sort((a, b) => {
    const dDiff = (a.date || '').localeCompare(b.date || '');
    if (dDiff !== 0) return dDiff;
    return (a.time || '').localeCompare(b.time || '');
  });

  return (
    <div className="space-y-6">
      {/* Header and session status */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              Расписание экзаменов и сессии
              {isSessionActive && (
                <span className="px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                  Сессия идёт
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Экзамены, зачёты и консультации группы
            </p>
          </div>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={openAddModal}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Добавить экзамен
          </button>
        )}
      </div>

      {/* Exams list */}
      {sortedExams.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
          <div className="text-3xl">📅</div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
            Расписание сессии пока не заполнено
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
            {canEdit
              ? 'Нажмите кнопку «Добавить экзамен», чтобы внести даты экзаменов, зачётов и консультаций для всей группы.'
              : 'Староста группы добавит даты экзаменов, аудитории и время консультаций, когда они станут известны.'}
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors cursor-pointer mt-2"
            >
              <Plus className="w-4 h-4" />
              Добавить первый экзамен
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sortedExams.map(exam => {
            const style = EXAM_TYPE_STYLES[exam.type] || EXAM_TYPE_STYLES['Экзамен'];
            return (
              <div
                key={exam.id}
                className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/90 dark:border-slate-800 shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition-all space-y-3 relative flex flex-col justify-between"
              >
                <div className="space-y-3">
                  {/* Top row: badge + date/time */}
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border ${style.bg} ${style.text} ${style.border}`}
                    >
                      {exam.type}
                    </span>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>{exam.time}</span>
                    </div>
                  </div>

                  {/* Subject Title */}
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                    {exam.subject}
                  </h3>

                  {/* Details metadata */}
                  <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400 pt-1">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{formatExamDate(exam.date)}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{exam.location || 'Аудитория уточняется'}</span>
                    </div>

                    {exam.teacher && (
                      <div className="flex items-center gap-2">
                        <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{exam.teacher}</span>
                      </div>
                    )}

                    {exam.note && (
                      <div className="mt-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 text-[11px] text-slate-700 dark:text-slate-300">
                        {exam.note}
                      </div>
                    )}
                  </div>
                </div>

                {/* Starosta Edit/Delete controls */}
                {canEdit && (
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => openEditModal(exam)}
                      className="p-1.5 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      title="Редактировать"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(exam.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      title="Удалить"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Add / Edit Form */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {editingExam ? 'Редактировать экзамен' : 'Добавить экзамен или зачёт'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Предмет *
                </label>
                <input
                  type="text"
                  required
                  placeholder="например, Высшая математика"
                  value={formSubject}
                  onChange={e => setFormSubject(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Тип события
                  </label>
                  <select
                    value={formType}
                    onChange={e => setFormType(e.target.value as ExamType)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                  >
                    <option value="Экзамен">Экзамен</option>
                    <option value="Консультация">Консультация</option>
                    <option value="Зачёт">Зачёт</option>
                    <option value="Диф. зачёт">Диф. зачёт</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Время начала
                  </label>
                  <input
                    type="time"
                    value={formTime}
                    onChange={e => setFormTime(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Дата *
                  </label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={e => setFormDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white dark:[color-scheme:dark]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Корпус и аудитория
                  </label>
                  <input
                    type="text"
                    placeholder="Корпус № 1, 412"
                    value={formLocation}
                    onChange={e => setFormLocation(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Преподаватель
                </label>
                <input
                  type="text"
                  placeholder="ФИО преподавателя"
                  value={formTeacher}
                  onChange={e => setFormTeacher(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Заметка / темы к подготовке (необязательно)
                </label>
                <textarea
                  rows={2}
                  placeholder="Билеты, вопросы, допуск к экзамену..."
                  value={formNote}
                  onChange={e => setFormNote(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExamScheduleView;
