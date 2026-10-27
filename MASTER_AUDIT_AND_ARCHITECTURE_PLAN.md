# ЕДИНЫЙ МАСТЕР-ПЛАН И ДОРОЖНАЯ КАРТА АРХИТЕКТУРЫ (TMA САМГТУ) — ФИНАЛЬНАЯ СПЕЦИФИКАЦИЯ ДЛЯ ANTIGRAVITY 2.0

* **Роль:** Главный системный архитектор (Principal System Architect / CTO), Lead QA & Chaos Engineer, Security & Edge Performance Auditor
* **Объект:** Экосистема Telegram Mini App (TMA) и Web-приложения расписания, журнала посещаемости и учебного трекера СамГТУ (`samgtu-schedule`, бот `@raspisanie_samgtu_bot`)
* **Технологический стек:** React + TypeScript + Vite (Zero New Dependencies), Cloudflare Workers (Workers Free Tier), Cloudflare KV + Cloudflare D1 (`attendance_d1`), GitHub Actions (CI/CD & Scraping Cron)
* **Статус документа:** **Финальный утвержденный Мастер-План (v6.0 — Бесконфликтный синтез `review/glm` + `review/sonnet_ex` + `review/sonnet_h`).** Все архитектурные развилки согласованы с владельцем проекта. Логотипы и иконки отложены и исключены из плана работ агента.

---

## 1. ИНСТРУКЦИЯ ДЛЯ ВЛАДЕЛЬЦА: ЧТО УДАЛИТЬ ИЗ ПАПКИ `review/` ПЕРЕД ПЕРЕДАЧЕЙ АГЕНТУ

По твоим скриншотам сейчас в папке `review/` лежат три подпапки (`glm`, `sonnet_ex`, `sonnet_h`), внутри которых есть промежуточные патчи, дублирующиеся ZIP-архивы, отвергнутые логотипы и конфликтующая версия D1. Чтобы агент **Antigravity 2.0** гарантированно не запутался и не применил лишний или устаревший файл, наведи порядок в папке `review/` по этому чек-листу, а затем скопируй чистую папку `review/` в корень проекта (`./review/`):

### 1.1. Папка `review/sonnet_ex/` (Скриншот №3)
В этой папке лежат 5 патчей (4 из которых — старые промежуточные итерации) и 5 файлов картинок.
* ❌ **УДАЛИТЬ (9 файлов):**
  1. `bot-assets-v2.zip` (визуал не нравится, отложен)
  2. `bot-avatar-512.png` (отложен)
  3. `description-picture-640x360.png` (отложен, с багом точек)
  4. `logo-concepts.png` (отложен)
  5. `mark-transparent-512.png` (отложен)
  6. `s_ex_samgtu-v2-convergence-fix.patch` (устаревшая Итерация 1 — уже внутри `samgtu-all-in-one-v2.patch`)
  7. `s_ex_samgtu-v2-hardening-incremental.patch` (устаревшая Итерация 2 — уже внутри `samgtu-all-in-one-v2.patch`)
  8. `s_ex_samgtu-v2-all-in-one.patch` (устаревшая сумма 1+2 — уже внутри `samgtu-all-in-one-v2.patch`)
  9. `samgtu-bugfixes-incremental.patch` (промежуточный патч — уже внутри `samgtu-all-in-one-v2.patch`)
* ✅ **ОСТАВИТЬ ТОЛЬКО (1 файл):**
  * **`samgtu-all-in-one-v2.patch`** (146 КБ) — содержит абсолютно все правки и все 5 новых тестов из второго ревью.

---

### 1.2. Папка `review/sonnet_h/` (Скриншот №4)
* 📦 **РАСПАКОВАТЬ И ПОЧИСТИТЬ:**
  1. ❌ **Удалить** архив `bugfix-2026-10-24.zip` (все файлы из него уже лежат распакованными прямо в `review/sonnet_h/`).
  2. 📦 **Распаковать** архив `d1-migration.zip` в подпапку `review/sonnet_h/d1-migration/`, а сам архив `d1-migration.zip` **удалить**.
  3. 📦 Открыть архив `telegram-kit.zip`, достать из него **только один файл** `telegram-kit/bot/bot_welcome.patch` (это код ответа бота на `/start` и `/help`, который проверяется тестом `test_bot_welcome.ts`) и положить `bot_welcome.patch` в `review/sonnet_h/`.
  4. ❌ **Удалить** сам архив `telegram-kit.zip` и файл `README_TELEGRAM.md` (там лежат логотипы с ракетой и циферблатом, которые мы забраковали).
* ✅ **ЧТО ОСТАНЕТСЯ В `review/sonnet_h/`:**
  * Папка `d1-migration/` (`migrations/0001_attendance.sql`, `worker/attendance_d1.js`, `utils/attendanceD1Client.ts`, `utils_attendanceStorage.d1client.patch`, `cloudflare-worker.d1.patch`, `tests/helpers/d1_shim.ts`, `tests/test_d1_attendance.ts`, `tests/test_d1_client.ts`)
  * `bugfix.patch`
  * `scripts_official_window.patch`
  * `bot_welcome.patch`
  * `officialWeeks.ts`
  * `scheduleCompare.ts`
  * `teacherOverrides.ts`
  * `test_bugfix_oct24.ts`
  * `test_bot_welcome.ts`
  * `README_FIXES.md` и `README_RUNBOOK.md`

---

### 1.3. Папка `review/glm/` (Скриншот №2)
* ❌ **УДАЛИТЬ:**
  1. Архив `glm_samgtu-fix-package.zip` (рядом уже есть распакованная папка `glm_samgtu-fix-package`).
  2. Таблицу `glm_samgtu-audit-task-tracker.xlsx`.
  3. Внутри `glm_samgtu-fix-package/fix-package-staging/` **удалить папку `deploy/`** и **удалить из `new/` конфликтующие файлы D1 и ключей v2**, от которых мы отказались:
     - ❌ `new/d1store.js`
     - ❌ `new/migrations/` (`0001_init.sql`, `0002_sync_groups.sql`)
     - ❌ `new/scripts/d1_migrate.ts` и `new/scripts/backfill_kv_to_d1.ts`
     - ❌ `new/utils/lessonKey.ts`, `new/utils/attendanceBase.ts`, `new/utils/lessonResync.ts`
     - ❌ `new/tests/d1mock.ts`, `new/tests/test_d1_schema.ts`, `new/tests/test_d1_marks_hlc.ts`, `new/tests/test_d1_ratelimit.ts`, `new/tests/test_sync_d1.ts`, `new/tests/test_backfill.ts`, `new/tests/test_lesson_key_v2.ts`, `new/tests/test_unified_base.ts`, `new/tests/test_lesson_resync.ts`, `new/tests/test_group_code_session.ts`.
