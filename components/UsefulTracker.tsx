import React, { useState, useEffect, useMemo } from 'react';
import {
  Pin, Search, Plus, Trash2, Edit3, X, Check,
  ExternalLink, FileText, Paperclip, Bookmark,
  BookOpen, Filter, Download, ArrowUpRight
} from 'lucide-react';
import { UsefulItem, UsefulLink, HomeworkAttachment } from '../types';
import { SCHEDULE_REGISTRY, AVAILABLE_GROUPS, getGroupTag } from '../constants';
import { toast } from 'sonner';
import { WORKER_BASE } from '../utils/cloudSync';
import { openAttachmentSafe } from '../utils/upload';
import {
  getLocalUsefulItems,
  saveLocalUsefulItems,
  recordDeletedUsefulItem,
  fetchGroupUsefulData,
  pushGroupUsefulData
} from '../utils/usefulStorage';

export interface UsefulTrackerProps {
  currentGroupId: string;
  userRole?: string;
  refreshTrigger?: number;
}

const PRESET_TAG_CHIPS = ['#все', '#закрепленные', '#лабы', '#сессия', '#контакты'];
const PRESET_FORM_TAGS = ['лабы', 'сессия', 'контакты', 'материалы', 'важное', 'ссылки'];

export const UsefulTracker: React.FC<UsefulTrackerProps> = ({
  currentGroupId,
  userRole = 'student',
  refreshTrigger = 0
}) => {
  const canEdit = userRole.toLowerCase() === 'admin' || userRole.toLowerCase() === 'starosta';

  // Group config & name
  const groupConfig = useMemo(() => {
    return AVAILABLE_GROUPS.find(g => g.id === currentGroupId);
  }, [currentGroupId]);
  const groupName = groupConfig?.name || currentGroupId;
  const groupTag = groupConfig?.name ? getGroupTag(groupConfig.name) : currentGroupId;

  // Group subjects extracted from schedule registry
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

  // Main items state initialized from localStorage
  const [items, setItems] = useState<UsefulItem[]>(() => {
    return getLocalUsefulItems(currentGroupId);
  });

  // Filter and search states
  const [activeTagFilter, setActiveTagFilter] = useState<string>('#все');
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Dynamic chips combining presets + unique tags from actual items
  const dynamicTagChips = useMemo(() => {
    const set = new Set<string>(PRESET_TAG_CHIPS);
    items.forEach(it => {
      (it.tags || []).forEach(t => {
        if (!t) return;
        const normalized = t.startsWith('#') ? t.toLowerCase() : `#${t.toLowerCase()}`;
        set.add(normalized);
      });
    });
    return Array.from(set);
  }, [items]);

  // Reset subject filter when switching group
  useEffect(() => {
    setSubjectFilter('all');
    setItems(getLocalUsefulItems(currentGroupId));
  }, [currentGroupId]);

  // Cloud sync & focus/visibility listeners
  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      const result = await fetchGroupUsefulData(currentGroupId);
      if (!isMounted) return;
      if (result.items) {
        setItems(result.items);
      }
    };

    loadData();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadData();
      }
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);

    return () => {
      isMounted = false;
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, [currentGroupId, refreshTrigger]);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<UsefulItem | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<HomeworkAttachment | null>(null);

  // Form fields
  const [formTitle, setFormTitle] = useState('');
  const [formText, setFormText] = useState('');
  const [formSubject, setFormSubject] = useState('');
  const [formTags, setFormTags] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState('');
  const [formIsPinned, setFormIsPinned] = useState(false);
  const [formLinks, setFormLinks] = useState<UsefulLink[]>([]);
  const [linkUrlInput, setLinkUrlInput] = useState('');
  const [linkTitleInput, setLinkTitleInput] = useState('');
  const [formAttachments, setFormAttachments] = useState<HomeworkAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const openAddModal = () => {
    setEditingItem(null);
    setFormTitle('');
    setFormText('');
    setFormSubject('');
    setFormTags([]);
    setCustomTagInput('');
    setFormIsPinned(false);
    setFormLinks([]);
    setLinkUrlInput('');
    setLinkTitleInput('');
    setFormAttachments([]);
    setIsModalOpen(true);
  };

  const openEditModal = (item: UsefulItem) => {
    setEditingItem(item);
    setFormTitle(item.title || '');
    setFormText(item.text || '');
    setFormSubject(item.subject || '');
    setFormTags(item.tags || []);
    setCustomTagInput('');
    setFormIsPinned(Boolean(item.isPinned));
    setFormLinks(item.links || []);
    setLinkUrlInput('');
    setLinkTitleInput('');
    setFormAttachments(item.attachments || []);
    setIsModalOpen(true);
  };

  // Tag helpers for modal
  const handleToggleTag = (tag: string) => {
    const clean = tag.toLowerCase().replace(/^#+/, '').trim();
    if (formTags.includes(clean)) {
      setFormTags(prev => prev.filter(t => t !== clean));
    } else {
      if (formTags.length >= 10) {
        toast.error('Максимум 10 тегов');
        return;
      }
      setFormTags(prev => [...prev, clean]);
    }
  };

  const handleAddCustomTag = () => {
    const clean = customTagInput.toLowerCase().replace(/^#+/, '').trim();
    if (!clean) return;
    if (clean.length > 30) {
      toast.error('Тег не должен быть длиннее 30 символов');
      return;
    }
    if (formTags.includes(clean)) {
      setCustomTagInput('');
      return;
    }
    if (formTags.length >= 10) {
      toast.error('Максимум 10 тегов');
      return;
    }
    setFormTags(prev => [...prev, clean]);
    setCustomTagInput('');
  };

  // Link helpers for modal
  const handleAddLink = () => {
    let url = linkUrlInput.trim();
    if (!url) return;
    if (!url.startsWith('https://')) {
      if (url.startsWith('http://')) {
        url = 'https://' + url.slice(7);
      } else {
        url = 'https://' + url;
      }
    }

    try {
      new URL(url);
    } catch {
      toast.error('Введите корректный URL');
      return;
    }

    if (formLinks.length >= 10) {
      toast.error('Максимум 10 ссылок');
      return;
    }

    const title = linkTitleInput.trim() || url.replace(/^https:\/\/(www\.)?/, '').slice(0, 100);
    setFormLinks(prev => [...prev, { title, url }]);
    setLinkUrlInput('');
    setLinkTitleInput('');
    toast.success('Ссылка добавлена');
  };

  const handleRemoveLink = (index: number) => {
    setFormLinks(prev => prev.filter((_, i) => i !== index));
  };

  // File upload helper
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];

    if (file.size > 20 * 1024 * 1024) {
      toast.error('Файл слишком большой (>20 МБ). Прикрепите ссылку на Яндекс.Диск или Облако');
      return;
    }

    if (formAttachments.length >= 10) {
      toast.error('Максимум 10 вложений');
      return;
    }

    setIsUploading(true);
    const toastId = toast.loading(`Загрузка «${file.name}»...`);

    try {
      const formData = new FormData();
      formData.append('document', file, file.name);
      formData.append('caption', `[${groupName}] 📌 Полезное: ${file.name} #${groupTag}`);

      const tg = (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) || null;
      const initData = tg?.initData || '';

      const res = await fetch(`${WORKER_BASE}/upload`, {
        method: 'POST',
        headers: {
          ...(initData ? { 'X-Telegram-Init-Data': initData } : {})
        },
        body: formData
      });

      if (!res.ok) {
        throw new Error(`Ошибка загрузки: статус ${res.status}`);
      }

      const json = await res.json();
      if (!json.ok || !json.result) {
        throw new Error(json.description || 'Сервер отклонил файл');
      }

      const doc = json.result.document || (json.result.photo ? json.result.photo[json.result.photo.length - 1] : null);
      const fileId = doc?.file_id;

      const streamUrl = json.direct_url || (json.sig && json.exp
        ? `${WORKER_BASE}/file?file_id=${fileId}&exp=${json.exp}&sig=${json.sig}&download=1`
        : `${WORKER_BASE}/file?file_id=${fileId}`);
      const sizeFormatted = file.size > 1024 * 1024
        ? (file.size / (1024 * 1024)).toFixed(1) + ' МБ'
        : (file.size / 1024).toFixed(0) + ' КБ';

      setFormAttachments(prev => [
        ...prev,
        {
          name: file.name,
          url: streamUrl,
          tgUrl: streamUrl,
          type: file.type.startsWith('image/') ? 'image' : 'file',
          size: sizeFormatted
        }
      ]);

      toast.dismiss(toastId);
      toast.success(`Файл «${file.name}» загружен`);
    } catch (err: any) {
      console.error('File upload error:', err);
      toast.dismiss(toastId);
      toast.error(`Не удалось загрузить файл: ${err.message || 'Сбой сети'}`);
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleRemoveAttachment = (index: number) => {
    setFormAttachments(prev => prev.filter((_, i) => i !== index));
  };

  // Save / Update Note
  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();

    const titleTrimmed = formTitle.trim().slice(0, 100);
    const textTrimmed = formText.trim().slice(0, 2000);

    if (!titleTrimmed && !textTrimmed) {
      toast.error('Заполните заголовок или текст заметки');
      return;
    }

    const id = editingItem ? editingItem.id : `useful_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const nowIso = new Date().toISOString();

    const noteToSave: UsefulItem = {
      id,
      groupId: currentGroupId.toLowerCase(),
      title: titleTrimmed,
      text: textTrimmed,
      subject: formSubject.trim() ? formSubject.trim() : undefined,
      tags: formTags,
      isPinned: formIsPinned,
      links: formLinks,
      attachments: formAttachments,
      createdAt: editingItem ? editingItem.createdAt : nowIso,
      updatedAt: editingItem ? nowIso : undefined
    };

    let updatedList: UsefulItem[];
    if (editingItem) {
      updatedList = items.map(it => it.id === editingItem.id ? noteToSave : it);
    } else {
      updatedList = [noteToSave, ...items];
    }

    // Sort: pinned first, then createdAt descending
    const sorted = updatedList.sort((a, b) => {
      if (Boolean(a.isPinned) !== Boolean(b.isPinned)) {
        return a.isPinned ? -1 : 1;
      }
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    setItems(sorted);
    saveLocalUsefulItems(currentGroupId, sorted);
    setIsModalOpen(false);
    toast.success(editingItem ? 'Заметка обновлена' : 'Заметка сохранена');

    pushGroupUsefulData(currentGroupId, sorted).then(ok => {
      if (!ok) {
        console.warn('Failed to push useful items to cloud');
      }
    });
  };

  // Delete note
  const handleDeleteNote = (id: string, title?: string) => {
    if (!canEdit) return;
    const label = title ? ` «${title}»` : '';
    if (!window.confirm(`Удалить заметку${label}?`)) return;

    recordDeletedUsefulItem(currentGroupId, id);
    const updated = items.filter(it => it.id !== id);
    setItems(updated);
    saveLocalUsefulItems(currentGroupId, updated);
    toast.success('Заметка удалена');

    pushGroupUsefulData(currentGroupId, updated).then(ok => {
      if (!ok) {
        console.warn('Failed to sync deletion to cloud');
      }
    });
  };

  // External link opener
  const handleOpenLink = (url: string) => {
    if (!url) return;
    const tg = (window as any).Telegram?.WebApp;
    if (tg && typeof tg.openLink === 'function') {
      try {
        tg.openLink(url.trim());
        return;
      } catch (e) {}
    }
    window.open(url.trim(), '_blank', 'noopener,noreferrer');
  };

  // Attachment handler
  const handleOpenAttachment = (att: HomeworkAttachment) => {
    if (att.url && !att.tgUrl && att.type === 'link') {
      handleOpenLink(att.url);
      return;
    }
    setPreviewAttachment(att);
  };

  // Date formatter
  const formatDate = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short'
      });
    } catch {
      return '';
    }
  };

  // Filtered and sorted items
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      // 1. Tag filter
      if (activeTagFilter === '#закрепленные') {
        if (!item.isPinned) return false;
      } else if (activeTagFilter !== '#все') {
        const cleanFilter = activeTagFilter.replace(/^#+/, '').toLowerCase();
        const hasTag = (item.tags || []).some(t => t.toLowerCase() === cleanFilter);
        if (!hasTag) return false;
      }

      // 2. Subject filter
      if (subjectFilter !== 'all') {
        if (item.subject !== subjectFilter) return false;
      }

      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const cleanTagQ = q.replace(/^#+/, '');
        const matchTitle = item.title?.toLowerCase().includes(q);
        const matchText = item.text?.toLowerCase().includes(q);
        const matchSubject = item.subject?.toLowerCase().includes(q);
        const matchTags = (item.tags || []).some(t => t.toLowerCase().includes(cleanTagQ));
        const matchLinks = (item.links || []).some(l =>
          l.title?.toLowerCase().includes(q) || l.url?.toLowerCase().includes(q)
        );
        if (!matchTitle && !matchText && !matchSubject && !matchTags && !matchLinks) {
          return false;
        }
      }

      return true;
    });
  }, [items, activeTagFilter, subjectFilter, searchQuery]);

  return (
    <div className="space-y-4 w-full max-w-full text-left">
      {/* Top Banner & Action */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Bookmark className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Полезные материалы и контакты</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Методички, ссылки и заметки группы <span className="font-semibold text-slate-700 dark:text-slate-300">{groupName}</span>
          </p>
        </div>

        {canEdit && (
          <button
            onClick={openAddModal}
            className="flex items-center justify-center gap-1.5 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-200 dark:shadow-none transition-all shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Добавить заметку
          </button>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="space-y-3">
        {/* Quick Tag Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {dynamicTagChips.map(chip => {
            const isActive = activeTagFilter === chip;
            return (
              <button
                key={chip}
                onClick={() => setActiveTagFilter(chip)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                {chip}
              </button>
            );
          })}
        </div>

        {/* Search input + Subject selector */}
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Поиск по заметкам, ссылкам, тегам..."
              className="w-full pl-10 pr-9 py-2 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="sm:w-60">
            <select
              value={subjectFilter}
              onChange={e => setSubjectFilter(e.target.value)}
              className="w-full py-2 px-3 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 cursor-pointer"
            >
              <option value="all">Все предметы</option>
              {availableSubjects.map(subj => (
                <option key={subj} value={subj}>{subj}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Note Feed */}
      {filteredItems.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-8 text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
            {items.length === 0 ? <Bookmark className="w-6 h-6" /> : <Filter className="w-6 h-6" />}
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {items.length === 0 ? 'Заметок пока нет' : 'Ничего не найдено'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              {items.length === 0
                ? 'Здесь староста может сохранять полезные методички, ссылки на диски, контакты преподавателей и материалы к сессии'
                : 'Попробуйте изменить поисковый запрос или сбросить фильтры'}
            </p>
          </div>
          {items.length > 0 ? (
            <button
              onClick={() => {
                setActiveTagFilter('#все');
                setSubjectFilter('all');
                setSearchQuery('');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 rounded-xl transition-all cursor-pointer"
            >
              Сбросить фильтры
            </button>
          ) : canEdit ? (
            <button
              onClick={openAddModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Добавить первую заметку
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map(item => (
            <div
              key={item.id}
              className={`bg-white dark:bg-slate-900 border rounded-2xl p-4 sm:p-5 shadow-xs transition-all ${
                item.isPinned
                  ? 'border-amber-300 dark:border-amber-700/60 bg-amber-50/20 dark:bg-amber-950/10'
                  : 'border-slate-200/90 dark:border-slate-800'
              }`}
            >
              {/* Card Header: Badges & Controls */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {item.isPinned && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300/80 dark:border-amber-800/80">
                      <Pin className="w-3 h-3 fill-current" /> Закреплено
                    </span>
                  )}
                  {item.subject && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60">
                      <BookOpen className="w-3 h-3" /> {item.subject}
                    </span>
                  )}
                  {item.createdAt && (
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 pl-1">
                      {formatDate(item.createdAt)}
                    </span>
                  )}
                </div>

                {canEdit && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => openEditModal(item)}
                      title="Редактировать"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteNote(item.id, item.title)}
                      title="Удалить"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Title */}
              {item.title && (
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white mt-2 leading-snug">
                  {item.title}
                </h3>
              )}

              {/* Text Body */}
              {item.text && (
                <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words leading-relaxed max-w-[65ch] mt-2">
                  {item.text}
                </p>
              )}

              {/* Tags */}
              {item.tags && item.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {item.tags.map(t => (
                    <button
                      key={t}
                      onClick={() => setActiveTagFilter(`#${t}`)}
                      className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                    >
                      #{t}
                    </button>
                  ))}
                </div>
              )}

              {/* Links */}
              {item.links && item.links.length > 0 && (
                <div className="space-y-1.5 mt-3">
                  {item.links.map((link, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleOpenLink(link.url)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 hover:bg-indigo-50/70 dark:bg-slate-800/60 dark:hover:bg-slate-800 border border-slate-200/70 dark:border-slate-700/60 text-left transition-colors group cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ArrowUpRight className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                          {link.title || link.url}
                        </span>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              {/* Attachments */}
              {item.attachments && item.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {item.attachments.map((att, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleOpenAttachment(att)}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 border border-slate-200/70 dark:border-slate-700/60 text-xs text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                    >
                      {att.type === 'image' ? (
                        <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      ) : (
                        <Paperclip className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                      )}
                      <span className="truncate max-w-[160px] font-medium">{att.name}</span>
                      {att.size && <span className="text-[10px] text-slate-400">({att.size})</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl w-full max-w-lg p-5 sm:p-6 shadow-xl space-y-4 my-8 text-left">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {editingItem ? 'Редактирование заметки' : 'Новая заметка'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveNote} className="space-y-4">
              {/* Title */}
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  <label htmlFor="useful-title">Заголовок</label>
                  <span className="text-[11px] text-slate-400 font-normal">
                    {formTitle.length}/100
                  </span>
                </div>
                <input
                  id="useful-title"
                  type="text"
                  maxLength={100}
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder="Например: Методичка по физике или Чат группы"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>

              {/* Text */}
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  <label htmlFor="useful-text">Текст заметки</label>
                  <span className="text-[11px] text-slate-400 font-normal">
                    {formText.length}/2000
                  </span>
                </div>
                <textarea
                  id="useful-text"
                  rows={4}
                  maxLength={2000}
                  value={formText}
                  onChange={e => setFormText(e.target.value)}
                  placeholder="Пояснения, требования к сдаче лаб, расписание консультаций..."
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 resize-none leading-relaxed"
                />
              </div>

              {/* Subject Selection */}
              <div>
                <label htmlFor="useful-subject" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Привязка к предмету (необязательно)
                </label>
                <select
                  id="useful-subject"
                  value={formSubject}
                  onChange={e => setFormSubject(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 cursor-pointer"
                >
                  <option value="">Без привязки к предмету</option>
                  {availableSubjects.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {/* Tags */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Теги ({formTags.length}/10)
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {PRESET_FORM_TAGS.map(t => {
                    const isSelected = formTags.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => handleToggleTag(t)}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        #{t}
                      </button>
                    );
                  })}
                </div>

                {/* Custom tag input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customTagInput}
                    onChange={e => setCustomTagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustomTag();
                      }
                    }}
                    placeholder="Свой тег..."
                    className="flex-1 px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomTag}
                    className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-xl transition-all cursor-pointer"
                  >
                    +
                  </button>
                </div>

                {/* Active tags list */}
                {formTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {formTags.map(t => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/50"
                      >
                        #{t}
                        <button
                          type="button"
                          onClick={() => handleToggleTag(t)}
                          className="hover:text-red-600 dark:hover:text-red-400 p-0.5"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Links */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Ссылки ({formLinks.length}/10)
                </label>
                <div className="space-y-2">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={linkTitleInput}
                      onChange={e => setLinkTitleInput(e.target.value)}
                      placeholder="Название (напр. Яндекс.Диск)"
                      className="sm:w-1/3 px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    />
                    <div className="flex-1 flex gap-2">
                      <input
                        type="url"
                        value={linkUrlInput}
                        onChange={e => setLinkUrlInput(e.target.value)}
                        placeholder="https://..."
                        className="flex-1 px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                      />
                      <button
                        type="button"
                        onClick={handleAddLink}
                        className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-300 text-xs font-semibold rounded-xl transition-all cursor-pointer shrink-0"
                      >
                        Добавить
                      </button>
                    </div>
                  </div>

                  {formLinks.length > 0 && (
                    <div className="space-y-1 mt-2">
                      {formLinks.map((link, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 text-xs"
                        >
                          <span className="truncate text-slate-800 dark:text-slate-200 font-medium">
                            {link.title} ({link.url})
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveLink(idx)}
                            className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 p-0.5"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Attachments */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Вложения (файлы / фото до 20 МБ, максимум 10)
                </label>
                <div className="flex items-center gap-2">
                  <label className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isUploading
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                  }`}>
                    <Paperclip className="w-4 h-4" />
                    <span>{isUploading ? 'Загрузка...' : 'Выбрать файл'}</span>
                    <input
                      type="file"
                      disabled={isUploading || formAttachments.length >= 10}
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                  <span className="text-[11px] text-slate-400">
                    Прикреплено: {formAttachments.length}
                  </span>
                </div>

                {formAttachments.length > 0 && (
                  <div className="space-y-1 mt-2">
                    {formAttachments.map((att, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 text-xs"
                      >
                        <span className="truncate text-slate-800 dark:text-slate-200 font-medium">
                          {att.name} {att.size && `(${att.size})`}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(idx)}
                          className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 p-0.5"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pin Checkbox */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  id="useful-pinned"
                  type="checkbox"
                  checked={formIsPinned}
                  onChange={e => setFormIsPinned(e.target.checked)}
                  className="w-4 h-4 rounded-md text-indigo-600 focus:ring-indigo-500/30 border-slate-300 dark:border-slate-700 dark:bg-slate-800 cursor-pointer"
                />
                <label htmlFor="useful-pinned" className="text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                  Закрепить наверху списка
                </label>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-xl transition-all cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isUploading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
                >
                  {editingItem ? 'Сохранить изменения' : 'Создать заметку'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Attachment Lightbox / Preview Modal */}
      {previewAttachment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl max-w-lg w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                {previewAttachment.name}
              </span>
              <button
                onClick={() => setPreviewAttachment(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {previewAttachment.type === 'image' && (previewAttachment.url || previewAttachment.tgUrl) ? (
              <div className="max-h-[60vh] overflow-auto rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <img
                  src={previewAttachment.url || previewAttachment.tgUrl}
                  alt={previewAttachment.name}
                  className="max-h-[55vh] object-contain rounded-xl"
                />
              </div>
            ) : (
              <div className="p-6 text-center space-y-2">
                <FileText className="w-12 h-12 mx-auto text-indigo-600 dark:text-indigo-400" />
                <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                  Файл готов к скачиванию
                </p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              {previewAttachment.url && (
                <button
                  type="button"
                  onClick={() => {
                    openAttachmentSafe(previewAttachment);
                    setPreviewAttachment(null);
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4" /> Скачать / Открыть
                </button>
              )}
              <button
                type="button"
                onClick={() => setPreviewAttachment(null)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-xl transition-all cursor-pointer"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UsefulTracker;
