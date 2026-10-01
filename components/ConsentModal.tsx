import React, { useState } from 'react';
import { ShieldCheck, X, Check } from 'lucide-react';

interface ConsentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConsent: () => void;
}

export const CONSENT_TEXT_V1 =
  'Я даю согласие оператору сервиса SamGTU Schedule (связь — через форму «Связаться» в приложении) на обработку: необратимого кода моего Telegram-аккаунта, присвоенного старостой номера в журнале группы и отметок моей посещаемости — чтобы показывать мне мои пропуски. Моя фамилия и имя на сервер сервиса не передаются, они у старосты. Срок: до конца семестра или до отзыва. Отозвать согласие и удалить данные можно в любой момент кнопкой «Удалить мои данные» в профиле, удаление выполняется сразу. Данные обрабатываются с использованием облачного сервиса Cloudflare, серверы которого могут находиться в разных странах. Мне исполнилось 18 лет либо у меня есть согласие законного представителя.';

const ConsentModal: React.FC<ConsentModalProps> = ({ isOpen, onClose, onConsent }) => {
  const [agreed, setAgreed] = useState(false);

  if (!isOpen) return null;

  const handleContinue = () => {
    if (!agreed) return;
    onConsent();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl max-w-lg w-full max-h-[92dvh] sm:max-h-[85vh] flex flex-col shadow-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white leading-tight">
                Согласие на обработку данных
              </h3>
              <p className="text-xs text-slate-400">
                Учет посещаемости • Личные данные защищены
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
        <div className="p-4 sm:p-5 flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-4">
          <div className="bg-indigo-50/60 dark:bg-indigo-950/30 p-3.5 rounded-2xl border border-indigo-100 dark:border-indigo-900/50 flex items-start gap-2.5">
            <span className="text-base select-none shrink-0">🔒</span>
            <p className="text-xs text-indigo-900 dark:text-indigo-200 font-medium leading-relaxed">
              Ваши имя и фамилия <strong className="font-bold">не передаются на сервер</strong>. Сервер хранит только обезличенный номер в журнале (слот) и отметки пар.
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/60">
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap select-text">
              {CONSENT_TEXT_V1}
            </p>
          </div>

          {/* Checkbox */}
          <label className="flex items-start gap-3 p-3 rounded-2xl bg-slate-50 hover:bg-slate-100/80 dark:bg-slate-800/40 dark:hover:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/60 cursor-pointer select-none transition-colors">
            <div className="relative flex items-center justify-center shrink-0 mt-0.5">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="w-5 h-5 appearance-none rounded-lg border-2 border-slate-300 dark:border-slate-600 checked:bg-indigo-600 checked:border-indigo-600 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
              {agreed && <Check className="w-3.5 h-3.5 text-white absolute pointer-events-none stroke-[3]" />}
            </div>
            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 leading-tight pt-0.5">
              Согласен с условиями обработки данных
            </span>
          </label>
        </div>

        {/* Footer actions */}
        <div className="p-4 sm:p-5 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 shrink-0 flex flex-col sm:flex-row gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-1/2 py-2.5 px-4 rounded-2xl font-semibold text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-all order-2 sm:order-1"
          >
            Отказаться
          </button>
          <button
            type="button"
            disabled={!agreed}
            onClick={handleContinue}
            className="w-full sm:w-1/2 py-2.5 px-4 rounded-2xl font-bold text-xs bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-md shadow-indigo-200 dark:shadow-none transition-all order-1 sm:order-2 active:scale-[0.98]"
          >
            Продолжить
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConsentModal;