* ✅ **ЧТО ОСТАНЕТСЯ В `review/glm/`:**
  * Чистые, неконфликтующие модули и тесты в `glm_samgtu-fix-package/fix-package-staging/new/` и `diffs/`, плюс `glm_all_diffs.patch` и `glm_all_new_files.txt`.

---

## 2. УТВЕРЖДЕННЫЕ АРХИТЕКТУРНЫЕ РЕШЕНИЯ (БЕСКОНФЛИКТНЫЙ СИНТЕЗ)

Для агента **Antigravity 2.0** действуют следующие 6 железных правил (никакой самодеятельности):

1. **Единственная архитектура D1 — из `review/sonnet_h/d1-migration/`:**
   - Используем только `migrations/0001_attendance.sql`, `worker/attendance_d1.js` и клиентский модуль `utils/attendanceD1Client.ts`.
   - Погрупповое переключение хранится в таблице `att_groups` внутри самой D1 и управляется через `POST /v3/admin/att/migrate` (`mode: status | copy | flip | rollback`).
   - Снятая отметка пишется как tombstone (`status = ''` с `hlc`), батчи разворачиваются через `json_each` ($\le 6$ SQL-запросов), время из будущего обрезается до `now + 2 мин`.
   - Клиент для D1-групп использует быстрые инкрементальные маршруты `GET /v3/att/changes?since=rev` и `POST /v3/att/ops`, а для KV-групп автоматически работает по старому протоколу.
2. **Формат ключей пар `lessonKey` остается `MM-DD.N`:**
   - Формат `YYYY-MM-DD.HHMM` (`lessonKey v2` из GLM) **НЕ применяется**, чтобы сохранить 100% работоспособность `MyAbsencesModal.tsx` («Мои пропуски»), `worker/attendance_d1.js`, `attendanceD1Client.ts` и всех существующих записей в KV.
3. **Синхронизация посещаемости и дебаунс (`sonnet_ex` + `sonnet_h`):**
   - Используем `utils/attendanceCloudSync.ts` (`pullMergePush`, `markSnapshotPushed`), `pullAttendanceSnapshotFromV3`, `rebaseAttendanceBaseFromServer` и защиту от отстающих нод KV (`isStaleRead` / `noteSeenVer` — применяется **только** к ответам из KV, не к D1-зеркалу).
   - В `attendance.ts` внедряем честный дебаунс **2500 мс после последнего тапа** (`scheduleSync`) + принудительный сброс `flushSyncNow()` при `visibilitychange === 'hidden'` и `pagehide` (из `review sonnet h.md`).
4. **Предложка в «Полезное» (`/v3/useful/*` из `sonnet_ex` + настройки приватности владельца):**
   - Лимит предложений от одного студента: **`SUGGEST_PER_USER_PER_HOUR = 10`** (вместо 3).
   - В очереди модерации у старосты (`GET /v3/useful/pending`) поле `submittedBy` (`id`, `username`, `name` из проверенного `initData`) сохраняется, чтобы староста видел, кто предложил материал.
   - При одобрении (`action === 'approve'` в `POST /v3/useful/resolve`) перед сохранением материала в публичный список `useful:${g.gid}` поле **`delete published.submittedBy`** удаляется целиком — в публичном списке нет ни числового Telegram ID, ни юзернейма студента.
   - На вкладке «ДЗ» (`BottomNav.tsx`) и переключателе «Полезное» у старосты отображается бейдж с количеством ожидающих предложений (`serverPending.length`), а внутри вкладки работает переключатель `Telegram: вкл / выкл` (с отправкой уведомлений от бота `@raspisanie_samgtu_bot`).
5. **Сверка расписания, Ночной синк и Преподаватели БЖД (`sonnet_ex` + `sonnet_h`):**
   - Используем `utils/officialWeeks.ts` (скользящее окно из 4 актуальных недель портала СамГТУ `officialWeeksForCycle`, начиная с 26 октября — недели `9..12`, с откатом `weekFallbackChain`) и `utils/scheduleCompare.ts` (`compareWithOfficial` со статусом `'no-local-data'`, если в приложении 0 пар).
   - В `utils/samgtuParser.ts` используем `deriveLessonIdPrefix` и улучшенный `convertOfficialSamgtuToWeekData` из `sonnet_ex` (сохраняет префикс `310-w1-...`, игнорирует 7-ю пару без звонка, подтягивает преподавателей `subject::type`, поддерживает как ключи `1..8`, так и `1..4`).
   - Для преподавателей объединяем `utils/lessonOverrides.ts` (`sonnet_ex`) и `utils/teacherOverrides.ts` (`sonnet_h`): неизмененные поля в модалке пары не замораживаются, старые замороженные копии сбрасываются через `clearFrozenTeachers`, а в `SubjectTeachersModal.tsx` выводится желтая плашка *«У N пар преподаватель задан вручную... [Снять]»*.
6. **Хранение кода доступа группы (`group_code_${gid}`):**
   - Оставляем в `localStorage` (как в базовом коде и в `sonnet_ex`/`sonnet_h`), чтобы E2EE-шифрование ростера не слетало при перезапуске шторки Telegram Mini App на телефоне. При нажатии «Выйти» или «Удалить мои данные» очищаем все персональные ключи через `utils/personalData.ts` (из `glm`).

---

## 3. ПОФАЙЛОВАЯ ДОРОЖНАЯ КАРТА (ЧТО, ОТКУДА, КУДА И КАК ИМЕННО МЕНЯТЬ)

