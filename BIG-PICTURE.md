# Архитектурная карта проекта: Расписание СамГТУ (samgtu-schedule)

<!-- open-steps:begin -->
_Measured 2026-10-01. Stages are dated where they stand; anything undated in this file is not measured._

## О продукте
Автономное веб-приложение (PWA / Telegram Mini App) для студентов и старост Самарского государственного технического университета (СамГТУ) на архитектуре v3 («Слепой сервер»). Обеспечивает мгновенный доступ к расписанию занятий в 4-недельном цикле с оффлайн-доступом, защищенный учет посещаемости без передачи персональных данных студентов (слоты, необратимый HMAC от Telegram ID, отзыв данных), трекер домашних заданий, и автоматический мониторинг изменений расписания с официального сервера университета. Нативный слой Android/Capacitor выведен из эксплуатации.

## Состав компонентов и подсистем

| Компонент | Назначение | Расположение | Состояние |
|---|---|---|---|
| **Ядро и роутинг** | Инициализация Telegram WebApp SDK, темы без FOUC, Safe Areas TMA 8.0+, живой тайм-тикер useNow, навигация | `App.tsx`, `index.tsx`, `index.css`, `utils/useNow.ts` | live (01 Oct) |
| **Реестр расписания** | On-Demand чанки расписаний (`public/schedules/*.json`), версионированный SWR-кэш v1 с фоновым обновлением, безопасная очистка кэша без потери посещаемости | `constants.ts`, `utils/scheduleLoader.ts`, `utils/scheduleSchema.ts`, `public/schedules/` | live (01 Oct) |
| **Журнал посещаемости (v3)** | Локальный ростер старосты, учет присутствия/пропусков, расчет часов по блокам, экспорт в Word, синхронизация через слоты | `attendance.ts`, `components/AttendanceTracker.tsx`, `utils/rosterProvider.ts` | live (01 Oct) |
| **Трекер ДЗ** | Ведение заданий, дедлайны, фильтры, статус выполнения, фоновая синхронизация | `components/HomeworkTracker.tsx` | live (01 Oct) |
| **Карточка пары & модалка** | Отображение занятия, статусы отмены, смена аудиторий и преподавателей | `components/ClassCard.tsx`, `components/EditLessonModal.tsx` | live (01 Oct) |
| **Облачный бэкенд v3** | Cloudflare Worker + KV («Слепой сервер»): PBKDF2 (100k) + safeEqual, fail-closed шлюз `requireAppKey`, подписанные `/file`, эндпоинты `/v3/*` | `cloudflare-worker.js` | live (01 Oct) |
| **Облачная синхронизация** | Клиентский слой синхронизации: энергоэффективный опрос (backoff, throttle, AbortController, фоновое засыпание) | `utils/cloudSync.ts`, `App.tsx` | live (01 Oct) |
| **Безопасность и Auth v3** | 80-битные коды групп, PBKDF2, blindId через HMAC-SHA256, rate-limiting попыток подбора (429) | `cloudflare-worker.js`, `utils/auth.ts`, `scripts/make-group-code.mjs` | live (01 Oct) |
| **Телеметрия сбоев** | Сбор метаданных крашей, дедупликация и отправка алертов в закрытый канал | `utils/telemetry.ts`, `components/ErrorBoundary.tsx` | live (01 Oct) |
| **Логирование & Баг-репорты** | Внутриклиентский буфер логов (150 записей), двухконтурная отправка (Worker + прямой fallback) | `utils/logger.ts`, `components/BugReportModal.tsx` | live (01 Oct) |
| **Ночная автосверка** | Парсинг официального API СамГТУ, Circuit Breaker, Telegram-дифф | `scripts/nightly_sync.ts`, `.github/workflows/daily-sync.yml` | live (01 Oct) |
| **Дедупликация групп** | Канонический ключ группы, самоисцеление localStorage, строгая фильтрация | `utils/samgtuParser.ts`, `App.tsx` | live (01 Oct) |
| **Тестовый комплекс** | Набор автоматических тестов регрессии, авторизации, DTO, расписаний, API v3 (79 ассертов v3) | `tests/` (26 тест-сьютов) | live (01 Oct) |
| **База знаний Obsidian** | Интерактивная база знаний, ADR (ADR-007, 008, 009), схемы и дорожные карты | `samgtu_schedule/` | live (01 Oct) |

## Стоит вывести из эксплуатации (Worth retiring)
- Выведено: Нативный Android/Capacitor (`android/`, `capacitor.config.json`, пакеты `@capacitor/*`) — полностью удалены в задаче A1-2.

## Дорожная Карта и Очередь Задач (Бэклог)

