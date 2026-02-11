/**
 * Migration 006: Kind 分层
 *
 * 为 recipes 表增加 kind 列，实现 Backstage 风格的实体分类：
 *   kind = 'rule'    → 规约性知识 (code-standard, code-style, best-practice, boundary-constraint)
 *   kind = 'pattern' → 模式性知识 (code-pattern, architecture, solution)
 *   kind = 'fact'    → 结构性知识 (code-relation, inheritance, call-chain, data-flow, module-dependency)
 *
 * 设计参考: docs/copilot/knowledge-base-architecture-v3.md
 */
export default function migrate(db) {
  // 1. 添加 kind 列（幂等：先检查列是否已存在）
  const columns = db.pragma('table_info(recipes)').map(c => c.name);
  if (!columns.includes('kind')) {
    db.exec(`ALTER TABLE recipes ADD COLUMN kind TEXT NOT NULL DEFAULT 'pattern'`);
  }

  // 2. 根据现有 knowledge_type 自动填充 kind
  db.exec(`
    UPDATE recipes SET kind = 'rule'
    WHERE knowledge_type IN ('code-standard', 'code-style', 'best-practice', 'boundary-constraint');
  `);

  db.exec(`
    UPDATE recipes SET kind = 'pattern'
    WHERE knowledge_type IN ('code-pattern', 'architecture', 'solution');
  `);

  db.exec(`
    UPDATE recipes SET kind = 'fact'
    WHERE knowledge_type IN ('code-relation', 'inheritance', 'call-chain', 'data-flow', 'module-dependency');
  `);

  // 3. 添加索引（按 kind 查询是主要访问模式）
  db.exec(`CREATE INDEX IF NOT EXISTS idx_recipes_kind ON recipes(kind)`);

  // 4. 复合索引用于 kind + status 的常见查询
  db.exec(`CREATE INDEX IF NOT EXISTS idx_recipes_kind_status ON recipes(kind, status)`);

  process.stderr.write('  ✅ 006_add_kind_column: Added kind column with auto-populated values\n');
}