### ФАЗА 1. СЕРВЕРНЫЙ СЛОЙ (`cloudflare-worker.js`, `worker/attendance_d1.js`, `migrations/0001_attendance.sql`, `wrangler.toml`)

| Целевой файл в проекте | Источник в папке `./review/` | Что именно делаем (Пошаговая инструкция) |
| :--- | :--- | :--- |
| `migrations/0001_attendance.sql` *(новый)* | Копия из `review/sonnet_h/d1-migration/migrations/0001_attendance.sql` | Создает 4 таблицы D1: `att_groups`, `group_rev`, `marks` (PK: `gid, day, lesson_key, slot`), `lesson_state`. |
| `worker/attendance_d1.js` *(новый)* | Копия из `review/sonnet_h/d1-migration/worker/attendance_d1.js` | Полный серверный движок D1 для посещаемости: батч-запись через `json_each`, HLC + tie-break по `dev`, ограничение времени из будущего (`now + 2 мин`), эндпоинты `/v3/att/ops`, `/v3/att/changes` и `/v3/admin/att/migrate` (`status \| copy \| flip \| rollback`). |
| `cloudflare-worker.js` *(обновление)* | Синтез:<br>1) `review/sonnet_ex/samgtu-all-in-one-v2.patch`<br>2) `review/sonnet_h/d1-migration/cloudflare-worker.d1.patch`<br>3) `review/sonnet_h/bot_welcome.patch`<br>4) Точечные правки из `review/glm` (`AUD-001`, `AUD-020`, `AUD-021`, `AUD-039`) | 1. **Из `sonnet_h/d1-migration/cloudflare-worker.d1.patch`:** подключить импорт `./worker/attendance_d1.js` и делегирование маршрутов `/v3/att/ops`, `/v3/att/changes`, `/v3/admin/att/migrate`, а также проверку D1-режима группы в `GET/PUT /v3/att`, `GET/DELETE /v3/me` и `POST /v3/slots`.<br>2. **Из `sonnet_ex/samgtu-all-in-one-v2.patch`:**<br>• Добавить `sanitizeUsefulItem` и валидацию `type === 'useful'` в `sanitizeSyncPayload` (лимит 200 элементов, `deletedIds.slice(-1000)`).<br>• Добавить in-memory лимитер `rlBuckets` (`rlCount`, `rlBump`, `rlClear`, `export function __resetRateLimiters()`) для `/v3/staff/claim` и `/samgtu-schedule` + `cf: { cacheTtl: 3600, cacheEverything: true }`.<br>• Добавить `handleUsefulSuggestions` (`/v3/useful/suggest`, `/v3/useful/pending`, `/v3/useful/resolve`, `/v3/useful/notify`). **Важно:** установить `SUGGEST_PER_USER_PER_HOUR = 10`, а в `/v3/useful/resolve` при `action === 'approve'` выполнять `delete published.submittedBy;` перед добавлением в публичный `useful:${g.gid}`.<br>• В `PUT /sync/*` добавить проверку размера `rawText.length > 1000000` (413) и фильтрацию удаленных элементов по `tombstones` (`dead.has(String(it.id))`).<br>3. **Из `sonnet_h/bot_welcome.patch`:** в обработчике `/tg/webhook` добавить ответ на команды `/start` и `/help` в личных сообщениях (`chat.type === 'private'`) с кнопкой `📅 Открыть расписание` (`env.MINIAPP_URL \|\| 'https://djaicixlw.github.io/samgtu-schedule/'`).<br>4. **Из `review sonnet h.md` (§8 CAS):** в KV-ветке `PUT /v3/att` при ошибке `JSON.parse(attRaw)` возвращать `500 Stored attendance is unreadable` вместо затирания пустым объектом, а конфликт версий проверять условием `if ((attRaw && current.ver !== expectedBaseVer) \|\| (!attRaw && expectedBaseVer > 0))`.<br>5. **Из `glm` (`AUD-001`, `AUD-020`, `AUD-021`, `AUD-039`):**<br>• Добавить `mergeHomeworkGroupSlice`, `mergeUsefulGroupSlice`, `mergeScheduleGroupSlice` (и экспортировать их) с фильтрацией `deletedIds` после слияния.<br>• В `/tg/webhook` убрать фолбэк `\|\| env.APP_SECRET` (требовать `env.TG_WEBHOOK_SECRET \|\| env.TELEGRAM_WEBHOOK_SECRET`, иначе возвращать `503 Service unavailable`).<br>• На авторизованных чтениях (`GET /v3/att`, `/v3/me`, `/v3/roster`, `/sync/*`) выставить заголовок `"Cache-Control": "private, no-store"`.<br>• **НЕ удалять** экспорт `export async function createTelegramInitData` из `cloudflare-worker.js` (он нужен для `test_useful_suggestions.ts`), но также создать `tests/worker_test_helpers.ts` для тестов из `glm`. |
| `wrangler.toml` *(обновление)* | `review/sonnet_h/d1-migration/wrangler.toml.snippet` + `review/sonnet_ex/samgtu-all-in-one-v2.patch` | Добавить закомментированные блоки `[[d1_databases]]` (`binding = "DB"`, `database_name = "samgtu-att"`) и `[[ratelimits]]` (`name = "CLAIM_LIMITER"`). |

---

### ФАЗА 2. СИНХРОНИЗАЦИЯ ПОСЕЩАЕМОСТИ, KЛИЕНТ D1 И БЕЗОПАСНОЕ ХРАНИЛИЩЕ

