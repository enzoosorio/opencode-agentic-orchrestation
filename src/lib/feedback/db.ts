import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type { Features } from "../features/schema.ts";
import type { FeedbackStat } from "../router/rank.ts";

export type Signal =
  | "accepted"
  | "regenerated"
  | "switched"
  | "rated_up"
  | "rated_down"
  | "abandoned"
  | "continued";

const SIGNAL_WEIGHT: Record<Signal, number> = {
  rated_up: 1.0,
  rated_down: -1.0,
  switched: -0.5,
  regenerated: -0.3,
  abandoned: -0.4,
  accepted: 0.4,
  continued: 0.3,
};

export interface FeedbackEvent {
  features: Features;
  model_name: string;
  variant: string;
  signal: Signal;
  note?: string | null;
  ts?: number;
}

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;
  const dbPath = process.env.FEEDBACK_DB_PATH ?? "./data/feedback.db";
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      task_type TEXT NOT NULL,
      domain TEXT NOT NULL,
      complexity TEXT NOT NULL,
      features_json TEXT NOT NULL,
      model_name TEXT NOT NULL,
      variant TEXT NOT NULL,
      signal TEXT NOT NULL,
      weight REAL NOT NULL,
      note TEXT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_combo ON events(task_type, domain, complexity, model_name, variant);
  `);
  return _db;
}

export function recordEvent(ev: FeedbackEvent): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO events (ts, task_type, domain, complexity, features_json, model_name, variant, signal, weight, note)
    VALUES (@ts, @task_type, @domain, @complexity, @features_json, @model_name, @variant, @signal, @weight, @note)
  `);
  stmt.run({
    ts: ev.ts ?? Date.now(),
    task_type: ev.features.task_type,
    domain: ev.features.domain,
    complexity: ev.features.complexity,
    features_json: JSON.stringify(ev.features),
    model_name: ev.model_name,
    variant: ev.variant,
    signal: ev.signal,
    weight: SIGNAL_WEIGHT[ev.signal],
    note: ev.note ?? null,
  });
}

export interface AggregateRow {
  task_type: string;
  domain: string;
  complexity: string;
  model_name: string;
  variant: string;
  net_score: number;
  samples: number;
}

/** Aggregated stats for the ranker. Net score = sum(weight) / samples ∈ [-1, +1]. */
export function loadFeedbackStats(): FeedbackStat[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT task_type, domain, complexity, model_name, variant,
             SUM(weight)*1.0 / COUNT(*) AS net_score,
             COUNT(*) AS samples
      FROM events
      GROUP BY task_type, domain, complexity, model_name, variant
    `,
    )
    .all() as AggregateRow[];

  return rows.map((r) => ({
    key: `${r.task_type}|${r.domain}|${r.complexity}`,
    model: r.model_name,
    variant: r.variant,
    score: Math.max(-1, Math.min(1, r.net_score)),
    samples: r.samples,
  }));
}

/** For dev / inspection. */
export function recentEvents(limit = 50): unknown[] {
  return getDb()
    .prepare("SELECT * FROM events ORDER BY ts DESC LIMIT ?")
    .all(limit);
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
