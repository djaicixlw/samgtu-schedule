import React from 'react';
import { Shield, X, EyeOff, Lock, Trash2, HelpCircle, UserCheck } from 'lucide-react';

interface PrivacyPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PrivacyPolicyModal: React.FC<PrivacyPolicyModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl max-w-lg w-full max-h-[92dvh] sm:max-h-[85vh] flex flex-col shadow-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white leading-tight">
                Конфиденциальность
              </h3>
              <p className="text-xs text-slate-400">
                Как устроена защита ваших данных
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 flex-1 min-h-0 overflow-y-auto space-y-4 text-xs text-slate-700 dark:text-slate-300 leading-relaxed select-text">
          {/* Key Principle Banner */}
          <div className="bg-indigo-50/70 dark:bg-indigo-950/40 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-900/50 space-y-2">
            <div className="flex items-center gap-2 font-bold text-indigo-950 dark:text-indigo-200 text-sm">
              <EyeOff className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>Главный принцип защиты</span>
            </div>
            <p className="text-xs text-indigo-900 dark:text-indigo-300">
              Сервер приложения не хранит ваши фамилии и имена. Список группы находится только на устройстве старосты, а на сервере данные хранятся под случайными номерами в журнале.
            </p>
          </div>

          {/* 1. Безопасность списка */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 space-y-1.5">
            <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-indigo-500" />
              <span>Список одногруппников</span>
            </div>
            <p>
              ФИО студентов хранятся только в браузере старосты для составления ведомостей и отметок на парах. Они никогда не отправляются на сервер в открытом виде.
            </p>
          </div>

          {/* 2. Что мы не собираем */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 space-y-1.5">
            <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>Никаких лишних данных</span>
            </div>
            <p>
              Мы не запрашиваем пароли, паспортные данные, номера телефонов, личные email и медицинские справки.
            </p>
          </div>

          {/* 3. Удаление данных */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 space-y-1.5">
            <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Trash2 className="w-3.5 h-3.5 text-rose-500" />
              <span>Удаление в один клик</span>
            </div>
            <p>
              Вы можете в любой момент удалить сохраненную привязку и свои данные одной кнопкой в профиле («Удалить мои данные»).
            </p>
          </div>

          {/* 4. Обратная связь */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 space-y-1.5">
            <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-blue-500" />
              <span>Связь с разработчиком</span>
            </div>
            <p>
              Если у вас возник вопрос или вы нашли ошибку в расписании, отправьте сообщение через кнопку «Сообщить об ошибке».
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 shrink-0 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto py-2.5 px-6 rounded-2xl font-bold text-xs bg-indigo-600 hover:bg-indigo-700 text-white shadow-md transition-all active:scale-[0.98]"
          >
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicyModal;