| Целевой файл в проекте | Источник в папке `./review/` | Что именно делаем (Пошаговая инструкция) |
| :--- | :--- | :--- |
| `utils/attendanceD1Client.ts` *(новый)* | Копия из `review/sonnet_h/d1-migration/utils/attendanceD1Client.ts` | Клиентское зеркало D1 (`attendance_mirror_<gid>`), чтение ленты `/v3/att/changes` за 1 запрос и отправка операций в `/v3/att/ops` с автоопределением режима группы (D1 vs KV). |
| `utils/attendanceCloudSync.ts` *(новый)* | Копия из `review/sonnet_ex/samgtu-all-in-one-v2.patch` | Вынесенный цикл `pullMergePush(groupId, local)` и `markSnapshotPushed(groupId, snapshot)`. |
| `utils/safeStorage.ts` *(новый)* | Копия из `review/glm/glm_samgtu-fix-package/fix-package-staging/new/utils/safeStorage.ts` | Безопасная обертка над `localStorage` (`safeSetItem`, `safeGetItem`, `safeRemoveItem`) с in-memory фолбэком на сессию при `QuotaExceededError` и отправкой телеметрии `quota_exceeded`. |
| `utils/attendanceStorage.ts` *(обновление)* | Синтез:<br>1) `review/sonnet_ex/samgtu-all-in-one-v2.patch`<br>2) `review/sonnet_h/d1-migration/utils_attendanceStorage.d1client.patch` | 1. Применить изменения из `sonnet_ex`: добавить `rebaseAttendanceBaseFromServer`, `STALE_READ_WINDOW_MS`, `readSeenVers`, `noteSeenVer`, `isStaleRead`, `pullAttendanceSnapshotFromV3(groupId, options?: { recentOnly?: boolean })`.<br>2. Интегрировать 3 хука из `sonnet_h` (`utils_attendanceStorage.d1client.patch`):<br>• Импортировать `syncAttendanceViaD1Ops` и `pullMonthsViaD1Changes` из `./attendanceD1Client`.<br>• В `syncAttendanceRecordsToV3` перед KV-циклом вызывать `syncAttendanceViaD1Ops`.<br>• В `pullAttendanceSnapshotFromV3` перед KV-циклом вызывать `const d1Months = await pullMonthsViaD1Changes(gid, monthsToFetch, getAuthHeaders(gid))`. Если `d1Months !== null`, брать данные месяцев из `d1Months` и добавлять месяц в `fetchedMonths` (без проверки `isStaleRead`). Если `d1Months === null` (группа на KV), выполнять цикл `fetchMonthAttendanceV3` с проверкой `isStaleRead` и `noteSeenVer`!<br>3. Добавить поддержку `options?.recentOnly` (при `recentOnly: true` в KV-режиме запрашивать только текущий и предыдущий месяц). |
| `attendance.ts` *(обновление)* | Синтез:<br>1) `review/sonnet_ex/samgtu-all-in-one-v2.patch`<br>2) `review/sonnet_h/bugfix.patch` + `review sonnet h.md` (§8 Дебаунс)<br>3) `review/glm` (`safeStorage`, `AUD-040`) | 1. Подключить `pullMergePush` и `markSnapshotPushed` из `./utils/attendanceCloudSync` (также экспортировать `syncAttendanceWithCloud` из `glm` для совместимости с тестом `test_aud004_stale_snapshot.ts`).<br>2. Подключить `safeSetItem` и `safeGetItem` из `./utils/safeStorage` для чтения/записи `attendance_${groupId}`.<br>3. Внедрить честный дебаунс 2500 мс **после последнего тапа** (`scheduleSync` с `clearTimeout` предыдущего таймера) + `flushSyncNow()` на `visibilitychange === 'hidden'` и `pagehide`.<br>4. Убрать `import { toast } from 'sonner'` из `attendance.ts` и убрать показ тоста внутри `markAttendance` (тосты показываются в UI-компонентах: `AttendanceTracker.tsx` и `AttendanceMatrix.tsx`). |

---

### ФАЗА 3. ДОМЕН ГРУПП, СВЕРКА РАСПИСАНИЯ, НОЧНОЙ СИНК И СЕМЕСТР 2027

