/**
 * Minimal D1Database stand-in on top of node:sqlite (a REAL SQLite engine: ON CONFLICT upserts, json_each,
 * CHECK constraints and transactions behave exactly as they do in D1). Used only by tests.
 *
 * - batch() runs all statements in one transaction (all-or-nothing), like D1.
 * - `latencyMs` makes every call yield to the event loop so concurrent requests really interleave.
 * - counters let tests assert how many statements / batches a request costs.
 */
import { DatabaseSync } from 'node:sqlite';

export class D1Shim {
  db = new DatabaseSync(':memory:');
  statements = 0;
  batches = 0;
  failNext = false;
  constructor(private latencyMs = 2) {}

  private wait() { return this.latencyMs ? new Promise(r => setTimeout(r, this.latencyMs)) : Promise.resolve(); }
  exec(sql: string) { this.db.exec(sql); }
  resetCounters() { this.statements = 0; this.batches = 0; }

  prepare(sql: string) { return new D1Stmt(this, sql, []); }

  runOne(sql: string, params: any[]) {
    this.statements++;
    const st = this.db.prepare(sql);
    if (/^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
      const rows = st.all(...params) as any[];
      return { results: rows.map(r => ({ ...r })), success: true, meta: { changes: 0 } };
    }
    const info: any = st.run(...params);
    return { results: [], success: true, meta: { changes: Number(info.changes) } };
  }

  async batch(stmts: D1Stmt[]) {
    await this.wait();
    if (this.failNext) { this.failNext = false; throw new Error('D1_ERROR: simulated outage'); }
    this.batches++;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = stmts.map(s => this.runOne(s.sql, s.params));
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}

export class D1Stmt {
  constructor(private shim: D1Shim, public sql: string, public params: any[]) {}
  bind(...params: any[]) { return new D1Stmt(this.shim, this.sql, params); }
  async first() { const r = await this.all(); return r.results[0] ?? null; }
  async all() { return (await this.shim.batch([this]))[0]; }
  async run() { return (await this.shim.batch([this]))[0]; }
}
