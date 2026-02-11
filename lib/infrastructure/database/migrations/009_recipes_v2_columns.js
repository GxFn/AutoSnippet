/**
 * Migration 009: Ensure all V2 columns exist on recipes table
 *
 * Fixes databases created before migration 005 was finalized.
 * Idempotent — skips columns that already exist.
 */
export default function migrate(db) {
  const columns = db.prepare("PRAGMA table_info('recipes')").all();
  const existing = new Set(columns.map((c) => c.name));

  const needed = [
    ['knowledge_type', "TEXT DEFAULT 'code-pattern'"],
    ['kind', 'TEXT'],
    ['complexity', "TEXT DEFAULT 'intermediate'"],
    ['scope', 'TEXT'],
    ['content_json', "TEXT DEFAULT '{}'"],
    ['relations_json', "TEXT DEFAULT '{}'"],
    ['constraints_json', "TEXT DEFAULT '{}'"],
    ['quality_code_completeness', 'REAL DEFAULT 0'],
    ['quality_project_adaptation', 'REAL DEFAULT 0'],
    ['quality_documentation_clarity', 'REAL DEFAULT 0'],
    ['quality_overall', 'REAL DEFAULT 0'],
    ['dimensions_json', "TEXT DEFAULT '{}'"],
    ['tags_json', "TEXT DEFAULT '[]'"],
    ['adoption_count', 'INTEGER DEFAULT 0'],
    ['application_count', 'INTEGER DEFAULT 0'],
    ['guard_hit_count', 'INTEGER DEFAULT 0'],
    ['view_count', 'INTEGER DEFAULT 0'],
    ['success_count', 'INTEGER DEFAULT 0'],
    ['feedback_score', 'REAL DEFAULT 0'],
    ['published_by', 'TEXT'],
    ['published_at', 'INTEGER'],
    ['deprecation_reason', 'TEXT'],
    ['deprecated_at', 'INTEGER'],
    ['source_candidate_id', 'TEXT'],
    ['source_file', 'TEXT'],
  ];

  for (const [col, def] of needed) {
    if (!existing.has(col)) {
      db.exec(`ALTER TABLE recipes ADD COLUMN ${col} ${def}`);
    }
  }
}
