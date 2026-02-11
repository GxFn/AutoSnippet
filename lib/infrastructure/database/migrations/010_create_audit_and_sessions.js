/**
 * Migration 010: Create audit_logs and sessions tables
 *
 * 修复关键缺失：audit_logs 和 sessions 表在 005 迁移中被声明为"保留"，
 * 但实际从未创建。连带影响：
 *   - AuditStore 所有写入/查询静默失败
 *   - ComplianceEvaluator 的 P2 (Human Oversight) 评分为虚假满分
 *   - SessionManager 的 CRUD 全部抛错
 */
export default function migrate(db) {
  // ============================================================
  // 1. audit_logs — 审计日志
  //    消费方: AuditStore.js, ComplianceEvaluator.js
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id              TEXT PRIMARY KEY,
      timestamp       INTEGER NOT NULL,
      actor           TEXT NOT NULL,
      actor_context   TEXT DEFAULT '{}',
      action          TEXT NOT NULL,
      resource        TEXT,
      operation_data  TEXT DEFAULT '{}',
      result          TEXT NOT NULL,
      error_message   TEXT,
      duration        INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_audit_actor     ON audit_logs(actor);
    CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_result    ON audit_logs(result);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
  `);

  // ============================================================
  // 2. sessions — 会话管理
  //    消费方: SessionManager.js
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id              TEXT PRIMARY KEY,
      scope           TEXT NOT NULL,
      scope_id        TEXT,
      context         TEXT DEFAULT '{}',
      metadata        TEXT DEFAULT '{}',
      actor           TEXT,
      created_at      INTEGER NOT NULL,
      last_active_at  INTEGER,
      expired_at      INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_scope    ON sessions(scope);
    CREATE INDEX IF NOT EXISTS idx_sessions_actor    ON sessions(actor);
    CREATE INDEX IF NOT EXISTS idx_sessions_expired  ON sessions(expired_at);
  `);

  process.stderr.write('  ✅ 010_create_audit_and_sessions: audit_logs + sessions tables created\n');
}
