import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  BookOpen, Plus, Calendar, Clock, Paperclip, Link as LinkIcon, 
  Trash2, Edit3, X, Check, Download, AlertCircle, FileText, ExternalLink, Filter, Bookmark,
  Archive, ChevronDown
} from 'lucide-react';
import UsefulTracker from './UsefulTracker';
import { HomeworkItem, HomeworkAttachment } from '../types';
import { SCHEDULE_REGISTRY, AVAILABLE_GROUPS, getGroupTag } from '../constants';
import { getSamaraDate, getSamaraISODate, getSamaraFutureISODate } from '../attendance';
import { toast } from 'sonner';
import { fetchHomeworkSlice, pushGroupCloudData, WORKER_BASE } from '../utils/cloudSync';
import { mergeHomeworkItems } from '../utils/homeworkMerge';
import { useCloudSync } from '../utils/useCloudSync';
import { openAttachmentSafe, uploadToTelegramStorage, formatUploadedSize } from '../utils/upload';
import { safeSetItem, safeGetItem, safeRemoveItem } from '../utils/safeStorage';
import { SEED_HOMEWORK } from '../defaultData';

export const isHomeworkArchived = (dueDate: string, today: string): boolean => {
  if (!dueDate) return false;
  try {
    const dueTime = new Date(dueDate).getTime();
    const todayTime = new Date(today).getTime();
    const diffDays = (todayTime - dueTime) / (1000 * 3600 * 24);
    return diffDays > 30;
  } catch {
    return false;
  }
};

interface HomeworkTrackerProps {
  currentGroupId: string;
  userRole?: string;
  refreshTrigger?: number;
}

