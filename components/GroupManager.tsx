import React, { useState, useEffect, useMemo } from 'react';
import { Student } from '../types';
import { STUDENTS_REGISTRY } from '../attendance';
import { AVAILABLE_GROUPS } from '../constants';
import { UserPlus, Trash2, Edit2, Check, X, Users, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { fetchGroupCloudData, pushGroupCloudData } from '../utils/cloudSync';

interface GroupManagerProps {
  currentGroupId: string | null;
  userRole: 'admin' | 'starosta' | 'student';
}

const GroupManager: React.FC<GroupManagerProps> = ({ currentGroupId, userRole }) => {
  const groupConfig = useMemo(() => {
    return AVAILABLE_GROUPS.find(g => g.id === currentGroupId);
  }, [currentGroupId]);

  const getHealedStudents = (groupId: string, parsed: Student[]): Student[] => {
    if (!Array.isArray(parsed)) return STUDENTS_REGISTRY[groupId] || [];
    if (groupId === 'ingt-310' && parsed.some(s => s.name?.includes('Пронин'))) {
      const cleaned = parsed.filter(s => !s.name?.includes('Пронин'));
      try {
        localStorage.setItem(`students_ingt-310`, JSON.stringify(cleaned));
      } catch (e) {}
      return cleaned;
    }
    return parsed;
  };

  const [students, setStudents] = useState<Student[]>(() => {
    if (!currentGroupId) return [];
    const local = localStorage.getItem(`students_${currentGroupId}`);
    if (local) {
      try {
        const parsed = JSON.parse(local);
        return getHealedStudents(currentGroupId, parsed);
      } catch (e) {}
    }
    return STUDENTS_REGISTRY[currentGroupId] || [];
  });

  useEffect(() => {
    if (!currentGroupId) {
      setStudents([]);
      return;
    }
    const local = localStorage.getItem(`students_${currentGroupId}`);
    let initialStudents: Student[] = [];
    if (local) {
      try {
        const parsed = JSON.parse(local);
        initialStudents = getHealedStudents(currentGroupId, parsed);
        setStudents(initialStudents);
      } catch (e) {}
    } else {
      initialStudents = STUDENTS_REGISTRY[currentGroupId] || [];
      setStudents(initialStudents);
    }

    // Background cloud sync
    let isCancelled = false;
    fetchGroupCloudData(false, currentGroupId).then(cloudData => {
      if (isCancelled || !cloudData) return;
      if (Array.isArray(cloudData.students) && cloudData.students.length > 0) {
        const cloudStudents = getHealedStudents(currentGroupId, cloudData.students);
        setStudents(cloudStudents);
        try {
          localStorage.setItem(`students_${currentGroupId}`, JSON.stringify(cloudStudents));
        } catch (e) {}
      } else if (initialStudents.length > 0) {
        // Auto-heal: push local students to cloud if cloud has no roster yet
        pushGroupCloudData({ students: initialStudents }, currentGroupId).catch(console.warn);
      }
    }).catch(console.warn);

    return () => {
      isCancelled = true;
    };
  }, [currentGroupId]);

  const [newStudentName, setNewStudentName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');

  if (!currentGroupId) {
    return (
      <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-sm">
        <p className="text-slate-400">Выберите группу в верхней панели для управления составом.</p>
      </div>
    );
  }

  const canEdit = userRole === 'admin' || userRole === 'starosta';

  const saveStudentsToStorage = (updated: Student[]) => {
    setStudents(updated);
    if (currentGroupId) {
      try {
        localStorage.setItem(`students_${currentGroupId}`, JSON.stringify(updated));
      } catch (e) {
        console.warn('Failed to persist students to storage:', e);
      }
      pushGroupCloudData({ students: updated }, currentGroupId)
        .then(ok => {
          if (!ok) console.warn('Cloud roster sync returned false');
        })
        .catch(e => console.warn('Cloud roster sync failed:', e));
    }
  };

  const handleAddStudent = () => {
    if (!newStudentName.trim()) {
      toast.error('Введите ФИО студента');
      return;
    }
    const nextId = students.length > 0 ? Math.max(...students.map(s => s.id)) + 1 : 1;
    const newStudent: Student = {
      id: nextId,
      name: newStudentName.trim()
    };
    const updated = [...students, newStudent];
    saveStudentsToStorage(updated);
    setNewStudentName('');
    toast.success(`Студент ${newStudent.name} добавлен в группу`);
  };

  const handleDeleteStudent = (id: number, name: string) => {
    if (!window.confirm(`Удалить студента "${name}" из списка?`)) return;
    const updated = students.filter(s => s.id !== id);
    saveStudentsToStorage(updated);
    toast.info(`Студент ${name} удален`);
  };

  const handleStartEdit = (student: Student) => {
    setEditingId(student.id);
    setEditingName(student.name);
  };

  const handleSaveEdit = (id: number) => {
    if (!editingName.trim()) return;
    const updated = students.map(s => s.id === id ? { ...s, name: editingName.trim() } : s);
    saveStudentsToStorage(updated);
    setEditingId(null);
    toast.success('Данные студента обновлены');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Header Info */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-xs border border-slate-200/90 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Состав группы</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Группа: <span className="font-semibold text-indigo-600 dark:text-indigo-400">{groupConfig?.name || currentGroupId}</span> • Студентов: {students.length}
            </p>
          </div>
        </div>

        {!canEdit && (
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-xs bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 rounded-xl border border-amber-200 dark:border-amber-800">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Режим просмотра</span>
          </div>
        )}
      </div>

      {/* Add Student Form (Starosta / Admin) */}
      {canEdit && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-xs border border-slate-200/90 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Добавить студента</h3>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={newStudentName}
              onChange={(e) => setNewStudentName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddStudent()}
              placeholder="ФИО студента (например: Иванов Иван Иванович)"
              className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
            <button
              onClick={handleAddStudent}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm shrink-0"
            >
              <UserPlus className="w-4 h-4" /> Добавить
            </button>
          </div>
        </div>
      )}

      {/* Students List */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-xs border border-slate-200/90 dark:border-slate-800 overflow-hidden">
        <div className="divide-y divide-slate-200/80 dark:divide-slate-800">
          {students.map((student, index) => (
            <div
              key={student.id}
              className="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
            >
              <div className="flex items-center gap-4 flex-1 min-w-0 pr-2">
                <span className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold text-xs flex items-center justify-center shrink-0">
                  {index + 1}
                </span>

                {editingId === student.id ? (
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-indigo-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none"
                  />
                ) : (
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                    {student.name}
                  </span>
                )}
              </div>

              {canEdit && (
                <div className="flex items-center gap-1 shrink-0">
                  {editingId === student.id ? (
                    <>
                      <button
                        onClick={() => handleSaveEdit(student.id)}
                        className="p-2 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
                        title="Сохранить"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                        title="Отмена"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleStartEdit(student)}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
                        title="Редактировать"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteStudent(student.id, student.name)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        title="Удалить"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}

          {students.length === 0 && (
            <div className="p-8 text-center text-slate-400 text-sm">
              Список студентов пуст. Добавьте первого студента выше.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GroupManager;
