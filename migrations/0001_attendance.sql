-- Attendance on Cloudflare D1 (cell-level LWW, atomic upserts, change feed).
-- Apply: wrangler d1 migrations apply samgtu-att --remote
--
-- WITHOUT ROWID: the primary key IS the table, so a mark costs 1 row for the PK plus one per secondary index
-- (D1 bills "rows written" including index entries).

-- Which groups are served from D1. Lives in D1 (strongly consistent) on purpose:
-- a KV flag could be read stale for ~60 s at another PoP and let writes leak into the old store.
CREATE TABLE IF NOT EXISTS att_groups (
  gid         TEXT PRIMARY KEY,
  storage     TEXT NOT NULL CHECK (storage = 'd1'),
  migrated_at INTEGER NOT NULL
) WITHOUT ROWID;

-- Monotonic per-group revision. Every write request bumps it once; changed rows carry the new value,
-- so GET /v3/att/changes?since=<rev> returns exactly what changed.
CREATE TABLE IF NOT EXISTS group_rev (
  gid TEXT PRIMARY KEY,
  rev INTEGER NOT NULL
) WITHOUT ROWID;

-- One row per (lesson, student slot). status '' is a tombstone ("present"/unmarked) that must outlive
-- an older, late-arriving offline edit. Anonymous slot ids only: no names, no Telegram ids.
CREATE TABLE IF NOT EXISTS marks (
  gid        TEXT    NOT NULL,
  day        TEXT    NOT NULL,                       -- YYYY-MM-DD (derived from lesson_key)
  lesson_key TEXT    NOT NULL,                       -- today MM-DD.N, later YYYY-MM-DD.HHMM[.sub]
  slot       TEXT    NOT NULL,
  status     TEXT    NOT NULL CHECK (status IN ('u', 'e', '')),
  hlc        INTEGER NOT NULL,                       -- effective write time (ms), clamped server-side
  dev        TEXT    NOT NULL DEFAULT '',            -- deterministic tie-break
  rev        INTEGER NOT NULL,
  PRIMARY KEY (gid, day, lesson_key, slot)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_marks_slot ON marks (gid, slot, day);   -- "my absences" reads only the student's rows
CREATE INDEX IF NOT EXISTS idx_marks_rev  ON marks (gid, rev);         -- change feed

-- Lesson-level facts. cancelled and hours are independent LWW registers.
CREATE TABLE IF NOT EXISTS lesson_state (
  gid        TEXT    NOT NULL,
  day        TEXT    NOT NULL,
  lesson_key TEXT    NOT NULL,
  cancelled  INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1)),
  cancel_hlc INTEGER NOT NULL DEFAULT 0,
  hours      INTEGER CHECK (hours IS NULL OR (hours BETWEEN 1 AND 12)),
  hours_hlc  INTEGER NOT NULL DEFAULT 0,
  rev        INTEGER NOT NULL,
  PRIMARY KEY (gid, day, lesson_key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_state_rev ON lesson_state (gid, rev);
