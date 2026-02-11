/**
 * Migration 014: Add missing candidate indexes
 *
 * - idx_candidates_category  — listCandidates / batch-delete 现在支持 category 过滤
 * - idx_candidates_source    — 按来源查询 (bootstrap-scan / mcp / manual 等)
 *
 * Idempotent — CREATE INDEX IF NOT EXISTS。
 */
export default function migrate(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_candidates_category ON candidates(category);
    CREATE INDEX IF NOT EXISTS idx_candidates_source   ON candidates(source);
  `);
}
