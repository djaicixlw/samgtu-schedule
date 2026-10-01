# Контракт API v3 («Слепой сервер») — SamGTU Schedule

Документ фиксирует спецификацию интерфейсов между клиентом (Telegram Mini App) и бэкендом (Cloudflare Worker) для архитектуры v3.

---

## 1. Общие принципы и безопасность

1. **Идентификация и авторизация:**
   - Все запросы (кроме публичного чтения расписаний `GET /samgtu-schedule` и вебхука) требуют заголовок:
     `X-Telegram-Init-Data: <сырая строка initData из Telegram.WebApp.initData>`
   - Worker проверяет валидность HMAC-SHA256 подписи строки через `TELEGRAM_BOT_TOKEN` и её свежесть (возраст `auth_date` не более 24 часов).
   - Вычисляется «слепой» идентификатор пользователя:
     `userBlindId = HMAC-SHA256("tg:" + tgId, ID_PEPPER)` (где `ID_PEPPER` — закрытый 32-байтный секрет Worker).
   - Сырой Telegram ID **нигде не сохраняется в базе данных** (KV) и не логируется.

2. **Статусы ответов:**
   - `200 OK` / `201 Created` — успешный запрос.
   - `400 Bad Request` — ошибка валидации DTO / формата данных.
   - `401 Unauthorized` — отсутствует, просрочена или невалидна строка `initData`.
   - `403 Forbidden` — у пользователя нет прав (его `userBlindId` отсутствует в списке `staff` группы).
   - `404 Not Found` — запрашиваемый ресурс (слот, привязка, группа) не найден.
   - `409 Conflict` — конфликт версий при оптимистичной блокировке (передана устаревшая `baseVer`).
   - `410 Gone` — устаревший маршрут v1/v2 отключён.
   - `429 Too Many Requests` — превышен лимит частоты запросов.

3. **CORS:**
   - Заголовок `Access-Control-Allow-Origin` возвращает строго адрес из секрета `ALLOWED_ORIGINS` (адрес GitHub Pages). Дикие `*` запрещены.

---

## 2. Схема ключей Cloudflare KV (namespace: `APP_DATA`)

| Префикс ключа | Назначение | Формат значения | TTL |
|---|---|---|---|
| `g:{gid}` | Метаданные группы и права старост | `{ codeSalt: string, codeHash: string, codeVer: number, staff: string[], slots: string[] }` | Нет |
| `a:{gid}:{YYYY-MM}` | Отметки группы за месяц | `{ ver: number, slots: { [slotId: string]: { [lessonKey: string]: "e" \| "u" } }, cancelled: string[] }` | 200 дней (продлевается при записи) |
| `inv:{sha256(code)}` | Одноразовый инвайт студента | `{ gid: string, slot: string }` | 14 дней (1 209 600 с) |
| `u:{userBlindId}` | Привязка аккаунта к слоту | `{ gid: string, slot: string, consentVer: number, consentAt: number }` | Нет (до отзыва) |
| `rm:{messageId}` | Связка реплея тикета поддержки | `{ encChatId: string, iv: string }` (AES-GCM с `REPLY_KEY`) | 30 дней |
| `rl:{scope}` | Счётчик rate-limiter | целое число | 15–60 минут |

> **Спецификация ключей отметок (`lessonKey`):**
> Формат: `"MM-DD.n"`, где `MM-DD` — месяц и день (например `"10-15"`), `n` — номер пары (1..7).
> Значения: `"e"` (excused / уважительная), `"u"` (unexcused / неуважительная). Явка не сохраняется (принцип минимизации).
> `cancelled`: массив строк `"MM-DD.n"`, отменённые пары группы.

---

## 3. Эндпоинты старосты (Staff API)

### 3.1 `POST /v3/staff/claim`
Получение прав старосты группы по 80-битному коду.
- **Headers:** `X-Telegram-Init-Data`
- **Body:**
  ```json
  {
    "gid": "ingt-310",
    "code": "K7P2-9XQM-4TLD-8AB3"
  }
  ```
