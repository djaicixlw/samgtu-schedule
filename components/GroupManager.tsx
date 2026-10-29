import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Student } from '../types';
import { STUDENTS_REGISTRY } from '../attendance';
import { AVAILABLE_GROUPS } from '../constants';
import { UserPlus, Trash2, Edit2, Check, X, Users, AlertCircle, Download, Upload, Key, Copy, Loader2, FileText, Clipboard, Send, Bot, RotateCcw, Archive, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { uploadAttachmentFile } from '../utils/upload';
import {
  getLocalStudents,
  saveLocalStudents,
  ensureGroupSlots,
  exportRosterBackup,
  importRosterBackup,
  createGroupInvites,
  registerSlotsWithServer,
  publishInvitesWithServer,
  StudentInvite,
  syncRosterToCloud
} from '../utils/attendanceStorage';

interface GroupManagerProps {
  currentGroupId: string | null;
  userRole: 'admin' | 'starosta' | 'student';
}

const GroupManager: React.FC<GroupManagerProps> = ({ currentGroupId, userRole }) => {
  const groupConfig = useMemo(() => {
    return AVAILABLE_GROUPS.find(g => g.id === currentGroupId);
  }, [currentGroupId]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isLoadingInvites, setIsLoadingInvites] = useState(false);
  const [invites, setInvites] = useState<StudentInvite[]>([]);
  const [isTextImportModalOpen, setIsTextImportModalOpen] = useState(false);
  const [textBackupInput, setTextBackupInput] = useState('');

  const loadInitialStudents = (groupId: string): Student[] => {
    if (!groupId) return [];
    const local = getLocalStudents(groupId);
    const raw = local.length > 0 ? local : (STUDENTS_REGISTRY[groupId] || []);
    const isAllDummy = raw.length > 0 && raw.every(s => /^Студент\s+\d+$/i.test(s.name.trim()));
    if (isAllDummy && local.length === 0) {
      return [];
    }
    return ensureGroupSlots(groupId, raw);
  };

  const [students, setStudents] = useState<Student[]>(() => {
    return currentGroupId ? loadInitialStudents(currentGroupId) : [];
  });

  useEffect(() => {
    if (!currentGroupId) {
      setStudents([]);
      return;
    }
    const initial = loadInitialStudents(currentGroupId);
    setStudents(initial);
  }, [currentGroupId]);

  const [newStudentName, setNewStudentName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isSendingToBot, setIsSendingToBot] = useState(false);
  const [isArchiveExpanded, setIsArchiveExpanded] = useState(false);

  const activeStudents = useMemo(() => {
    return students
      .filter(s => !s.isArchived)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [students]);

  const archivedStudents = useMemo(() => {
    return students
      .filter(s => !!s.isArchived)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [students]);

  const canEdit = userRole === 'admin' || userRole === 'starosta';

  const saveStudentsToStorage = (updated: Student[]) => {
    if (!currentGroupId) return;
    const slotted = ensureGroupSlots(currentGroupId, updated);
    saveLocalStudents(currentGroupId, slotted);
    setStudents(slotted);
    syncRosterToCloud(currentGroupId, slotted).catch(() => {});
  };

  const handleDownloadBackup = () => {
    if (!currentGroupId) return;
    try {
      const blob = new Blob([exportRosterBackup(currentGroupId)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `roster_${currentGroupId}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Файл списка сохранен');
    } catch (err: any) {
      toast.error('Ошибка сохранения: ' + (err?.message || String(err)));
    }
  };

  const handleRestoreBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentGroupId) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content !== 'string') {
        toast.error('Не удалось прочитать файл');
        return;
      }
      const res = importRosterBackup(currentGroupId, content);
      if (res.ok) {
        const restored = getLocalStudents(currentGroupId);
        setStudents(restored);
        syncRosterToCloud(currentGroupId, restored).catch(() => {});
        toast.success(`Список успешно восстановлен (${res.count ?? 0} студентов)`);
      } else {
        toast.error(`Ошибка восстановления: ${res.error}`);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.onerror = () => {
      toast.error('Ошибка чтения файла');
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const handleSendToBot = async () => {
    if (!currentGroupId) return;
    if (activeStudents.length === 0) {
      toast.error('Список студентов пуст');
      return;
    }

    setIsSendingToBot(true);
    try {
      const groupName = groupConfig?.name || currentGroupId;
      const lines = [
        `📋 Список группы ${groupName}`,
        `Всего активных студентов: ${activeStudents.length}`,
        `Дата выгрузки: ${new Date().toLocaleDateString('ru-RU')}`,
        '',
        ...activeStudents.map((s, idx) => `${idx + 1}. ${s.name}`)
      ];

      if (archivedStudents.length > 0) {
        lines.push('');
        lines.push(`Выбывшие студенты (${archivedStudents.length}):`);
        archivedStudents.forEach((s, idx) => {
          lines.push(`${idx + 1}. ${s.name}`);
        });
      }

      const content = lines.join('\n');
      const filename = `spisok_gruppy_${currentGroupId}.txt`;
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const file = typeof File !== 'undefined'
        ? new File([blob], filename, { type: 'text/plain;charset=utf-8' })
        : Object.assign(blob, { name: filename, lastModified: Date.now() }) as any;

      await uploadAttachmentFile(file, `📋 Список группы ${groupName} (${activeStudents.length} студентов)`);
      toast.success('Список группы отправлен в чат с ботом');
    } catch (err: any) {
      console.warn('Failed to upload roster to bot:', err);
      const msg = err?.message || String(err);
      if (msg.includes('chat not found') || msg.includes('401')) {
        toast.error('Откройте приложение внутри Telegram через бота, чтобы получать файлы в чат');
      } else {
        toast.error(`Не удалось отправить список в бота: ${msg}`);
      }
    } finally {
      setIsSendingToBot(false);
    }
  };

  const handleCopyBackupList = async () => {
    if (!currentGroupId) return;
    try {
      const data = exportRosterBackup(currentGroupId);
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(data);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = data;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      toast.success('Список скопирован в буфер обмена');
    } catch (err: any) {
      toast.error('Не удалось скопировать список: ' + (err?.message || String(err)));
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        const text = await navigator.clipboard.readText();
        if (!text || !text.trim()) {
          toast.warning('Буфер обмена пуст');
          return;
        }
        setTextBackupInput(text.trim());
        toast.success('Текст вставлен из буфера обмена');
      } else {
        toast.info('Автоматическая вставка недоступна — вставьте текст в поле ниже вручную');
      }
    } catch {
      toast.info('Нет доступа к чтению буфера обмена — вставьте текст в поле ниже вручную');
    }
  };

  const handleOpenTextImportModal = async () => {
    setTextBackupInput('');
    setIsTextImportModalOpen(true);
    try {
      if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        const text = await navigator.clipboard.readText();
        if (text && (text.trim().startsWith('{') || text.trim().startsWith('['))) {
          setTextBackupInput(text.trim());
          toast.info('Список автоматически подставлен из буфера обмена');
        }
      }
    } catch {
      // Permission denied or blocked in WebView, user can paste manually
    }
  };

  const handleApplyTextImport = () => {
    if (!currentGroupId) return;
    if (!textBackupInput.trim()) {
      toast.error('Вставьте или введите список группы');
      return;
    }
    const res = importRosterBackup(currentGroupId, textBackupInput);
    if (res.ok) {
      const restored = getLocalStudents(currentGroupId);
      setStudents(restored);
      syncRosterToCloud(currentGroupId, restored).catch(() => {});
      toast.success(`Список успешно восстановлен (${res.count ?? 0} студентов)`);
      setIsTextImportModalOpen(false);
      setTextBackupInput('');
    } else {
      toast.error(`Ошибка восстановления: ${res.error}`);
    }
  };

  const handleOpenInvites = async () => {
    if (!currentGroupId) return;
    if (activeStudents.length === 0) {
      toast.error('Список студентов пуст');
      return;
    }
    setIsInviteModalOpen(true);
    setIsLoadingInvites(true);
    try {
      const generated = await createGroupInvites(currentGroupId, activeStudents);
      setInvites(generated);
      const refreshed = getLocalStudents(currentGroupId);
      if (refreshed.length > 0) setStudents(refreshed);

      const [slotRes, inviteRes] = await Promise.all([
        registerSlotsWithServer(currentGroupId, generated.map(inv => inv.slot)),
        publishInvitesWithServer(currentGroupId, generated.map(inv => ({ slot: inv.slot, hash: inv.hash })))
      ]);

      if (slotRes.ok && inviteRes.ok) {
        toast.success('Коды приглашений сгенерированы и зарегистрированы на сервере!');
      } else {
        const errMsg = slotRes.error || inviteRes.error || 'Сервер недоступен';
        toast.warning(`Коды сформированы локально (сервер: ${errMsg})`);
      }
    } catch (err: any) {
      toast.error('Ошибка создания кодов: ' + (err?.message || String(err)));
    } finally {
      setIsLoadingInvites(false);
    }
  };

  const handleCopyAllCodes = () => {
    if (invites.length === 0) return;
    const lines = invites.map((inv, idx) => {
      const stu = activeStudents.find(s => s.id === inv.studentId);
      return `${idx + 1}. ${stu?.name || `Студент #${inv.studentId}`} — ${inv.code}`;
    });
    navigator.clipboard.writeText(`Коды приглашений (${groupConfig?.name || currentGroupId}):\n` + lines.join('\n'))
      .then(() => toast.success('Все коды приглашений скопированы в буфер обмена'))
      .catch(() => toast.error('Не удалось скопировать коды'));
  };

  const handleCopySingleCode = (code: string, name: string) => {
    navigator.clipboard.writeText(code)
      .then(() => toast.success(`Код для "${name}" скопирован`))
      .catch(() => toast.error('Не удалось скопировать код'));
  };

  if (!currentGroupId) {
    return (
      <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-sm">
        <p className="text-slate-400">Выберите группу в верхней панели для управления составом.</p>
      </div>
    );
  }

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
    if (!window.confirm(`Перевести студента "${name}" в архив выбывших?\n\nСтудент перестанет отображаться в текущих занятиях и матрице, но его история посещений сохранится.`)) return;
    const updated = students.map(s => s.id === id ? { ...s, isArchived: true } : s);
    saveStudentsToStorage(updated);
    toast.info(`Студент ${name} переведен в архив выбывших`);
  };

  const handleRestoreStudent = (id: number, name: string) => {
    const updated = students.map(s => s.id === id ? { ...s, isArchived: false } : s);
    saveStudentsToStorage(updated);
    toast.success(`Студент ${name} восстановлен в активный список`);
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
              Студентов в списке: <span className="font-semibold text-indigo-600 dark:text-indigo-400">{activeStudents.length}</span>{archivedStudents.length > 0 ? ` (в архиве: ${archivedStudents.length})` : ''}
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

      {/* Backup and Invites Toolbar (Starosta / Admin) */}
      {canEdit && (
        <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl shadow-xs border border-slate-200/90 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Резервная копия и инвайты</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <button onClick={handleDownloadBackup} className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer" title="Сохранить файл со списком группы">
              <Download className="w-3.5 h-3.5" /><span>Сохранить файл</span>
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer" title="Восстановить список из файла">
              <Upload className="w-3.5 h-3.5" /><span>Восстановить из файла</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleRestoreBackup}
              className="hidden"
            />
            <button
              onClick={handleSendToBot}
              disabled={isSendingToBot}
              className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
              title="Отправить список в бота"
            >
              {isSendingToBot ? <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" /> : <Send className="w-3.5 h-3.5" />}
              <span>{isSendingToBot ? 'Отправка...' : 'Отправить в бота'}</span>
            </button>
            <button onClick={handleCopyBackupList} className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer" title="Скопировать список в буфер обмена">
              <Copy className="w-3.5 h-3.5" /><span>Скопировать список</span>
            </button>
            <button onClick={handleOpenTextImportModal} className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer" title="Вставить список из буфера обмена">
              <FileText className="w-3.5 h-3.5" /><span>Вставить список</span>
            </button>
            <button onClick={handleOpenInvites} className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-colors shadow-xs cursor-pointer" title="Коды приглашений для студентов">
              <Key className="w-3.5 h-3.5" /><span>Коды приглашений</span>
            </button>
          </div>
        </div>
      )}

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

      {/* Active Students List */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-xs border border-slate-200/90 dark:border-slate-800 overflow-hidden">
        <div className="divide-y divide-slate-200/80 dark:divide-slate-800">
          {activeStudents.map((student, index) => (
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
                  <div className="flex flex-col items-start min-w-0">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate max-w-full">
                      {student.name}
                    </span>
                    {student.slot && (
                      <span className="mt-1 font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60 select-all shrink-0">
                        слот: {student.slot}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {canEdit && (
                <div className="flex items-center gap-1 shrink-0">
                  {editingId === student.id ? (
                    <>
                      <button
                        onClick={() => handleSaveEdit(student.id)}
                        className="p-2 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors cursor-pointer"
                        title="Сохранить"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                        title="Отмена"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleStartEdit(student)}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors cursor-pointer"
                        title="Редактировать"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteStudent(student.id, student.name)}
                        className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors cursor-pointer"
                        title="Перевести в архив выбывших"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}

          {activeStudents.length === 0 && (
            <div className="p-8 text-center text-slate-400 text-sm">
              Список студентов пуст. Добавьте первого студента выше.
            </div>
          )}
        </div>
      </div>

      {/* Collapsible Archived Students Section (Requirement №12) */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-xs border border-slate-200/90 dark:border-slate-800 overflow-hidden">
        <button
          type="button"
          onClick={() => setIsArchiveExpanded(prev => !prev)}
          className="w-full flex items-center justify-between p-5 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors text-left cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0">
              <Archive className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Выбывшие студенты ({archivedStudents.length})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Архив выбывших студентов. История посещаемости за прошлые месяцы сохранена.
              </p>
            </div>
          </div>
          <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform duration-200 ${isArchiveExpanded ? 'rotate-180' : ''}`} />
        </button>

        {isArchiveExpanded && (
          <div className="border-t border-slate-200/80 dark:border-slate-800 divide-y divide-slate-200/80 dark:divide-slate-800">
            {archivedStudents.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                Архив выбывших студентов пуст. При нажатии на иконку удаления студент перемещается сюда.
              </div>
            ) : (
              archivedStudents.map((student, idx) => (
                <div
                  key={student.id}
                  className="flex items-center justify-between p-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 pr-2">
                    <span className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 text-xs font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-600 dark:text-slate-400 line-through truncate">
                          {student.name}
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200/50 dark:border-amber-800/50 shrink-0">
                          в архиве
                        </span>
                      </div>
                      {student.slot && (
                        <span className="font-mono text-[10px] text-slate-400">
                          слот: {student.slot}
                        </span>
                      )}
                    </div>
                  </div>

                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => handleRestoreStudent(student.id, student.name)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 transition-colors shrink-0 cursor-pointer"
                      title="Восстановить в активный список"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Восстановить</span>
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Student Invites Modal */}
      {isInviteModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400"><Key className="w-5 h-5" /></div>
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">Коды приглашений для студентов</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Группа: {groupConfig?.name || currentGroupId}</p>
                </div>
              </div>
              <button onClick={() => setIsInviteModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl transition-colors cursor-pointer"><X className="w-5 h-5" /></button>
            </div>

            <div className="text-xs bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200/80 dark:border-slate-700/60 text-slate-600 dark:text-slate-300 leading-relaxed">
              🔒 <strong>Конфиденциальность:</strong> Сервер сохраняет только анонимные хеши кодов и слоты. ФИО студентов хранятся исключительно на вашем устройстве и никогда не отправляются в облако.
            </div>

            {isLoadingInvites ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-500">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                <span className="text-xs">Генерация инвайтов и регистрация слотов на сервере...</span>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center pt-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Всего инвайтов: {invites.length}</span>
                  <button onClick={handleCopyAllCodes} className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors cursor-pointer">
                    <Copy className="w-3.5 h-3.5" /><span>Скопировать все коды</span>
                  </button>
                </div>

                <div className="max-h-[50vh] overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-2xl">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-bold sticky top-0">
                      <tr><th className="p-3">#</th><th className="p-3">Студент</th><th className="p-3">Слот</th><th className="p-3">Код приглашения</th><th className="p-3 text-right">Копировать</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800">
                      {invites.map((inv, idx) => {
                        const stu = students.find(s => s.id === inv.studentId);
                        const stuName = stu?.name || `Студент #${inv.studentId}`;
                        return (
                          <tr key={inv.slot} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="p-3 font-semibold text-slate-400">{idx + 1}</td>
                            <td className="p-3 font-medium text-slate-900 dark:text-white">{stuName}</td>
                            <td className="p-3 font-mono text-[11px] text-indigo-600 dark:text-indigo-400">{inv.slot}</td>
                            <td className="p-3 font-mono text-xs font-bold text-slate-800 dark:text-slate-200 select-all">{inv.code}</td>
                            <td className="p-3 text-right">
                              <button onClick={() => handleCopySingleCode(inv.code, stuName)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-colors cursor-pointer" title="Скопировать код студента">
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="flex justify-end pt-2">
              <button onClick={() => setIsInviteModalOpen(false)} className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer">
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Text / Clipboard Import Modal */}
      {isTextImportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">Импорт через текст / буфер</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Группа: {groupConfig?.name || currentGroupId}</p>
                </div>
              </div>
              <button
                onClick={() => setIsTextImportModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Вставьте скопированный список группы. Этот способ удобен на смартфонах в Telegram Mini App, если проводник не отображает файлы резервной копии.
            </p>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Текст списка:</label>
                <button
                  type="button"
                  onClick={handlePasteFromClipboard}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 transition-colors cursor-pointer"
                >
                  <Clipboard className="w-3.5 h-3.5" />
                  <span>Вставить из буфера</span>
                </button>
              </div>

              <textarea
                value={textBackupInput}
                onChange={(e) => setTextBackupInput(e.target.value)}
                placeholder="Вставьте список студентов: обычный текст (1. Иванов Иван...) или файл резервной копии..."
                rows={8}
                className="w-full p-3 font-mono text-xs rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-y"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsTextImportModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleApplyTextImport}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Применить</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GroupManager;