| Целевой файл в проекте | Источник в папке `./review/` | Что именно делаем (Пошаговая инструкция) |
| :--- | :--- | :--- |
| `utils/officialWeeks.ts` *(новый)* | Копия из `review/sonnet_h/officialWeeks.ts` | Расчет текущей официальной недели портала СамГТУ (`currentOfficialWeek`), скользящего окна из 4 недель (`officialWeeksForCycle`) и цепочки отката (`weekFallbackChain`). |
| `utils/scheduleCompare.ts` *(новый)* | Копия из `review/sonnet_h/scheduleCompare.ts` | Чистая функция `compareWithOfficial(current, official)`. При 0 пар в приложении возвращает `status: 'no-local-data'`. |
| `utils/groupId.ts`<br>`utils/groupAliases.ts`<br>`utils/groupMigration.ts`<br>`utils/scheduleLoader.ts`<br>`index.tsx` | Из `review/glm` (`AUD-005`, `AUD-027`, `AUD-028`) | 1. Единый канонайзер `makeGroupId` в `utils/groupId.ts`, которому делегируют `normalizeGroupId` и `normalizeSamgtuGroupName`.<br>2. Удаление коллизии алиаса `'ingt-109' -> 'ingt-209'` (группа `1-ИНГТ-109` реальна и имеет свой чанк `ingt-109.json`).<br>3. Вызов `migrateLegacyGroupKeys()` в `index.tsx` при старте приложения.<br>4. В `utils/scheduleLoader.ts` при фоновом обновлении (`stale-while-revalidate`) обновлять `SCHEDULE_REGISTRY[canonicalId]`. |
| `utils/samaraDate.ts`<br>`utils/exportWord.ts` | Из `review/glm` (`AUD-006`, `AUD-030`) + `review/sonnet_ex` (`PM_NOT_DELIVERED`) | 1. В `utils/samaraDate.ts` добавить `generateDefaultSemesterConfig(now)` без захардкоженного 2026 года.<br>2. В `utils/exportWord.ts` динамически формировать учебный год (`studyYearLabel()`) И объединить проверку отказа бота (`refusal` / `PM_NOT_DELIVERED` на телефонах из `sonnet_ex`) с проверкой `verified` / `warning` для Tier-3 Blob fallback (из `glm`). |
| `utils/samgtuGroupMap.ts` | Из `review/sonnet_h/bugfix.patch` | Добавить поле `lkVerified?: boolean` в интерфейс `SamgtuGroupMeta` и выставить `lkVerified: true` для `'ingt-310'`. |
| `utils/samgtuParser.ts` | Синтез `review/glm` (`AUD-006`, `AUD-027`) + `review/sonnet_ex` (`deriveLessonIdPrefix`, `convertOfficialSamgtuToWeekData`) | 1. Использовать `getDefaultSemesterStart()` и `makeGroupId(rawName)`.<br>2. Внедрить `deriveLessonIdPrefix`, `lookupOfficialTeacher` и улучшенный `convertOfficialSamgtuToWeekData` из `sonnet_ex`. |
| `utils/cloudSync.ts` | Синтез `review/sonnet_ex` + `review/sonnet_h` + `review/glm` (`ETag`) | 1. Добавить `fetchJsonMeta` с поддержкой `If-None-Match` / `304` и `fetchHomeworkSlice` (из `glm`).<br>2. Экспортировать **обе** функции загрузки официальных недель: `fetchOfficialWeeks` (из `sonnet_ex`) и `fetchOfficialCycleWeeks` (из `sonnet_h`, использующую `officialWeeksForCycle`).<br>3. В `syncOfficialGroupSchedule` использовать `fetchOfficialCycleWeeks` и передавать `SCHEDULE_REGISTRY[groupId]` в `convertOfficialSamgtuToWeekData` (чтобы `deriveLessonIdPrefix` сохранял префикс ID пар!). |
| `components/AdminPanel.tsx` | Синтез `review/sonnet_h/bugfix.patch` + `review/sonnet_ex` | 1. Проверять `if (groupConf.lkVerified)` при синхронизации.<br>2. В сверке использовать `fetchOfficialCycleWeeks(groupConf.samgtuGroupId)`, перед сравнением обязательно вызывать `if (!isScheduleLoaded(groupId)) await loadGroupSchedule(groupId)`, передавать `currentWeekData` в `convertOfficialSamgtuToWeekData`, а для сравнения вызывать `compareWithOfficial(currentWeekData, officialWeekData)` из `utils/scheduleCompare.ts` с выводом проверенных недель портала (`weeksLabel`). |
| `scripts/nightly_sync.ts`<br>`scripts/sync_official_schedule.ts`<br>`scripts/generate_group_chunks.ts` *(новый)* | Синтез `review/sonnet_h/scripts_official_window.patch` + `review/glm` (`AUD-033`, `AUD-034`) | 1. В `nightly_sync.ts` и `sync_official_schedule.ts` заменить захардкоженные недели `1..4` и `5..8` на скользящее окно `officialWeeksForCycle` из `utils/officialWeeks.ts`.<br>2. В `nightly_sync.ts` добавить по-недельную защиту от пустых ответов API (`buildOfficialWeeks`, `resolveWeekWrite`, `applyPerWeekGuards`, `groupHasChangedWeek` из `glm` `AUD-033`) и пропуск групп с `samgtuGroupId === 0`.<br>3. Скопировать `scripts/generate_group_chunks.ts` из `glm` и переименовать 19 битых файлов расписаний (`25 -101 .json` $\rightarrow$ `25ингт-101м.json`) в `public/schedules/`. |

---

### ФАЗА 4. ПРЕПОДАВАТЕЛИ БЖД, ОВЕРРАЙДЫ ПАР, «ПОЛЕЗНОЕ», ДЗ И UI-КОМПОНЕНТЫ

