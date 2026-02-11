/**
 * Migration 011: Add first-class i18n columns to recipes table
 *
 * Promotes summary_cn / summary_en / usage_guide_cn / usage_guide_en
 * from dimensions_json blob to dedicated columns for clean querying
 * and simpler front-end ↔ back-end round-trip.
 *
 * Also back-fills existing data from dimensions_json where possible.
 *
 * Idempotent — skips columns that already exist.
 */
export default function migrate(db) {
  const columns = db.prepare("PRAGMA table_info('recipes')").all();
  const existing = new Set(columns.map((c) => c.name));

  const needed = [
    ['summary_cn',      'TEXT'],
    ['summary_en',      'TEXT'],
    ['usage_guide_cn',  'TEXT'],
    ['usage_guide_en',  'TEXT'],
  ];

  for (const [col, def] of needed) {
    if (!existing.has(col)) {
      db.exec(`ALTER TABLE recipes ADD COLUMN ${col} ${def}`);
    }
  }

  // ── Back-fill from dimensions_json for existing rows ──
  const rows = db.prepare(
    `SELECT id, dimensions_json, description FROM recipes WHERE dimensions_json IS NOT NULL AND dimensions_json != '{}'`
  ).all();

  if (rows.length > 0) {
    const update = db.prepare(`
      UPDATE recipes
      SET summary_cn     = COALESCE(summary_cn, ?),
          summary_en     = COALESCE(summary_en, ?),
          usage_guide_cn = COALESCE(usage_guide_cn, ?),
          usage_guide_en = COALESCE(usage_guide_en, ?)
      WHERE id = ?
    `);

    const tx = db.transaction(() => {
      for (const row of rows) {
        let dims = {};
        try { dims = JSON.parse(row.dimensions_json); } catch { continue; }

        const sCn = dims.summaryCn || dims.summary || row.description || null;
        const sEn = dims.summaryEn || null;
        const uCn = dims.usageGuideCn || dims.usageGuide || null;
        const uEn = dims.usageGuideEn || null;

        if (sCn || sEn || uCn || uEn) {
          update.run(sCn, sEn, uCn, uEn, row.id);
        }
      }
    });
    tx();
  }
}
