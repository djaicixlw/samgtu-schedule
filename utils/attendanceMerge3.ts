export type CellStatus = 'u' | 'e' | null;

export interface RecLike {
  docId?: string;
  groupId: string;
  date: string; // YYYY-MM-DD
  lessonId: string;
  absentStudentIds: number[];
  excusedStudentIds?: number[];
  isCancelled?: boolean;
  hours?: number;
  updatedAt?: any;
  updatedBy?: string;
}

export interface BaseEntry {
  a: number[];
  e: number[];
  c: boolean;
}

export type BaseMap = Record<string, BaseEntry>;

export const EMPTY_ENTRY: BaseEntry = { a: [], e: [], c: false };

export const recKey = (r: { date: string; lessonId: string }): string => `${r.date}_${r.lessonId}`;

export const toBase = (r: RecLike): BaseEntry => ({
  a: Array.from(new Set(r.absentStudentIds || [])).sort((x, y) => x - y),
  e: Array.from(new Set(r.excusedStudentIds || [])).sort((x, y) => x - y),
  c: Boolean(r.isCancelled)
});

export const snapshotBase = (recs: RecLike[]): BaseMap => {
  const out: BaseMap = {};
  for (const r of recs) {
    if (r && r.date && r.lessonId) out[recKey(r)] = toBase(r);
  }
  return out;
};

const cellOf = (e: { a: number[]; e: number[] }, id: number): CellStatus =>
  e.a.includes(id) ? 'u' : e.e.includes(id) ? 'e' : null;

export function diffRecord(rec: RecLike, base: BaseEntry | undefined): {
  cells: Array<{ id: number; status: CellStatus }>;
  cancelChanged: boolean;
} {
  const cur = toBase(rec);
  const old = base || EMPTY_ENTRY;
  const ids = new Set<number>([...cur.a, ...cur.e, ...old.a, ...old.e]);
  const cells: Array<{ id: number; status: CellStatus }> = [];
  for (const id of ids) {
    const c = cellOf(cur, id);
    if (c !== cellOf(old, id)) cells.push({ id, status: c });
  }
  return { cells, cancelChanged: cur.c !== old.c };
}

export function merge3<T extends RecLike>(
  local: T[],
  base: BaseMap | null,
  remote: T[],
  fetchedMonths: Iterable<string>
): { merged: T[]; base: BaseMap } {
  const fetched = new Set(fetchedMonths);
  const L = new Map<string, T>();
  const R = new Map<string, T>();
  for (const r of local || []) if (r && r.date && r.lessonId) L.set(recKey(r), r);
  for (const r of remote || []) if (r && r.date && r.lessonId) R.set(recKey(r), r);

  const merged: T[] = [];
  const baseOut: BaseMap = { ...(base || {}) };
  const keys = new Set<string>([...L.keys(), ...R.keys()]);

  for (const key of keys) {
    const l = L.get(key);
    const r = R.get(key);
    if (!l) {
      merged.push(r as T);
      baseOut[key] = toBase(r as T);
      continue;
    }
    const known = base ? base[key] : undefined;
    const rEntry: BaseEntry | undefined = r
      ? toBase(r)
      : (known && fetched.has(key.slice(0, 7)) ? EMPTY_ENTRY : undefined);
    if (!rEntry) {
      merged.push(l);
      continue;
    }
    const b: BaseEntry = base === null ? rEntry : (known || EMPTY_ENTRY);
    const lE = toBase(l);
    const ids = new Set<number>([...lE.a, ...lE.e, ...b.a, ...b.e, ...rEntry.a, ...rEntry.e]);
    const a: number[] = [], e: number[] = [], ba: number[] = [], be: number[] = [];
    let localChanged = false;

    for (const id of ids) {
      const lc = cellOf(lE, id), bc = cellOf(b, id), rc = cellOf(rEntry, id);
      const localEdited = lc !== bc;
      const res = localEdited ? lc : rc;
      const bres = localEdited ? bc : rc;
      if (localEdited) localChanged = true;
      if (res === 'u') a.push(id); else if (res === 'e') e.push(id);
      if (bres === 'u') ba.push(id); else if (bres === 'e') be.push(id);
    }

    const cLocalEdited = lE.c !== b.c;
    if (cLocalEdited) localChanged = true;
    baseOut[key] = {
      a: ba.sort((x, y) => x - y),
      e: be.sort((x, y) => x - y),
      c: cLocalEdited ? b.c : rEntry.c
    };
    merged.push({
      ...l,
      absentStudentIds: a.sort((x, y) => x - y),
      excusedStudentIds: e.sort((x, y) => x - y),
      isCancelled: cLocalEdited ? lE.c : rEntry.c,
      hours: l.hours ?? r?.hours,
      updatedAt: localChanged ? l.updatedAt : (r?.updatedAt ?? l.updatedAt)
    });
  }
  return { merged, base: baseOut };
}
