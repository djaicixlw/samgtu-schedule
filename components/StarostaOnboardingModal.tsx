import React from 'react';
import { UserPlus, X, Users, Sparkles } from 'lucide-react';

interface StarostaOnboardingModalProps {
  isOpen: boolean;
  groupName: string;
  onClose: () => void;
  onAddStudents: () => void;
}

export const StarostaOnboardingModal: React.FC<StarostaOnboardingModalProps> = ({
  isOpen,
  groupName,
  onClose,
  onAddStudents
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-slate-200/90 dark:border-slate-800 space-y-5 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-start justify-between">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
            <Users className="w-6 h-6" />
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl transition-colors cursor-pointer"
            aria-label="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2 text-left">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Права старосты активированы</span>
          </div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white leading-tight">
            Вы вошли как староста группы {groupName}!
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed pt-1">
            Давайте добавим список одногруппников, чтобы отмечать посещаемость на занятиях и формировать ведомости.
          </p>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
          <button
            type="button"
            onClick={onAddStudents}
            className="flex-1 py-3 px-5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer min-h-[44px]"
          >
            <UserPlus className="w-4 h-4" />
            <span>Добавить студентов</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="py-3 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-sm rounded-xl transition-colors cursor-pointer min-h-[44px]"
          >
            Позже
          </button>
        </div>
      </div>
    </div>
  );
};

export default StarostaOnboardingModal;