| Целевой файл в проекте | Источник в папке `./review/` | Что именно делаем (Пошаговая инструкция) |
| :--- | :--- | :--- |
| `utils/lessonOverrides.ts` *(новый)* | Копия из `review/sonnet_ex/samgtu-all-in-one-v2.patch` | Функции `buildLessonOverride`, `describeLessonSave`, `clearTeacherOverridesForChangedKeys`. |
| `utils/teacherOverrides.ts` *(новый)* | Копия из `review/sonnet_h/teacherOverrides.ts` | Функции `teacherWithoutOverride`, `clearFrozenTeachers`, `buildLessonIndex`, `countPinnedTeachers`, `unpinTeachers`. |
| `utils/homeworkMerge.ts` *(новый)*<br>`utils/cloudSyncEngine.ts` *(новый)*<br>`utils/useCloudSync.ts` *(новый)*<br>`utils/personalData.ts` *(новый)*<br>`utils/useOnlineStatus.ts` *(новый)*<br>`utils/dayLessons.ts` *(новый)*<br>`utils/useNow.ts` *(обновление)*<br>`utils/upload.ts` *(обновление)* | Из `review/glm` (`AUD-012`, `AUD-023`, `AUD-025`, `AUD-031`, `AUD-035`, `AUD-040`, `AUD-041`) | Скопировать новые утилитные модули из `review/glm/glm_samgtu-fix-package/fix-package-staging/new/utils/` и применить диффы к `utils/useNow.ts` (`useSamaraDayTick`, `samaraDayChanged`), `utils/upload.ts` (`uploadToTelegramStorage`, `formatUploadedSize`) и `types.ts` (`updatedAt?: number` в `HomeworkItem`). |
| `utils/usefulStorage.ts` *(обновление)* | Синтез `review/sonnet_ex` + `review/glm` (`AUD-011`, `AUD-023`) | 1. Добавить `getDeletedUsefulIds`, `recordDeletedUsefulItem`, `fetchUsefulState`, `mergeUsefulState` и передачу `deletedIds` в `pushGroupUsefulData`.<br>2. Добавить клиентские функции очереди предложений из `sonnet_ex`: `submitUsefulSuggestion`, `fetchPendingSuggestions`, `resolveSuggestion`, `setSuggestionNotifications`. |
| `components/UsefulTracker.tsx` *(обновление)* | Синтез `review/sonnet_ex` + `review/glm` (`useCloudSync`, `uploadToTelegramStorage`) | 1. Подключить `useCloudSync` и `uploadToTelegramStorage`.<br>2. Подключить стейт `serverPending` и `notifyEnabled`, загрузку `fetchPendingSuggestions`, отправку предложений студента через `submitUsefulSuggestion`, модерацию через `resolveSuggestion` и кнопку-переключатель `Telegram: вкл / выкл` (`handleToggleNotify`) из `sonnet_ex`. |
| `components/HomeworkTracker.tsx` *(обновление)* | Синтез `review/glm` (`useCloudSync`, `mergeHomeworkItems`, `safeStorage`, `uploadToTelegramStorage`) + `review/sonnet_h` (тексты тостов) | 1. Подключить `useCloudSync`, `mergeHomeworkItems` и `safeSetItem`/`safeGetItem` для `hw_pending_push_${currentGroupId}`.<br>2. Заменить тост загрузки файла на чистый текст без «навсегда»: `Загружаем «${fileName}»...` $\rightarrow$ `Файл «${core.fileName}» прикреплён` (или `загружен`). |
| `components/SubjectTeachersModal.tsx` *(обновление)* | Из `review/sonnet_h/bugfix.patch` | Добавить пропсы `pinned?: Record<string, number>` и `onUnpin?: (key: string) => void` и рендерить предупреждение `У N пар преподаватель задан вручную, эта настройка на них не действует` с кнопкой **«Снять»**. |
| `components/AttendanceTracker.tsx`<br>`components/AttendanceMatrix.tsx` | Синтез `review/glm` (`AUD-030`, `AUD-032`, `AUD-035`, `AUD-040`) + `review/sonnet_ex` (Блок 4 и отказ Word) | 1. В `AttendanceMatrix.tsx` считать часы недели через `const lessonHours = lesson.hours \|\| record.hours \|\| 2;`.<br>2. В `AttendanceTracker.tsx` использовать `buildDayLessons` из `utils/dayLessons.ts`, выводить все 4 блока в текстовой сводке (`Блок 1: ${b1} \| Блок 2: ${b2} \| Блок 3: ${b3} \| Блок 4: ${b4} \| Итого: ${total} ч`), обрабатывать ошибку отказа Word-экспорта (`result.success === false`) и показывать `toast.success('Посещаемость сохранена')` при ручной отметке студента. |
| `components/ClassCard.tsx`<br>`components/DayColumn.tsx`<br>`components/SwipeableDays.tsx`<br>`components/BugReportModal.tsx`<br>`components/MyAbsencesModal.tsx` | Из `review/glm` (`React.memo`) + `review/sonnet_h/bugfix.patch` | 1. Обернуть экспорт `ClassCard`, `DayColumn`, `SwipeableDays` в `React.memo(...)`.<br>2. В `BugReportModal.tsx` заменить `Отправка в ТГК...` на `Отправляем…`.<br>3. В `MyAbsencesModal.tsx` заменить тост при отвязке на `Вы отвязаны от списка группы. Отметки остаются в журнале старосты`. |
| `App.tsx` *(обновление)* | Синтез `review/glm` + `review/sonnet_ex` + `review/sonnet_h` | 1. Подключить `useSamaraDayTick(60000)`, `useOnlineStatus()`, `todayDayName` от `[liveNow]`, `AbortController` в `handleRefresh` и `deleteMyData` из `utils/personalData.ts` (тост при удалении: `Привязка к списку группы снята. Отметки остаются в журнале старосты`).<br>2. Обернуть `handleUpdateLesson` и `handleResetLesson` в `useCallback` (список зависимостей: `[canEdit, currentGroupId, scheduleOverrides, subjectTeachers, attendanceRecords, selectedWeek, markAttendance]`).<br>3. В `handleUpdateLesson` использовать `buildLessonOverride` и `describeLessonSave` (из `utils/lessonOverrides.ts`) + `clearFrozenTeachers` (из `utils/teacherOverrides.ts`). Вызывать `markAttendance` только если `cancelChanged` वास्तव में изменился!<br>4. В `handleSaveSubjectTeachers` вызывать `clearFrozenTeachers` и `clearTeacherOverridesForChangedKeys`, обновлять `scheduleOverrides` и пушить оба поля в облако.<br>5. Подключить `pinnedTeachers = countPinnedTeachers(...)` и `handleUnpinTeachers` и передать их в `<SubjectTeachersModal pinned={pinnedTeachers} onUnpin={handleUnpinTeachers} />`.<br>6. **Закрытие `AUD-043` (`test_schedule_sync.ts`):** в резолвере преподавателя карточки пары проверять `override.teacher !== undefined ? override.teacher : ...` (чтобы явная очистка поля преподавателя `''` для одной пары не заменялась дефолтным преподавателем через `\|\|`), а в `handleResetLesson` сбрасывать оверрайд пары до исходного состояния. |

---

### ФАЗА 5. CI/CD, СКРИПТЫ БЭКАПА И ЕДИНЫЙ ТЕСТОВЫЙ КОНТУР (`tests/run_all.ts`)

1. **Бэкап KV (`scripts/kv-backup-lib.mjs`):** применить дифф `AUD-042` из `review/glm` (пагинация `listKeys` по `cursor` для $>1000$ ключей и минимальный TTL 1 час при `restoreBackup`).
2. **GitHub Actions (`.github/workflows/ci-checks.yml` и `deploy.yml`):**
   - Обновить `ci-checks.yml` из `review/glm` (`npx tsc --noEmit`, `npm test`, `npm run build`).
   - В `deploy.yml` убрать дублирующий шаг деплоя и убрать `continue-on-error: true` на деплое.