- **Логика:**
  1. Проверка rate-limit `rl:claim:{gid}` (не более 5 попыток за 15 мин).
  2. Загрузка `g:{gid}`.
  3. Проверка `code` через `pbkdf2(code, g.codeSalt, 100000)` и constant-time сравнение `safeEqual`.
  4. Добавление `userBlindId` в массив `g.staff` (если ещё нет).
  5. Сохранение `g:{gid}`.
- **Response:** `{ "ok": true }`

---

### 3.2 `POST /v3/slots`
Регистрация пула случайных base32-слотов для студентов группы (без имён).
- **Headers:** `X-Telegram-Init-Data`
- **Body:**
  ```json
  {
    "gid": "ingt-310",
    "slots": ["A7K2Q9X1", "B8M3R0Y2", "C9N4S1Z3"]
  }
  ```
- **Логика:**
  1. Проверка прав: `userBlindId` входит в `g:{gid}.staff`.
  2. Лимит слотов на группу: не более 60.
  3. Добавление уникальных слотов в `g:{gid}.slots`.
- **Response:** `{ "ok": true, "registered": 3 }`

---

### 3.3 `POST /v3/invites`
Публикация хэшей кодов приглашений для слотов.
- **Headers:** `X-Telegram-Init-Data`
- **Body:**
  ```json
  {
    "gid": "ingt-310",
    "items": [
      { "slot": "A7K2Q9X1", "hash": "sha256_hex_of_invite_code_1" },
      { "slot": "B8M3R0Y2", "hash": "sha256_hex_of_invite_code_2" }
    ]
  }
  ```
- **Логика:**
  1. Проверка прав старосты группы.
  2. Запись каждого элемента в `inv:{hash}` со значением `{ gid, slot }` и `expirationTtl: 1209600` (14 дней).
- **Response:** `{ "ok": true, "count": 2 }`

---

### 3.4 `GET /v3/att?gid={gid}&month={YYYY-MM}`
Получение отметок группы за указанный месяц.
- **Headers:** `X-Telegram-Init-Data`
- **Логика:**
  1. Проверка прав старосты группы.
  2. Чтение ключа `a:{gid}:{YYYY-MM}`.
  3. Если ключ отсутствует, возвращается `{ "ver": 0, "slots": {}, "cancelled": [] }`.
- **Response:**
  ```json
  {
    "ver": 4,
    "slots": {
      "A7K2Q9X1": {
        "10-02.1": "u",
        "10-05.3": "e"
      }
    },
    "cancelled": ["10-02.2"]
  }
  ```

---

### 3.5 `PUT /v3/att`
Сохранение пачки отметок старостой с версионным контролем (optimistic lock).
- **Headers:** `X-Telegram-Init-Data`
- **Body:**
  ```json
  {
    "gid": "ingt-310",
    "month": "2026-10",
    "baseVer": 4,
    "patch": {
      "A7K2Q9X1": {
        "10-02.1": "e",
        "10-05.3": null
      }
    },
    "cancel": {
      "10-02.2": true,
      "10-08.1": null
    }
  }
  ```
- **Логика:**
  1. Проверка прав старосты группы.
  2. Чтение `a:{gid}:{month}`. Если `currentVer !== baseVer`, вернуть `409 Conflict` со слепком `{ ver: currentVer, slots, cancelled }` для слияния на клиенте.
  3. Применение патча: удаление ключей при значении `null`, запись `"e"`/`"u"`.
  4. Обновление массива отменённых занятий.
  5. Инкремент версии: `ver = baseVer + 1`.
  6. Сохранение в KV с `expirationTtl: 17280000` (200 дней).
- **Response:** `{ "ver": 5 }`

---

### 3.6 `DELETE /v3/slot/{id}?gid={gid}`
Удаление студенческого слота старостой.
- **Headers:** `X-Telegram-Init-Data`
- **Логика:**
  1. Проверка прав старосты группы.
  2. Удаление слота из `g:{gid}.slots`.
  3. Удаление отметок данного слота из ключа текущего месяца `a:{gid}:{YYYY-MM}`.
- **Response:** `{ "ok": true }`

---

## 4. Эндпоинты студента (Student API)

