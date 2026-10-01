import React from 'react';
import { Shield, X, CheckCircle2, Lock, EyeOff, Server, Trash2 } from 'lucide-react';

interface PrivacyPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PrivacyPolicyModal: React.FC<PrivacyPolicyModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl max-w-2xl w-full max-h-[92dvh] sm:max-h-[85vh] flex flex-col shadow-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white leading-tight">
                Политика конфиденциальности
              </h3>
              <p className="text-xs text-slate-400">
                Архитектура «Слепой сервер» v3 • Ст. 9 152-ФЗ
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
        <div className="p-4 sm:p-6 flex-1 min-h-0 overflow-y-auto space-y-5 text-xs text-slate-700 dark:text-slate-300 leading-relaxed select-text">
          <div className="bg-indigo-50/70 dark:bg-indigo-950/40 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-900/50 space-y-2">
            <div className="flex items-center gap-2 font-bold text-indigo-950 dark:text-indigo-200 text-sm">
              <EyeOff className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>Главный принцип защиты</span>
            </div>
            <p className="text-xs text-indigo-900 dark:text-indigo-300">
              Сервер не знает ваших фамилий, имён и реального Telegram ID. Все данные обрабатываются в обезличенном виде через архитектуру «Слепой сервер».
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
              <span>1. Оператор сервиса</span>
            </h4>
            <p>
              Оператором сервиса является независимый разработчик SamGTU Schedule. Сервис не является официальным сервисом СамГТУ. Связь с оператором осуществляется через форму сообщения об ошибках в приложении.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
              <span>2. Какие данные обрабатываются</span>
            </h4>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Обезличенный код аккаунта:</strong> необратимый криптографический хэш (HMAC-SHA256) от вашего Telegram ID. Исходный номер аккаунта на сервере не сохраняется.</li>
              <li><strong>Случайный номер слота:</strong> 8-значный номер в журнале группы (например, <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">A7K2Q9X1</code>), созданный старостой без алфавитного порядка.</li>
              <li><strong>Отметки посещаемости:</strong> часы присутствия и отсутствия по парам, привязанные исключительно к номеру слота.</li>
              <li><strong>Версия и время согласия:</strong> метка подтверждения условий при вводе кода приглашения.</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
              <span>3. Что никогда не передается на сервер</span>
            </h4>
            <p>
              Ваши <strong>Фамилия, Имя, Отчество, номера телефонов и email</strong> на сервер <strong>не передаются</strong>. Список сопоставления «ФИО — номер слота» хранится исключительно локально на устройстве старосты вашей группы.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
              <span>4. Инфраструктура</span>
            </h4>
            <p>
              Серверная часть работает на облачной бессерверной инфраструктуре Cloudflare (Workers & KV). При возникновении утечки базы данных сопоставить отметки с реальными людьми технически невозможно.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
              <span>5. Сроки хранения и отзыв данных</span>
            </h4>
            <p>
              Отметки посещаемости хранятся до конца текущего семестра (автоматическое удаление через 200 дней). Отозвать согласие и полностью удалить привязку и отметки можно в любой момент кнопкой <strong>«Удалить мои данные»</strong> в профиле — данные удаляются с сервера немедленно.
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