const HomeworkTracker: React.FC<HomeworkTrackerProps> = ({
  currentGroupId,
  userRole = 'student',
  refreshTrigger = 0
}) => {
  const canEdit = userRole.toLowerCase() === 'admin' || userRole.toLowerCase() === 'starosta';

  // Get all unique subjects for this group
  const availableSubjects = useMemo(() => {
    const subjects = new Set<string>();
    const weeks = SCHEDULE_REGISTRY[currentGroupId] || {};
    Object.values(weeks).forEach(days => {
      days.forEach(day => {
        day.lessons.forEach(l => {
          if (l.subject) subjects.add(l.subject);
        });
      });
    });
    return Array.from(subjects).sort();
  }, [currentGroupId]);

  const groupConfig = useMemo(() => {
    return AVAILABLE_GROUPS.find(g => g.id === currentGroupId);
  }, [currentGroupId]);
  const groupName = groupConfig?.name || currentGroupId;
  const groupTag = groupConfig?.name ? getGroupTag(groupConfig.name) : currentGroupId;

  // Homework items state
  const [items, setItems] = useState<HomeworkItem[]>(() => {
    try {
      const deletedIds: string[] = JSON.parse(localStorage.getItem(`deleted_hw_${currentGroupId}`) || '[]');
      const deletedSet = new Set(deletedIds);
      const saved = localStorage.getItem(`homework_${currentGroupId}`);
      if (saved !== null) {
        const local: HomeworkItem[] = JSON.parse(saved);
        return local.filter(it => it && it.id && !deletedSet.has(it.id));
      }
      const defaultList = currentGroupId === 'ingt-310' ? SEED_HOMEWORK : [];
      return defaultList.filter(it => it && it.id && !deletedSet.has(it.id));
    } catch (e) {
      return [];
    }
  });

  // Section state: Tasks or Useful
  const [activeSection, setActiveSection] = useState<'tasks' | 'useful'>('tasks');

  // Filter state
  const [filterMode, setFilterMode] = useState<'all' | 'upcoming' | 'past'>('upcoming');
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);

  // Reset subject filter when switching group so subjects from previous group don't filter out everything
  useEffect(() => {
    setSubjectFilter('all');
  }, [currentGroupId]);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<HomeworkItem | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<HomeworkAttachment | null>(null);

  // Form state
  const [formSubject, setFormSubject] = useState(availableSubjects[0] || '');
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formAssignedDate, setFormAssignedDate] = useState(getSamaraISODate());
  const [formDueDate, setFormDueDate] = useState(() => getSamaraFutureISODate(7));
  const [formAttachments, setFormAttachments] = useState<HomeworkAttachment[]>([]);
  const [linkInput, setLinkInput] = useState('');
  const [linkNameInput, setLinkNameInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const itemsRef = useRef<HomeworkItem[]>(items);

  const persistItems = (next: HomeworkItem[]) => {
    try {
      localStorage.setItem(`homework_${currentGroupId}`, JSON.stringify(next));
    } catch (e) {}
  };

  const hwPendingStore = useMemo(() => ({
    has: () => safeGetItem(`hw_pending_push_${currentGroupId}`) !== null,
    mark: () => { safeSetItem(`hw_pending_push_${currentGroupId}`, String(Date.now()), { component: 'homework' }); },
    clear: () => { safeRemoveItem(`hw_pending_push_${currentGroupId}`); }
  }), [currentGroupId]);

  const hwSync = useCloudSync<{ items: HomeworkItem[]; deletedIds: string[] }, HomeworkItem[]>({
    scope: `homework:${currentGroupId}`,
    refreshKey: `${currentGroupId}:${refreshTrigger}`,
    pendingStore: hwPendingStore,
    fetchState: ({ etag }) => fetchHomeworkSlice(currentGroupId, etag),
    mergeFn: (local, remote) => {
      const deletedSet = new Set<string>(remote.deletedIds);
      try {
        const d = JSON.parse(localStorage.getItem(`deleted_hw_${currentGroupId}`) || '[]');
        (Array.isArray(d) ? d : []).forEach((id: any) => { if (id) deletedSet.add(String(id)); });
      } catch (e) {}
      const { merged: mergedArr, hasLocalNewer } = mergeHomeworkItems<HomeworkItem>(
        remote.items,
        local,
        deletedSet,
        (it) => (it.groupId || 'ingt-310') === currentGroupId
      );
      const mergedHw = mergedArr
        .map(it => ({ ...it, groupId: currentGroupId }))
        .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
      return { state: mergedHw, hasLocalNewer };
    },
    getState: () => itemsRef.current,
    setState: (next) => {
      itemsRef.current = next;
      setItems(next);
      persistItems(next);
    },
    pushState: (state) => pushGroupCloudData({ homework: state }, currentGroupId)
  });

  const openAddModal = () => {
    setEditingItem(null);
    setFormSubject(availableSubjects[0] || '');
    setFormTitle('');
    setFormDescription('');
    setFormAssignedDate(getSamaraISODate());
    setFormDueDate(getSamaraFutureISODate(7));
    setFormAttachments([]);
    setLinkInput('');
    setLinkNameInput('');
    setIsModalOpen(true);
  };

  const openEditModal = (item: HomeworkItem) => {
    setEditingItem(item);
    setFormSubject(item.subject);
    setFormTitle(item.title);
    setFormDescription(item.description);
    setFormAssignedDate(item.assignedDate);
    setFormDueDate(item.dueDate);
    setFormAttachments(item.attachments || []);
    setLinkInput('');
    setLinkNameInput('');
    setIsModalOpen(true);
  };

  const TG_WORKER_URL = WORKER_BASE;

  const uploadFile = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) {
      toast.error('Файл слишком большой (>50 МБ). Прикрепите ссылку на Яндекс.Диск или Облако');
      return;
    }

    setIsUploading(true);
    const fileName = file.name || `screenshot_${Date.now()}.png`;
    const toastId = toast.loading(`Загружаем «${fileName}»...`);

    try {
      const groupConfig = AVAILABLE_GROUPS.find(g => g.id === currentGroupId);
      const groupName = groupConfig?.name || currentGroupId;
      const groupTag = groupConfig?.name ? getGroupTag(groupConfig.name) : currentGroupId;

      const core = await uploadToTelegramStorage(file, {
        caption: `[${groupName}] 📚 ДЗ: ${fileName} #${groupTag}`,
        maxSizeBytes: 50 * 1024 * 1024
      });

      const streamUrl = core.directUrl || (core.sig && core.exp
        ? `${TG_WORKER_URL}/file?file_id=${core.fileId}&exp=${core.exp}&sig=${core.sig}&download=1`
        : `${TG_WORKER_URL}/file?file_id=${core.fileId}`);

      setFormAttachments(prev => [
        ...prev,
        {
          name: core.fileName,
          url: streamUrl,
          tgUrl: streamUrl,
          type: file.type.startsWith('image/') ? 'image' : 'file',
          size: formatUploadedSize(file.size)
        }
      ]);

      toast.dismiss(toastId);
      toast.success(`Файл «${core.fileName}» прикреплён`);
    } catch (err: any) {
      console.error('Telegram upload error:', err);
      toast.dismiss(toastId);
      toast.error(`Не удалось сохранить в Telegram: ${err.message || 'Сбой сети'}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    if (!isModalOpen) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            uploadFile(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isModalOpen, currentGroupId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await uploadFile(files[0]);
  };

  const handleAddLink = () => {
    if (!linkInput.trim()) return;
    let url = linkInput.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    const name = linkNameInput.trim() || url;
    setFormAttachments(prev => [
      ...prev,
      {
        name,
        url,
        type: 'link'
      }
    ]);

    setLinkInput('');
    setLinkNameInput('');
    toast.success('Ссылка прикреплена');
  };

  const handleRemoveAttachment = (index: number) => {
    setFormAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSaveHomework = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSubject || !formTitle.trim()) {
      toast.error('Пожалуйста, заполните предмет и название задания');
      return;
    }

    // Always read freshest local items to prevent state loss
    let freshItems: HomeworkItem[] = [];
    try {
      const saved = localStorage.getItem(`homework_${currentGroupId}`);
      if (saved) freshItems = JSON.parse(saved);
    } catch (e) {}
    if (freshItems.length === 0 && items.length > 0) {
      freshItems = items.filter(it => it && (!it.groupId || it.groupId === currentGroupId));
    } else {
      freshItems = freshItems.filter(it => it && (!it.groupId || it.groupId === currentGroupId));
    }

    const id = editingItem ? editingItem.id : `hw_${Date.now()}`;
    const newHomework: HomeworkItem = {
      id,
      groupId: currentGroupId,
      subject: formSubject,
      title: formTitle.trim(),
      description: formDescription.trim(),
      assignedDate: formAssignedDate,
      dueDate: formDueDate,
      attachments: formAttachments,
      createdAt: editingItem ? editingItem.createdAt : new Date().toISOString(),
      updatedAt: Date.now()
    };

    const updated = editingItem 
      ? freshItems.map(it => it.id === id ? newHomework : it)
      : [...freshItems.filter(it => it.id !== id), newHomework];

    // Save locally immediately
    itemsRef.current = updated;
    setItems(updated);
    try {
      localStorage.setItem(`homework_${currentGroupId}`, JSON.stringify(updated));
    } catch (e) {}

    setIsModalOpen(false);
    toast.success(editingItem ? 'Задание обновлено' : 'Новое ДЗ опубликовано для группы!');

    hwSync.flushPush().then(ok => {
      if (!ok) {
        toast.error('Не удалось синхронизировать задание. Изменение сохранено и уедет в облако автоматически');
      } else {
        console.log('Homework synced to cloud successfully');
      }
    });
  };

  const handleDeleteHomework = async (id: string) => {
    if (!confirm('Вы уверены, что хотите удалить это домашнее задание?')) return;

    // 1. Record in tombstone list so seed and cloud polling can NEVER resurrect it!
    let deletedList: string[] = [];
    try {
      deletedList = JSON.parse(localStorage.getItem(`deleted_hw_${currentGroupId}`) || '[]');
      if (!deletedList.includes(id)) {
        deletedList.push(id);
        localStorage.setItem(`deleted_hw_${currentGroupId}`, JSON.stringify(deletedList));
      }
    } catch (e) {}

    let freshItems: HomeworkItem[] = [];
    try {
      const saved = localStorage.getItem(`homework_${currentGroupId}`);
      if (saved) freshItems = JSON.parse(saved);
    } catch (e) {}
    if (freshItems.length === 0 && items.length > 0) {
      freshItems = items.filter(it => it && (!it.groupId || it.groupId === currentGroupId));
    } else {
      freshItems = freshItems.filter(it => it && (!it.groupId || it.groupId === currentGroupId));
    }

    const updated = freshItems.filter(it => it.id !== id);
    itemsRef.current = updated;
    setItems(updated);
    try {
      localStorage.setItem(`homework_${currentGroupId}`, JSON.stringify(updated));
    } catch (e) {}

    toast.info('Задание удалено');

    hwSync.flushPush().then(ok => {
      if (!ok) {
        console.warn('Homework deletion cloud push warning');
      } else {
        console.log('Homework deletion synced to cloud successfully');
      }
    });
  };

  const handleOpenAttachment = async (att: HomeworkAttachment) => {
    // If it's a generic web link (e.g. Yandex Disk), open natively via Telegram if available
    if (att.type === 'link' && att.url && !att.tgUrl) {
      const tg = (window as any).Telegram?.WebApp;
      if (tg && typeof tg.openLink === 'function') {
        try {
          tg.openLink(att.url.trim());
          return;
        } catch (e) {}
      }
    }

    // Always open in-app preview lightbox modal!
    // This works universally across Telegram WebApp, Desktop, Mobile Web and Android without popup blocker interference!
    setPreviewAttachment(att);
  };

  // Separate active items from archived items (>30 days past due date)
  const todayISO = getSamaraISODate();

  const { activeItems, archivedItems } = useMemo(() => {
    const active: HomeworkItem[] = [];
    const archived: HomeworkItem[] = [];
    items.forEach(item => {
      // Group isolation: only show items belonging to currentGroupId
      if (item.groupId && item.groupId !== currentGroupId) {
        return;
      }

      // Subject filter
      if (subjectFilter !== 'all' && item.subject !== subjectFilter) {
        return;
      }

      if (isHomeworkArchived(item.dueDate, todayISO)) {
        archived.push(item);
      } else {
        active.push(item);
      }
    });
    return { activeItems: active, archivedItems: archived };
  }, [items, currentGroupId, subjectFilter, todayISO]);

  const filteredItems = useMemo(() => {
    return activeItems.filter(item => {
      // Date status filter
      if (filterMode === 'upcoming') {
        return item.dueDate >= todayISO;
      }
      if (filterMode === 'past') {
        return item.dueDate < todayISO;
      }
      return true;
    });
  }, [activeItems, filterMode, todayISO]);

  const getDueBadge = (dueDate: string) => {
    if (dueDate < todayISO) {
      return (
        <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
          Срок истек
        </span>
      );
    }
    if (dueDate === todayISO) {
      return (
        <span className="px-2 py-0.5 rounded-lg text-[10px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 animate-pulse">
          🔥 Дедлайн СЕГОДНЯ!
        </span>
      );
    }
    // Calculate days remaining
    const diff = Math.ceil((new Date(dueDate).getTime() - new Date(todayISO).getTime()) / (1000 * 3600 * 24));
    if (diff <= 3) {
      return (
        <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
          ⏳ Осталось {diff} {diff === 1 ? 'день' : diff < 5 ? 'дня' : 'дней'}
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        До {dueDate ? dueDate.split('-').reverse().slice(0, 2).join('.') : '—'}
      </span>
    );
  };

  return (
    <div className="space-y-5 w-full max-w-full">
      {/* Top Segmented Switch: Задания | Полезное */}
      <div className="flex bg-slate-100 dark:bg-slate-800/80 p-1 rounded-2xl w-full max-w-xs">
        <button
          type="button"
          onClick={() => setActiveSection('tasks')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-bold rounded-xl transition-all cursor-pointer ${
            activeSection === 'tasks'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Задания</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('useful')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-bold rounded-xl transition-all cursor-pointer ${
            activeSection === 'useful'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Bookmark className="w-3.5 h-3.5" />
          <span>Полезное</span>
        </button>
      </div>

      {activeSection === 'useful' ? (
        <UsefulTracker
          currentGroupId={currentGroupId}
          userRole={userRole}
          refreshTrigger={refreshTrigger}
        />
      ) : (
        <>
          {/* Top Banner & Action */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Домашние задания и дедлайны</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <p className="text-xs text-slate-400">
              Актуальные задания и подготовка к занятиям
            </p>
          </div>
        </div>

        {canEdit && (
          <button
            onClick={openAddModal}
            className="flex items-center justify-center gap-1.5 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-200 dark:shadow-none transition-all shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Добавить задание
          </button>
        )}
      </div>

      {/* Filter Chips */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        {/* Status Mode Tabs */}
        <div className="flex bg-slate-100 dark:bg-slate-800/80 p-1 rounded-2xl">
          <button
            onClick={() => setFilterMode('upcoming')}
            className={`flex-1 py-1.5 px-3 text-xs font-bold rounded-xl transition-all cursor-pointer ${
              filterMode === 'upcoming'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Актуальные ({activeItems.filter(i => i.dueDate >= todayISO).length})
          </button>
          <button
            onClick={() => setFilterMode('all')}
            className={`flex-1 py-1.5 px-3 text-xs font-bold rounded-xl transition-all cursor-pointer ${
              filterMode === 'all'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Все ({activeItems.length})
          </button>
          <button
            onClick={() => setFilterMode('past')}
            className={`flex-1 py-1.5 px-3 text-xs font-bold rounded-xl transition-all cursor-pointer ${
              filterMode === 'past'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Прошедшие ({activeItems.filter(i => i.dueDate < todayISO).length})
          </button>
        </div>

        {/* Subject Filter Dropdown */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="w-full sm:w-auto px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
          >
            <option value="all">Все предметы</option>
            {availableSubjects.map(sub => (
              <option key={sub} value={sub}>{sub}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Homework Cards List */}
      {filteredItems.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-10 text-center border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-2">
          <BookOpen className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600" />
          <h3 className="font-bold text-sm text-slate-700 dark:text-slate-300">
            {filterMode === 'upcoming' ? 'Все задания сданы! Нет горящих дедлайнов' : 'Заданий не найдено'}
          </h3>
          <p className="text-xs text-slate-400">
            {canEdit ? 'Добавьте первое задание.' : 'Заданий пока нет.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredItems.map(item => (
            <div
              key={item.id}
              className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/90 dark:border-slate-800 shadow-xs hover:shadow-sm hover:border-slate-300 dark:hover:border-slate-700 transition-all flex flex-col justify-between gap-4"
            >
              <div className="space-y-2.5">
                {/* Header: Subject & Due Badge */}
                <div className="flex items-center justify-between gap-2">
                  <div className="px-2.5 py-1 rounded-xl text-[10px] font-bold uppercase bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 truncate max-w-[70%]">
                    {item.subject}
                  </div>
                  {getDueBadge(item.dueDate)}
                </div>

                {/* Title */}
                <h3 className="font-bold text-sm text-slate-900 dark:text-white leading-snug mt-1">
                  {item.title}
                </h3>

                {/* Description */}
                {item.description && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed bg-slate-50 dark:bg-slate-800/40 p-3 rounded-2xl border border-slate-200/80 dark:border-slate-800">
                    {item.description}
                  </p>
                )}

                {/* Dates info */}
                <div className="flex items-center gap-4 text-[11px] text-slate-400 pt-1">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-slate-400" /> Выдано: {item.assignedDate ? item.assignedDate.split('-').reverse().join('.') : '—'}
                  </span>
                  <span className="flex items-center gap-1 font-semibold text-slate-600 dark:text-slate-300">
                    <Clock className="w-3 h-3 text-indigo-500" /> Сдать до: {item.dueDate ? item.dueDate.split('-').reverse().join('.') : '—'}
                  </span>
                </div>

                {/* Attachments Section */}
                {item.attachments && item.attachments.length > 0 && (
                  <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 space-y-1.5">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Прикрепленные файлы и ссылки ({item.attachments.length}):
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item.attachments.map((att, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenAttachment(att);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50/80 hover:bg-indigo-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-xl transition-all border border-indigo-100 dark:border-slate-700 active:scale-95 cursor-pointer"
                        >
                          {att.url ? (
                            <ExternalLink className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                          ) : (
                            <FileText className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                          )}
                          <span className="truncate max-w-[150px]">{att.name}</span>
                          {att.size && <span className="text-[9px] text-slate-400">({att.size})</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Starosta / Admin Controls */}
              {canEdit && (
                <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800/80 flex justify-end items-center gap-2">
                  <button
                    onClick={() => openEditModal(item)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> Изменить
                  </button>
                  <button
                    onClick={() => handleDeleteHomework(item.id)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Удалить
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Archive Section: Assignments older than 30 days */}
      {archivedItems.length > 0 && (
        <div className="mt-6 border-t border-slate-200/80 dark:border-slate-800 pt-4">
          <button
            type="button"
            onClick={() => setIsArchiveOpen(prev => !prev)}
            className="w-full flex items-center justify-between p-3.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 rounded-2xl border border-slate-200/70 dark:border-slate-700/60 transition-colors text-left cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Archive className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Архив заданий (прошлый месяц)
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                {archivedItems.length}
              </span>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
                isArchiveOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {isArchiveOpen && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 animate-in fade-in duration-200">
              {archivedItems.map(item => (
                <div
                  key={item.id}
                  className="bg-white dark:bg-slate-900 rounded-2xl p-3.5 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col justify-between gap-2.5 opacity-85 hover:opacity-100 transition-opacity"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 truncate max-w-[70%]">
                        {item.subject}
                      </span>
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                        Архив
                      </span>
                    </div>
                    <h4 className="font-semibold text-xs text-slate-800 dark:text-slate-200 leading-snug line-clamp-2">
                      {item.title}
                    </h4>
                    <div className="flex items-center gap-3 text-[10px] text-slate-400">
                      <span>Срок: {item.dueDate ? item.dueDate.split('-').reverse().join('.') : '—'}</span>
                      {item.attachments && item.attachments.length > 0 && (
                        <span className="flex items-center gap-1 text-indigo-500 dark:text-indigo-400">
                          <Paperclip className="w-2.5 h-2.5" /> {item.attachments.length}
                        </span>
                      )}
                    </div>
                  </div>

                  {canEdit && (
                    <div className="flex justify-end items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800/60">
                      <button
                        type="button"
                        onClick={() => openEditModal(item)}
                        className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                      >
                        Изменить
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteHomework(item.id)}
                        className="text-[11px] font-semibold text-red-500 hover:text-red-700 dark:hover:text-red-400 cursor-pointer"
                      >
                        Удалить
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Homework Modal (Mobile Bottom Sheet Pattern) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl max-w-lg w-full max-h-[90dvh] sm:max-h-[85vh] flex flex-col shadow-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden">
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shrink-0">
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-white">
                  {editingItem ? 'Редактировать ДЗ' : 'Новое домашнее задание'}
                </h3>
                <p className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold mt-0.5">
                  Для всей группы {AVAILABLE_GROUPS.find(g => g.id === currentGroupId)?.name || currentGroupId}
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Form Body */}
            <form id="hw-form" onSubmit={handleSaveHomework} className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Предмет
                </label>
                {availableSubjects.length > 0 ? (
                  <select
                    value={formSubject}
                    onChange={(e) => setFormSubject(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-slate-900 dark:text-white"
                    required
                  >
                    {availableSubjects.map(sub => (
                      <option key={sub} value={sub}>{sub}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="Название предмета"
                    value={formSubject}
                    onChange={(e) => setFormSubject(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-slate-900 dark:text-white"
                    required
                  />
                )}
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Тема задания
                </label>
                <input
                  type="text"
                  placeholder="Тема или номер задания"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Описание
                </label>
                <textarea
                  rows={3}
                  placeholder="Описание или требования..."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-slate-900 dark:text-white resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Дата выдачи
                  </label>
                  <input
                    type="date"
                    value={formAssignedDate}
                    onChange={(e) => setFormAssignedDate(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-slate-900 dark:text-white dark:[color-scheme:dark]"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Дедлайн (сдать до)
                  </label>
                  <input
                    type="date"
                    value={formDueDate}
                    onChange={(e) => setFormDueDate(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-slate-900 dark:text-white dark:[color-scheme:dark]"
                    required
                  />
                </div>
              </div>

              {/* Attachments list in form */}
              <div className="space-y-2 pt-2 border-t border-slate-200/80 dark:border-slate-800">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                  Файлы и ссылки
                </label>

                {formAttachments.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {formAttachments.map((att, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs"
                      >
                        <div className="flex items-center gap-2 truncate pr-2">
                          {att.url ? <ExternalLink className="w-3.5 h-3.5 text-blue-500 shrink-0" /> : <FileText className="w-3.5 h-3.5 text-indigo-500 shrink-0" />}
                          <span className="truncate text-slate-900 dark:text-slate-200">{att.name}</span>
                          {att.size && <span className="text-[10px] text-slate-400">({att.size})</span>}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(index)}
                          className="text-red-500 p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add File Button */}
                <div className="flex gap-2">
                  <label className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors min-h-[44px]">
                    <Paperclip className="w-4 h-4 text-indigo-500" />
                    <span>{isUploading ? 'Загрузка...' : 'Прикрепить файл'}</span>
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      onChange={handleFileUpload}
                      disabled={isUploading}
                    />
                  </label>
                </div>

                {/* Add Cloud Link Input */}
                <div className="flex flex-col sm:flex-row gap-1.5 pt-1">
                  <input
                    type="text"
                    placeholder="Название ссылки"
                    value={linkNameInput}
                    onChange={(e) => setLinkNameInput(e.target.value)}
                    className="sm:w-1/3 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-slate-900 dark:text-white"
                  />
                  <div className="flex flex-1 gap-1">
                    <input
                      type="text"
                      placeholder="https://..."
                      value={linkInput}
                      onChange={(e) => setLinkInput(e.target.value)}
                      className="flex-1 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none text-slate-900 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={handleAddLink}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold rounded-xl text-slate-700 dark:text-slate-300 min-h-[44px]"
                    >
                      + Ссылка
                    </button>
                  </div>
                </div>
              </div>

              {/* Primary Submit Button directly inside the form flow */}
              <div className="pt-3">
                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 py-3.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold text-sm rounded-2xl shadow-lg shadow-indigo-200 dark:shadow-none transition-all min-h-[48px]"
                >
                  <Plus className="w-5 h-5" /> {editingItem ? 'Сохранить изменения' : 'Добавить домашнее задание'}
                </button>
              </div>
            </form>

            {/* Fixed Footer with Safe Area */}
            <div className="p-4 border-t border-slate-200/80 dark:border-slate-800 shrink-0 flex gap-2 pb-safe bg-white dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold text-xs rounded-xl min-h-[44px]"
              >
                Отмена
              </button>
              <button
                type="submit"
                form="hw-form"
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-200 dark:shadow-none transition-all min-h-[44px]"
              >
                <Plus className="w-4 h-4" /> {editingItem ? 'Сохранить' : 'Добавить ДЗ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attachment Preview Modal / Lightbox (Works in Telegram WebApp & Web without download blocks) */}
      {previewAttachment && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setPreviewAttachment(null)}
        >
          <div 
            className="bg-white dark:bg-slate-900 rounded-3xl p-5 max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex justify-between items-center pb-3 border-b border-slate-200/80 dark:border-slate-800">
              <div className="flex items-center gap-2 overflow-hidden">
                <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                  {previewAttachment.name}
                </h3>
                {previewAttachment.size && (
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0">
                    {previewAttachment.size}
                  </span>
                )}
              </div>
              <button
                onClick={() => setPreviewAttachment(null)}
                className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content: Image Preview or Document Details */}
            <div className="flex-1 overflow-y-auto min-h-0 flex flex-col items-center justify-center py-2">
              {(previewAttachment.type === 'image' || previewAttachment.name.match(/\.(jpg|jpeg|png|gif|webp)$/i) || previewAttachment.data?.startsWith('data:image/')) ? (
                <div className="w-full flex items-center justify-center bg-slate-50 dark:bg-slate-950 rounded-2xl p-2 border border-slate-200/80 dark:border-slate-800">
                  <img 
                    src={previewAttachment.url || previewAttachment.data} 
                    alt={previewAttachment.name}
                    className="max-h-[60vh] max-w-full rounded-xl object-contain shadow-sm"
                    loading="lazy"
                  />
                </div>
              ) : (
                <div className="text-center py-8 space-y-3">
                  <div className="w-16 h-16 rounded-3xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mx-auto">
                    <FileText className="w-8 h-8" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-slate-800 dark:text-slate-200">
                      {previewAttachment.name}
                    </h4>
                    <p className="text-xs text-slate-400 mt-1">
                      {previewAttachment.tgUrl ? 'Файл сохранен в канале Telegram группы' : (previewAttachment.url ? 'Веб-файл / ссылка' : 'Документ задания')}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 flex flex-wrap gap-2">
              {previewAttachment.tgUrl && (
                <button
                  type="button"
                  onClick={async () => {
                    const target = previewAttachment.tgUrl;
                    if (!target) return;
                    if (target.startsWith('https://t.me/') || target.startsWith('tg://')) {
                      const tg = (window as any).Telegram?.WebApp;
                      if (tg?.openTelegramLink) tg.openTelegramLink(target);
                      else if (tg?.openLink) tg.openLink(target);
                      else window.open(target, '_blank', 'noopener,noreferrer');
                      return;
                    }
                    openAttachmentSafe(previewAttachment);
                  }}
                  className="flex-1 min-w-[140px] flex items-center justify-center gap-1.5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-bold text-xs rounded-xl transition-all shadow-sm cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4" /> В Telegram
                </button>
              )}
              {previewAttachment.url && (
                <button
                  type="button"
                  onClick={() => {
                    openAttachmentSafe(previewAttachment);
                  }}
                  className="flex-1 min-w-[140px] flex items-center justify-center gap-1.5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-all shadow-sm cursor-pointer"
                >
                  <Download className="w-4 h-4" /> Скачать файл
                </button>
              )}
              {previewAttachment.data && (
                <button
                  onClick={() => {
                    try {
                      const link = document.createElement('a');
                      link.href = previewAttachment.data!;
                      link.download = previewAttachment.name;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                      toast.success('Загрузка файла начата');
                    } catch (e) {
                      toast.info('Изображение открыто для просмотра выше');
                    }
                  }}
                  className="flex-1 min-w-[140px] flex items-center justify-center gap-1.5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-all shadow-sm"
                >
                  <Download className="w-4 h-4" /> Сохранить файл
                </button>
              )}
              <button
                onClick={() => setPreviewAttachment(null)}
                className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs rounded-xl transition-all shrink-0"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};

export default HomeworkTracker;
