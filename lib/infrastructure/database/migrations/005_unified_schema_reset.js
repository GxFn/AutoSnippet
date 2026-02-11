/**
 * Migration 005: Unified Schema Reset
 * 
 * 完全重建核心业务表，使用统一 Recipe 模型。
 * - recipes: 统一知识实体（吸收原 solutions + guard_rules）
 * - candidates: 代码候选
 * - snippets: 代码片段
 * - solutions 和 guard_rules 表已删除（不再需要）
 * 
 * 保留的辅助表：
 *   recipe_relationships, recipe_code_references, audit_logs, sessions,
 *   knowledge_edges, reasoning_logs, role_drift_events, schema_migrations
 */
export default function migrate(db) {
  // ============================================================
  // 1. DROP 旧表（包括已废弃的 solutions 和 guard_rules）
  // ============================================================
  db.exec(`
    DROP TABLE IF EXISTS candidates;
    DROP TABLE IF EXISTS recipes;
    DROP TABLE IF EXISTS solutions;
    DROP TABLE IF EXISTS snippets;
    DROP TABLE IF EXISTS guard_rules;
    DROP TABLE IF EXISTS guard_violations;
  `);

  // ============================================================
  // 2. candidates — 代码片段候选
  //    Domain: Candidate.js
  // ============================================================
  db.exec(`
    CREATE TABLE candidates (
      id                TEXT PRIMARY KEY,
      code              TEXT NOT NULL,
      language          TEXT NOT NULL,
      category          TEXT,
      source            TEXT NOT NULL,

      -- Reasoning (JSON-serialized Reasoning value object)
      reasoning_json    TEXT,

      -- Status
      status            TEXT NOT NULL DEFAULT 'pending',
      status_history_json TEXT DEFAULT '[]',

      -- Approval / Rejection
      approved_by       TEXT,
      approved_at       INTEGER,
      rejected_by       TEXT,
      rejection_reason  TEXT,

      -- Recipe application
      applied_recipe_id TEXT,

      -- Metadata
      metadata_json     TEXT DEFAULT '{}',
      created_by        TEXT,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    );

    CREATE INDEX idx_candidates_status     ON candidates(status);
    CREATE INDEX idx_candidates_language    ON candidates(language);
    CREATE INDEX idx_candidates_created_at  ON candidates(created_at);
    CREATE INDEX idx_candidates_created_by  ON candidates(created_by);
  `);

  // ============================================================
  // 3. recipes — 统一知识实体
  //    Domain: Recipe.js (12 KnowledgeTypes)
  //    吸收原 solutions + guard_rules
  // ============================================================
  db.exec(`
    CREATE TABLE recipes (
      id                TEXT PRIMARY KEY,
      title             TEXT NOT NULL,
      description       TEXT,
      language          TEXT NOT NULL,
      category          TEXT NOT NULL,

      -- Classification
      knowledge_type    TEXT DEFAULT 'code-pattern',
      complexity        TEXT DEFAULT 'intermediate',
      scope             TEXT,

      -- Structured content (JSON)
      content_json      TEXT DEFAULT '{}',
      relations_json    TEXT DEFAULT '{}',
      constraints_json  TEXT DEFAULT '{}',

      -- Status
      status            TEXT NOT NULL DEFAULT 'draft',

      -- Quality (0-1)
      quality_code_completeness       REAL DEFAULT 0,
      quality_project_adaptation      REAL DEFAULT 0,
      quality_documentation_clarity   REAL DEFAULT 0,
      quality_overall                 REAL DEFAULT 0,

      -- Multi-dimension classification
      dimensions_json   TEXT DEFAULT '{}',
      tags_json         TEXT DEFAULT '[]',

      -- Statistics
      adoption_count    INTEGER DEFAULT 0,
      application_count INTEGER DEFAULT 0,
      guard_hit_count   INTEGER DEFAULT 0,
      view_count        INTEGER DEFAULT 0,
      success_count     INTEGER DEFAULT 0,
      feedback_score    REAL DEFAULT 0,

      -- Publishing
      published_by      TEXT,
      published_at      INTEGER,

      -- Deprecation
      deprecation_reason TEXT,
      deprecated_at     INTEGER,

      -- Source tracking
      source_candidate_id TEXT,
      source_file         TEXT,

      -- Metadata
      created_by        TEXT,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,

      CHECK (quality_code_completeness IS NULL OR (quality_code_completeness >= 0 AND quality_code_completeness <= 1)),
      CHECK (quality_project_adaptation IS NULL OR (quality_project_adaptation >= 0 AND quality_project_adaptation <= 1)),
      CHECK (quality_documentation_clarity IS NULL OR (quality_documentation_clarity >= 0 AND quality_documentation_clarity <= 1)),
      CHECK (quality_overall IS NULL OR (quality_overall >= 0 AND quality_overall <= 1))
    );

    CREATE INDEX idx_recipes_status         ON recipes(status);
    CREATE INDEX idx_recipes_language        ON recipes(language);
    CREATE INDEX idx_recipes_category        ON recipes(category);
    CREATE INDEX idx_recipes_knowledge_type  ON recipes(knowledge_type);
    CREATE INDEX idx_recipes_scope           ON recipes(scope);
    CREATE INDEX idx_recipes_source_file     ON recipes(source_file);
  `);

  // ============================================================
  // 4. snippets — 代码片段
  //    Domain: Snippet.js
  // ============================================================
  db.exec(`
    CREATE TABLE snippets (
      id                  TEXT PRIMARY KEY,
      identifier          TEXT NOT NULL UNIQUE,
      title               TEXT NOT NULL,
      language            TEXT NOT NULL DEFAULT 'swift',
      category            TEXT,
      completion          TEXT,
      summary             TEXT,
      code                TEXT NOT NULL,

      -- Xcode integration
      installed           INTEGER DEFAULT 0,
      installed_path      TEXT,

      -- Source tracking
      source_recipe_id    TEXT,
      source_candidate_id TEXT,

      -- Metadata
      metadata_json       TEXT,
      created_by          TEXT,
      created_at          INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL
    );

    CREATE INDEX idx_snippets_identifier  ON snippets(identifier);
    CREATE INDEX idx_snippets_language    ON snippets(language);
    CREATE INDEX idx_snippets_category   ON snippets(category);
    CREATE INDEX idx_snippets_installed  ON snippets(installed);
    CREATE INDEX idx_snippets_created_at ON snippets(created_at);
  `);

  process.stderr.write('  ✅ 005_unified_schema_reset: 3 core tables rebuilt (candidates, recipes, snippets)\n');
}
