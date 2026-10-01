import React from 'react';
import { Shield, X, Lock, EyeOff, Server, Trash2, CheckCircle2, UserCheck, HelpCircle } from 'lucide-react';

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
                Защита данных и условия использования сервиса
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
        <div className="p-4 sm:p-6 flex-1 min-h-0 overflow-y-auto space-y-6 text-xs text-slate-700 dark:text-slate-300 leading-relaxed select-text">
          {/* Key Principle Banner */}
          <div className="bg-indigo-50/70 dark:bg-indigo-950/40 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-900/50 space-y-2">
            <div className="flex items-center gap-2 font-bold text-indigo-950 dark:text-indigo-200 text-sm">
              <EyeOff className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>Главный принцип защиты</span>
            </div>
            <p className="text-xs text-indigo-900 dark:text-indigo-300">
              Сервер приложения не знает ваших фамилий, имён и личных номеров Telegram. Список группы хранится только на устройстве вашего старосты, а на сервере данные обрабатываются в строго обезличенном виде под случайными номерами.
            </p>
          </div>

          {/* 1. Статус сервиса и оператор */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
              <span>1. Статус сервиса и оператор</span>
            </h4>
            <p>
              Сервис является некоммерческой студенческой инициативой для удобного просмотра расписания и организации оперативного учета посещаемости. Он не является официальной информационной системой ФГБОУ ВО «СамГТУ» и не аффилирован с университетом. Вуз не несет ответственности за функционирование приложения; любые вопросы об официальном учебном процессе решаются через деканаты СамГТУ.
            </p>
            <p>
              Оператором сервиса выступает независимый разработчик. Связь с разработчиком осуществляется через форму сообщений об ошибках в приложении.
            </p>
          </div>

          {/* 2. Какие данные обрабатываются и зачем */}
          <div className="space-y-3">
            <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
              <span>2. Какие данные обрабатываются и зачем</span>
            </h4>
            <p>
              Обработка данных строго разделена на два независимых контура:
            </p>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800">
                А. На сервере сервиса (обезличенный контур):
              </div>
              <div className="p-3 space-y-2 bg-white dark:bg-slate-900/40">
                <p><strong>• Обезличенный код аккаунта:</strong> необратимый криптографический код (хэш HMAC-SHA256) от вашего Telegram ID. Исходный номер вашего аккаунта на сервере не сохраняется.</p>
                <p><strong>• Случайный номер слота:</strong> 8-значный идентификатор в журнале группы (например, <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">A7K2Q9X1</code>), создаваемый старостой без связи с алфавитным порядком.</p>
                <p><strong>• Отметки посещаемости:</strong> часы присутствия и пропусков занятий, привязанные исключительно к номеру слота.</p>
                <p><strong>• Время согласия:</strong> метка даты подтверждения условий при подключении по инвайт-коду.</p>
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800">
                Б. На устройстве старосты (локальный контур):
              </div>
              <div className="p-3 space-y-1 bg-white dark:bg-slate-900/40">
                <p><strong>• Список группы (фамилия и имя):</strong> хранится исключительно в памяти браузера на устройстве старосты для формирования ведомостей. На сервер сервиса эти данные никогда не отправляются.</p>
              </div>
            </div>
          </div>

          {/* 3. Что мы принципиально не собираем */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
              <span>3. Что мы принципиально не собираем</span>
            </h4>
            <p>
              Сервис не запрашивает и не хранит: паспортные данные, номера телефонов, личные email, пароли от личного кабинета университета, оценки, аттестации, геолокацию и содержимое переписок.
            </p>
            <p>
              Сервис не собирает сведения о состоянии здоровья или диагнозах. Отметка «уважительная причина» является исключительно организационным статусом; медицинские справки сервисом не запрашиваются и не хранятся.
            </p>
          </div>

          {/* 4. Как даётся согласие */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
              <span>4. Порядок предоставления согласия</span>
            </h4>
            <p>
              Студент выражает согласие на обработку данных отдельным действием в интерфейсе при вводе одноразового 10-значного кода от старосты. Без подтверждения условий привязка аккаунта к журналу группы не происходит.
            </p>
            <p>
              Староста группы при начале ведения журнала подтверждает, что согласует учет с одногруппниками, не вносит избыточных сведений и удаляет записи по требованию студентов.
            </p>
          </div>

          {/* 5. Изоляция данных */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
              <span>5. Изоляция данных и безопасность</span>
            </h4>
            <p>
              Список группы (ФИО) физически не покидает устройство старосты. Сервер видит только номера слотов и отметки пар, что исключает деанонимизацию студентов при сетевых сбоях.
            </p>
            <p>
              Каждый подключенный студент имеет доступ строго к своим собственным отметкам через экран «Мои пропуски». Просмотр чужих пропусков технически невозможен.
            </p>
          </div>

          {/* 6. Сроки хранения */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
              <span>6. Сроки хранения данных</span>
            </h4>
            <p>
              Отметки посещаемости хранятся в течение текущего учебного семестра и автоматически удаляются через 200 дней. Привязка студента к слоту действует до момента отзыва согласия. Связка для ответа разработчика на баг-репорты хранится в зашифрованном виде не более 30 дней.
            </p>
          </div>

          {/* 7. Отзыв согласия и удаление данных */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
              <span>7. Отзыв согласия и мгновенное удаление</span>
            </h4>
            <p>
              Вы можете в любой момент отозвать согласие и полностью стереть свои данные без ожидания: в профиле приложения нажмите кнопку <strong>«Удалить мои данные»</strong>. Привязка аккаунта и все сохраненные отметки посещаемости удаляются с сервера немедленно.
            </p>
            <p>
              Для удаления своей фамилии из списка на устройстве старосты обратитесь напрямую к старосте своей группы.
            </p>
          </div>

          {/* 8. Права пользователя */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
              <span>8. Права пользователя</span>
            </h4>
            <p>
              Вы вправе в любое время просматривать свои отметки на экране «Мои пропуски», требовать исправления ошибочно выставленных часов через старосту, а также немедленно отозвать согласие через интерфейс приложения.
            </p>
          </div>

          {/* 9. Сторонние сервисы */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
              <span>9. Сторонние сервисы и инфраструктура</span>
            </h4>
            <p>
              Для работы приложения используется инфраструктура Cloudflare (прием запросов и хранение обезличенных данных) и GitHub Pages (раздача интерфейса приложения). Серверы провайдеров могут находиться в разных странах. Сервис не передает данные рекламным сетям, аналитическим брокерам и не использует сторонние рекламные трекеры.
            </p>
          </div>

          {/* 10. Возраст и автоматические решения */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
              <span>10. Возрастные подтверждения</span>
            </h4>
            <p>
              Подтверждая согласие, вы удостоверяете, что вам исполнилось 18 лет, либо вы обладаете полной дееспособностью, либо получили согласие законных представителей.
            </p>
            <p>
              Приложение не принимает автоматических решений, влекущих юридические последствия (о недопуске к сессии или отчислении). Все данные носят исключительно информационно-справочный характер.
            </p>
          </div>

          {/* 11. Связь с разработчиком */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
              <span>11. Обратная связь</span>
            </h4>
            <p>
              По вопросам работы приложения и обработки данных вы можете отправить сообщение через кнопку «Сообщить об ошибке» в профиле. Если вы разрешили получение ответа, бот сервиса доставит ответ разработчика прямо в Telegram.
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