3. **Честный раннер `tests/run_all.ts`:**
   - Взять переписанный `tests/run_all.ts` из `review/glm` (с перехватом `process.exit`, проверкой маркеров `❌ | [FAIL] | ✗ FAIL | >>> BUG`, подсчетом `UNKNOWN`), добавить вызов `__resetRateLimiters()` (из `cloudflare-worker.js`) перед каждым сьютом, убрать `test_schedule_sync` из `KNOWN_FAILURES` (так как мы закрываем `AUD-043`) и включить в `MANIFEST` все актуальные тестовые сьюты из трех ревью:
     * **50 базовых сьютов** (с обновленными `test_api_v3.ts`, `test_p0_regressions.ts`, `test_security_audit.ts`, `test_group_id.ts`, `test_group_migration.ts`, `test_ingt209_schedule.ts`, `test_qa_ingt209_verification.ts`, `test_stage1_ui_and_double_hours.ts`, `test_telegram_webapp.ts`, `test_auth_hashes.ts`, `test_tma_resilience_e2e.ts`).
     * **15 новых сьютов из `review/glm`:**
       `test_concurrent_att_sync`, `test_sync_union_merge`, `test_aud004_stale_snapshot`, `test_aud006_semester`, `test_aud012_homework_merge`, `test_worker_secrets`, `test_cache_headers`, `test_aud023_cloud_sync_engine`, `test_delete_my_data`, `test_aud027_group_canon`, `test_aud031_render_perf`, `test_aud033_nightly_guard`, `test_aud034_group_chunks`, `test_aud037_safe_storage`, `test_aud041_online_status`, `test_aud042_kv_backup`.
     * **5 новых сьютов из `review/sonnet_ex`:**
       `test_attendance_convergence`, `test_followup_hardening`, `test_lesson_overrides`, `test_official_week_assembly`, `test_useful_suggestions`.
     * **4 новых сьюта из `review/sonnet_h`:**
       `test_d1_attendance`, `test_d1_client`, `test_bugfix_oct24`, `test_bot_welcome`.

---

## 4. ГОТОВЫЕ ПРОМПТЫ ДЛЯ ПОШАГОВОГО ЗАПУСКА АГЕНТА ANTIGRAVITY 2.0

После того как ты почистишь папку `review/` по Разделу 1 и положишь её в корень проекта (`./review/`), отправляй агенту эти промпты по очереди.

### 🚀 ПРОМПТ 1 (Старт и Фаза 1 — Сервер, D1, Предложка «Полезного» и Приветствие бота)
> **Скопировать и отправить агенту:**
> «Прочитай целиком файл `MASTER_AUDIT_AND_ARCHITECTURE_PLAN.md` в корне проекта — это наш главный архитектурный стандарт. В корне проекта лежит папка `./review/` с тремя подпапками (`./review/glm`, `./review/sonnet_ex`, `./review/sonnet_h`).
> Выполни **Фазу 1 (Серверный слой)**:
> 1. Скопируй `migrations/0001_attendance.sql` и `worker/attendance_d1.js` из `./review/sonnet_h/d1-migration/`.
> 2. Обнови `cloudflare-worker.js` и `wrangler.toml`, аккуратно объединив изменения из:
>    - `./review/sonnet_h/d1-migration/cloudflare-worker.d1.patch` (маршруты D1 `/v3/att/ops`, `/v3/att/changes`, `/v3/admin/att/migrate` и интеграция с `worker/attendance_d1.js`);
>    - `./review/sonnet_ex/samgtu-all-in-one-v2.patch` (`sanitizeUsefulItem`, in-memory лимитер `rlBuckets` + `__resetRateLimiters`, `handleUsefulSuggestions` для `/v3/useful/*` с лимитом `SUGGEST_PER_USER_PER_HOUR = 10` и удалением `delete published.submittedBy` при публикации в `/v3/useful/resolve`, фильтрация `tombstones` в `/sync/*`);
>    - `./review/sonnet_h/bot_welcome.patch` (приветствие бота на `/start` и `/help` в `/tg/webhook`);
>    - CAS-защита чтения месяца в `PUT /v3/att` из Раздела 3 Фазы 1 плана (`500 Stored attendance is unreadable` при битом JSON и проверка `(attRaw && current.ver !== expectedBaseVer) || (!attRaw && expectedBaseVer > 0)`);
>    - функции `mergeHomeworkGroupSlice`, `mergeUsefulGroupSlice`, `mergeScheduleGroupSlice`, разделение секрета `TG_WEBHOOK_SECRET` (503 без фолбэка на `APP_SECRET`) и заголовки `Cache-Control: private, no-store` из `./review/glm/glm_all_diffs.patch`. Экспорт `createTelegramInitData` в `cloudflare-worker.js` сохрани, а также создай `tests/worker_test_helpers.ts`.
> 3. Скопируй тесты `tests/helpers/d1_shim.ts`, `tests/test_d1_attendance.ts`, `tests/test_bot_welcome.ts` (из `./review/sonnet_h/`), `tests/test_useful_suggestions.ts`, `tests/test_followup_hardening.ts` (из `./review/sonnet_ex/samgtu-all-in-one-v2.patch`), `tests/test_worker_secrets.ts`, `tests/test_cache_headers.ts`, `tests/test_sync_union_merge.ts` (из `./review/glm/`) и прогони их через `npx tsx`. Убедись, что все они проходят на 100%.»

---

### 🚀 ПРОМПТ 2 (Фаза 2 — Клиент D1, Синхронизация посещаемости, Дебаунс 2.5с и SafeStorage)
> **Скопировать и отправить агенту:**
> «Переходим к **Фазе 2 (Синхронизация посещаемости и клиент D1)** согласно `MASTER_AUDIT_AND_ARCHITECTURE_PLAN.md`:
> 1. Скопируй `utils/attendanceD1Client.ts` из `./review/sonnet_h/d1-migration/utils/attendanceD1Client.ts`.
> 2. Создай `utils/attendanceCloudSync.ts` из `./review/sonnet_ex/samgtu-all-in-one-v2.patch`.
> 3. Скопируй `utils/safeStorage.ts` из `./review/glm/glm_samgtu-fix-package/fix-package-staging/new/utils/safeStorage.ts`.
> 4. Обнови `utils/attendanceStorage.ts`, объединив изменения из `./review/sonnet_ex/samgtu-all-in-one-v2.patch` (`rebaseAttendanceBaseFromServer`, `isStaleRead`, `noteSeenVer`, `pullAttendanceSnapshotFromV3`) и `./review/sonnet_h/d1-migration/utils_attendanceStorage.d1client.patch` (`syncAttendanceViaD1Ops` и `pullMonthsViaD1Changes`). Обрати особое внимание: в `pullAttendanceSnapshotFromV3` проверка `isStaleRead` должна применяться только в ветке KV-фолбэка (`d1Months === null`), а когда данные пришли из `d1Months`, все запрошенные месяцы сразу добавляются в `fetchedMonths`. Формат ключей уроков оставляй `MM-DD.N`.
> 5. Обнови `attendance.ts`: подключи `pullMergePush`, `markSnapshotPushed`, `safeSetItem`/`safeGetItem`, внедрить честный дебаунс 2500 мс после последнего тапа (`scheduleSync` + `flushSyncNow`), экспортируй `syncAttendanceWithCloud` и убери внутренний вызов `toast.success` и импорт `sonner` из `attendance.ts`.
> 6. Скопируй и запусти тесты `tests/test_d1_client.ts`, `tests/test_attendance_convergence.ts`, `tests/test_concurrent_att_sync.ts`, `tests/test_aud004_stale_snapshot.ts`, `tests/test_aud037_safe_storage.ts`, `tests/test_p0_regressions.ts`. Все они должны быть зелеными!»