### 4.1 `POST /v3/me/claim`
Привязка личного аккаунта к слоту в группе по коду приглашения.
- **Headers:** `X-Telegram-Init-Data`
- **Body:**
  ```json
  {
    "code": "7K2Q-9XQM",
    "consentVer": 1
  }
  ```
- **Логика:**
  1. Вычисление `hash = sha256(code.toUpperCase().trim())`.
  2. Поиск инвайта `inv:{hash}`. Если нет — `404 Not Found` («Код не найден или истёк»).
  3. Сохранение привязки в `u:{userBlindId}`:
     `{ gid: inv.gid, slot: inv.slot, consentVer: 1, consentAt: Date.now() }`.
  4. Удаление инвайта `inv:{hash}` (одноразовое использование).
- **Response:**
  ```json
  {
    "gid": "ingt-310",
    "slot": "A7K2Q9X1"
  }
  ```

---

### 4.2 `GET /v3/me?from={YYYY-MM}`
Просмотр студентом исключительно своих отметок.
- **Headers:** `X-Telegram-Init-Data`
- **Логика:**
  1. Чтение `u:{userBlindId}`. Если записи нет — `404 Not Found` (студент не привязан).
  2. Определение списка месяцев от `from` до текущего (максимум 5 месяцев семестра).
  3. Параллельное чтение `a:{gid}:{month}`.
  4. Фильтрация: извлекаются только записи, принадлежащие слоту `u.slot`. Другие слоты отсекаются на сервере.
- **Response:**
  ```json
  {
    "gid": "ingt-310",
    "slot": "A7K2Q9X1",
    "marks": {
      "2026-10": {
        "10-02.1": "e"
      }
    },
    "cancelled": {
      "2026-10": ["10-02.2"]
    }
  }
  ```

---

### 4.3 `DELETE /v3/me`
Отзыв согласия и немедленное удаление всех данных студента.
- **Headers:** `X-Telegram-Init-Data`
- **Логика:**
  1. Чтение `u:{userBlindId}`.
  2. Очистка отметок `slot` в активных месяцах семестра `a:{gid}:{YYYY-MM}`.
  3. Полное удаление ключа `u:{userBlindId}`.
- **Response:** `{ "ok": true }`

---

## 5. Обратная связь и баг-репорты (Bot Relay API)

### 5.1 `POST /report`
Отправка обращения разработчику без раскрытия личности в публичном канале.
- **Headers:** `X-Telegram-Init-Data`
- **Body:**
  ```json
  {
    "text": "Описание ошибки...",
    "diag": { "platform": "android", "appVer": "3.1.0", "groupId": "ingt-310" },
    "wantReply": true
  }
  ```
- **Логика:**
  1. Rate-limit: не более 5 обращений в час на `rl:rep:{userBlindId}`.
  2. Генерация номера тикета `#A7K2Q9`.
  3. Отправка личного сообщения владельцу через Telegram Bot API на `OWNER_CHAT_ID` с текстом обращения и техническими данными (текст экранируется).
  4. Если `wantReply === true`: шифрование `tgId` студента через AES-GCM (секрет `REPLY_KEY`) и запись `rm:{sentTelegramMessageId}` с TTL 30 дней.
- **Response:** `{ "ok": true, "ticketId": "A7K2Q9" }`

---

### 5.2 `POST /tg/webhook/{SECRET_PATH}`
Вебхук Telegram для ретрансляции ответа разработчика студенту.
- **Headers:** `X-Telegram-Bot-Api-Secret-Token: <SECRET_TOKEN>`
- **Логика:**
  1. Если заголовок не совпадает — `401 Unauthorized`.
  2. Проверка: входящее сообщение от `OWNER_CHAT_ID` и является ответом (`reply_to_message`).
  3. Поиск `rm:{reply_to_message.message_id}` в KV.
  4. Если найдено: расшифровка `chat_id` студента и отправка ботом:
     `"Ответ разработчика по обращению: ..."`
  5. Если сообщение не reply или от постороннего — ответ подсказкой, без сохранения.
- **Response:** `200 OK`
