/**
 * Migration 006: Guard Violations Table
 * 
 * 将 Guard 违反记录从 JSON 文件迁移到 SQLite。
 * 同时扩展 guard_rules 表，增加 V1 兼容字段 (languages_json, dimension, note)。
 */
export default function migrate(db) {
  // ── 1. guard_violations 表 ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS guard_violations (
      id              TEXT PRIMARY KEY,
      file_path       TEXT NOT NULL,
      triggered_at    TEXT NOT NULL,
      violation_count INTEGER DEFAULT 0,
      summary         TEXT,
      violations_json TEXT DEFAULT '[]',
      created_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_guard_violations_file ON guard_violations(file_path);
    CREATE INDEX IF NOT EXISTS idx_guard_violations_time ON guard_violations(triggered_at);
  `);

  // ── 2. 给 guard_rules 表补充 V1 兼容字段（表可能不存在） ──
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='guard_rules'").all();
  if (tables.length === 0) return;

  const columns = db.pragma('table_info(guard_rules)').map(c => c.name);

  if (!columns.includes('languages_json')) {
    db.exec(`ALTER TABLE guard_rules ADD COLUMN languages_json TEXT DEFAULT '[]'`);
  }
  if (!columns.includes('dimension')) {
    db.exec(`ALTER TABLE guard_rules ADD COLUMN dimension TEXT`);
  }
  if (!columns.includes('note')) {
    db.exec(`ALTER TABLE guard_rules ADD COLUMN note TEXT`);
  }
}