---

### 🚀 ПРОМПТ 3 (Фаза 3 — Домен групп, Сверка расписания, Ночной синк и Семестр 2027)
> **Скопировать и отправить агенту:**
> «Выполни **Фазу 3 (Домен групп, Сверка расписания, Ночной синк и Семестр)** по `MASTER_AUDIT_AND_ARCHITECTURE_PLAN.md`:
> 1. Скопируй `utils/officialWeeks.ts` и `utils/scheduleCompare.ts` из `./review/sonnet_h/`.
> 2. Примени обновления из `./review/glm/` для `utils/groupId.ts`, `utils/groupAliases.ts` (удаление коллизии `ingt-109`), `utils/groupMigration.ts`, `utils/scheduleLoader.ts`, `index.tsx` (`migrateLegacyGroupKeys`), `utils/samaraDate.ts` (`generateDefaultSemesterConfig`) и `scripts/generate_group_chunks.ts` (с переименованием 19 битых файлов расписаний в `public/schedules/`).
> 3. Обнови `utils/samgtuGroupMap.ts` (`lkVerified: true` для `ingt-310`), `utils/samgtuParser.ts` (`deriveLessonIdPrefix`, `lookupOfficialTeacher`, `convertOfficialSamgtuToWeekData` из `./review/sonnet_ex/samgtu-all-in-one-v2.patch` + `makeGroupId` и `getDefaultSemesterStart` из `./review/glm/`).
> 4. В `utils/cloudSync.ts` добавь `fetchJsonMeta` (с ETag / `If-None-Match`), `fetchHomeworkSlice`, экспортируй обе функции `fetchOfficialWeeks` и `fetchOfficialCycleWeeks`, и обнови `syncOfficialGroupSchedule` (с передачей `SCHEDULE_REGISTRY[groupId]` в `convertOfficialSamgtuToWeekData`).
> 5. Обнови `components/AdminPanel.tsx` (сверка через `fetchOfficialCycleWeeks`, подгрузка `loadGroupSchedule`, сравнение через `compareWithOfficial`, проверка `groupConf.lkVerified`) и серверные скрипты `scripts/nightly_sync.ts` и `scripts/sync_official_schedule.ts` (скользящее окно `officialWeeksForCycle` из `sonnet_h` + по-недельная защита `applyPerWeekGuards` из `glm`).
> 6. Прогони тесты `test_bugfix_oct24.ts`, `test_official_week_assembly.ts`, `test_aud006_semester.ts`, `test_aud027_group_canon.ts`, `test_aud033_nightly_guard.ts`, `test_aud034_group_chunks.ts`, `test_group_id.ts`, `test_group_migration.ts`, `test_ingt209_schedule.ts`, `test_qa_ingt209_verification.ts`.»

---

### 🚀 ПРОМПТ 4 (Фаза 4 и Фаза 5 — Преподаватели БЖД, UI-компоненты, Тосты, CI и Финальный прогон)
> **Скопировать и отправить агенту:**
> «Выполни **Фазу 4 и Фазу 5 (Преподаватели, Оверрайды пар, UI и Финальный раннер)** по `MASTER_AUDIT_AND_ARCHITECTURE_PLAN.md`:
> 1. Создай `utils/lessonOverrides.ts` (из `./review/sonnet_ex/samgtu-all-in-one-v2.patch`) и `utils/teacherOverrides.ts` (из `./review/sonnet_h/teacherOverrides.ts`).
> 2. Скопируй из `./review/glm/` утилиты `utils/homeworkMerge.ts`, `utils/cloudSyncEngine.ts`, `utils/useCloudSync.ts`, `utils/personalData.ts`, `utils/useOnlineStatus.ts`, `utils/dayLessons.ts`, и обнови `utils/useNow.ts`, `utils/upload.ts`, `types.ts`, `utils/exportWord.ts`.
> 3. Обнови `utils/usefulStorage.ts`, `components/UsefulTracker.tsx`, `components/HomeworkTracker.tsx`, `components/SubjectTeachersModal.tsx` (`pinned` и `onUnpin`), `components/AttendanceTracker.tsx`, `components/AttendanceMatrix.tsx`, `components/ClassCard.tsx`, `components/DayColumn.tsx`, `components/SwipeableDays.tsx`, `components/BugReportModal.tsx`, `components/MyAbsencesModal.tsx` и `App.tsx` строго по таблице Фазы 4 (включая закрытие `AUD-043` для `test_schedule_sync.ts`).
> 4. Обнови `scripts/kv-backup-lib.mjs`, `.github/workflows/ci-checks.yml`, `.github/workflows/deploy.yml` и собери финальный `tests/run_all.ts` со всеми тестовыми сьютами (убрав `test_schedule_sync` из `KNOWN_FAILURES`).
> 5. Удали временную папку `./review/` (или убедись, что она не попадает в сборку) и выполни финальную приемку:
>    - `npx tsc --noEmit` (должно быть 0 ошибок)
>    - `npx tsx tests/run_all.ts` (все сьюты PASS, 0 FAILED, 0 XFAIL)
>    - `npm run build && node scripts/check-dist.mjs` (успешная сборка).»