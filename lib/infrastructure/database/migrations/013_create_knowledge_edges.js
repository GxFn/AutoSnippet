/**
 * Migration 013: Create knowledge_edges table
 *
 * This table was referenced by KnowledgeGraphService but never actually
 * created in any migration. Migration 005 mentioned "preserving" it from
 * earlier schema, but since 005 is the earliest migration in the codebase
 * the table was never materialized.
 *
 * Columns match what KnowledgeGraphService expects:
 *   from_id, from_type, to_id, to_type, relation, weight, metadata_json
 *
 * Idempotent — skips if table already exists.
 */
export default function migrate(db) {
  // Check if table already exists
  const existing = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_edges'"
  ).get();

  if (existing) return;

  db.exec(`
    CREATE TABLE knowledge_edges (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id       TEXT NOT NULL,
      from_type     TEXT NOT NULL DEFAULT 'recipe',
      to_id         TEXT NOT NULL,
      to_type       TEXT NOT NULL DEFAULT 'recipe',
      relation      TEXT NOT NULL,
      weight        REAL DEFAULT 1.0,
      metadata_json TEXT DEFAULT '{}',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,

      UNIQUE (from_id, from_type, to_id, to_type, relation)
    );

    CREATE INDEX idx_ke_from      ON knowledge_edges(from_id, from_type);
    CREATE INDEX idx_ke_to        ON knowledge_edges(to_id, to_type);
    CREATE INDEX idx_ke_relation  ON knowledge_edges(relation);
  `);

  // ── Back-fill from recipes.relations_json ──
  try {
    const recipes = db.prepare(
      `SELECT id, relations_json FROM recipes WHERE relations_json IS NOT NULL AND relations_json != '{}'`
    ).all();

    const now = Math.floor(Date.now() / 1000);
    const insert = db.prepare(`
      INSERT OR IGNORE INTO knowledge_edges (from_id, from_type, to_id, to_type, relation, weight, metadata_json, created_at, updated_at)
      VALUES (?, 'recipe', ?, 'recipe', ?, 1.0, '{}', ?, ?)
    `);

    let count = 0;
    for (const r of recipes) {
      try {
        const rels = JSON.parse(r.relations_json);
        for (const [relType, targets] of Object.entries(rels)) {
          if (!Array.isArray(targets)) continue;
          for (const t of targets) {
            const targetId = t.target || t.id || (typeof t === 'string' ? t : null);
            if (targetId) {
              insert.run(r.id, targetId, relType, now, now);
              count++;
            }
          }
        }
      } catch { /* ignore parse errors */ }
    }

    if (count > 0) {
      process.stderr.write(`  ✅ 013_create_knowledge_edges: Created table + back-filled ${count} edges from relations_json\n`);
    } else {
      process.stderr.write(`  ✅ 013_create_knowledge_edges: Created table (no relations_json data to back-fill)\n`);
    }
  } catch (err) {
    process.stderr.write(`  ⚠️  013_create_knowledge_edges: Table created but back-fill failed: ${err.message}\n`);
  }
}