### 🚨 Текущий спринт: Архитектура v3 («Слепой сервер») — Волны W0-W2
- [x] **Волна W0 (Подготовка и контракт API v3)**: ротация секретов, очистка `auth:*`, фиксация `docs/API-v3-contract.md`, ADR-007/008/009.
- [x] **Волна W1 (Hotfixes)**:
  - [x] A1-1: Очистка сканера `check-dist.mjs` от PIN-литералов, ограничение хоста Vite.
  - [x] A4-1: Санитизация заголовков экспорта Word (initData, без chat_id в body), защита `window.open`.
  - [x] A2-0: Валидация правок парсера СамГТУ.
  - [x] A5-1: Вынос PIN-хэшей в KV с PBKDF2 (100k) и safeEqual, rate limit на `/auth/pin`, генератор `scripts/make-group-code.mjs`.
  - [x] A5-2: Fail-closed шлюз `requireAppKey`, подписанные ссылки `/file` (10 мин), CORS без `*`, санитизация лимитов payload.
- [x] **Волна W2 (Архитектура v3 «Слепой сервер» — 100% ВЫПОЛНЕНО)**:
  - [x] A1-2: Удаление Android/Capacitor, `android/`, `capacitor.config.json`, пакетов `@capacitor/*`.
  - [x] A5-3: Реализация бэкенда API v3 на Cloudflare Worker (`/v3/staff/claim`, `/slots`, `/invites`, `GET/PUT /v3/att`, `/student/link`, `GET/DELETE /v3/me`).
  - [x] A4-2: Клиентский слой `attendanceStorage.ts` (localAdapter + v3 sync), слоты, генерация инвайтов, экспорт без сервера, удаление ФИО из `STUDENTS_REGISTRY`.
  - [x] A3-1: Экраны согласий (`ConsentModal`), ввод инвайт-кода (`StudentLinkModal`), вкладка «Мои пропуски» (`MyAbsencesModal`), кнопка отзыва согласия (`DELETE /v3/me`).
  - [x] A5-4: Бот-релей баг-репортов (`POST /report`, вебхук `POST /tg/webhook`, AES-256-GCM шифрование связки `rm:{message_id}`) для закрытия публичного канала.
  - [x] A5-5: Ограничение записи расписания и ДЗ только для проверенных старост (`staff`) и админа, открытое чтение.
  - [x] A3-3: Предзагрузка `semester.json` до первого рендера (`index.tsx`) с защитным таймаутом и тестом.
  - [x] A2-1: Ночная синхронизация шлёт уведомления в личку владельцу (`DEV_CHAT_ID`) без публичного канала.

### Фаза 1: Оптимизация, Эргономика и Надежность Ядра — [100% ВЫПОЛНЕНО]
- [x] Редизайн светлой темы: сланцевый фон `#eaeff5`, контраст WCAG AA (>4.5:1), объемные карточки.
- [x] Безопасные зоны (Safe Areas): поддержка TMA v7+ / 8.0+ (`--tg-content-safe-area-inset-top`), шторки iOS/Android.
- [x] Эргономика мобильных свайпов: доминантность горизонтального свайпа 1.35x в `SwipeableDays.tsx`.
- [x] Иерархический селектор групп (GroupSelector 2.0) с поиском и ручным вводом любой группы СамГТУ.
- [x] Безотказный экспорт Word: 4-уровневый каскад (Edge Worker /export-doc -> Web Share API -> HTML5 Blob).
- [x] Заглушка технических работ (Maintenance Mode) с секретным байпасом администратора.
- [x] Автоматический аудит безопасности: проверка шлюзов Worker, защита от брутфорса, проверка бандла.
- [x] Оптимизация бандла: вынос `docx` в on-demand чанк (бандл уменьшен с 942 кБ до 447 кБ raw / 97 кБ gzip).
- [x] Полная ликвидация легаси Firebase и ExtendsClass, переход на Cloudflare KV с изоляцией по `?groupId=`.
- [x] Подавление ложных краш-алертов в Telegram от автотестов (`TEST_MODE: 'true'`).

### Фаза 2: Масштабирование на Весь СамГТУ (Горизонт: 2-3 недели)
- [x] On-Demand чанки расписания: раздельное хранение расписаний групп в легковесных JSON (`public/schedules/*.json`).
- [x] Массовый генератор расписания всего университета через `sync_schedule_all_groups.ts` с Circuit Breaker.
- [ ] Edge-кэширование на узлах Cloudflare Worker (`Cache-Control: public, max-age=60`) для экономии серверных вызовов.
- [ ] Защита от коллизий параллельного редактирования старостами (ETag / revision counter).

### Фаза 3: Интеграции и Сервисы Студента (Горизонт: 1 месяц)
- [ ] Telegram Bot Push-уведомления студентам об отменах занятий и переносах аудиторий старостой.
- [ ] Экспорт расписания в iCal (`.ics`) и живая облачная подписка WebCal через Cloudflare (Apple/Google Calendar).
- [ ] Интерактивная схема корпусов и подсказки расположения аудиторий СамГТУ.

### Фаза 4: Академическая Аналитика и Сессия (Горизонт: 2 месяца)
- [ ] Экспорт ведомостей посещаемости в Microsoft Excel (`.xlsx`).
- [ ] Графики динамики посещаемости группы и предупреждения о рисках недопуска к зачетам.
- [ ] Поддержка сессионного расписания (зачетные недели, консультации, экзамены).

_Age and wiring measured 2026-09-26, fresh this pass. Stage comes from session reports and is only as current as the date beside it._
<!-- open-steps:end -->
