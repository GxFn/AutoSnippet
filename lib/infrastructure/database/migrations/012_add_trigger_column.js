/**
 * Migration 012: Add `trigger` column to recipes table
 *
 * `trigger` is a quick-activation keyword (e.g. @forEach, @singleton)
 * that allows users to quickly locate and insert a snippet.
 *
 * Previously only stored in candidates.metadata_json and lost during
 * Candidate → Recipe promotion. This migration promotes it to a
 * first-class column on recipes for indexing and search.
 *
 * Also back-fills from candidates.metadata_json when a recipe has
 * a source_candidate_id.
 *
 * Idempotent — skips if column already exists.
 */
export default function migrate(db) {
  const columns = db.prepare("PRAGMA table_info('recipes')").all();
  const existing = new Set(columns.map(c => c.name));

  // ── 1. Add column ──
  if (!existing.has('trigger')) {
    db.exec(`ALTER TABLE recipes ADD COLUMN "trigger" TEXT DEFAULT ''`);
    // Index for fast prefix matching (@xxx)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_recipes_trigger ON recipes("trigger")`);
  }

  // ── 2. Back-fill from candidate metadata ──
  try {
    const rows = db.prepare(`
      SELECT r.id, c.metadata_json
      FROM recipes r
      JOIN candidates c ON r.source_candidate_id = c.id
      WHERE (r."trigger" IS NULL OR r."trigger" = '')
        AND c.metadata_json IS NOT NULL
        AND c.metadata_json != '{}'
    `).all();

    if (rows.length > 0) {
      const update = db.prepare(`UPDATE recipes SET "trigger" = ? WHERE id = ?`);
      const tx = db.transaction(() => {
        for (const row of rows) {
          try {
            const meta = JSON.parse(row.metadata_json);
            if (meta.trigger && meta.trigger.trim()) {
              update.run(meta.trigger.trim(), row.id);
            }
          } catch { /* skip parse errors */ }
        }
      });
      tx();
    }
  } catch {
    // candidates table may not exist or other issues — skip back-fill
  }
}
