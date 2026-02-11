/**
 * SyncService — 将 AutoSnippet/recipes/*.md 增量同步到 SQLite DB
 *
 * 设计原则：
 *  - .md 文件 = 完整唯一数据源（Source of Truth），DB = 索引缓存
 *  - 所有 frontmatter 字段（基础 + _ 前缀机器字段）完整写入 DB
 *  - 通过 _contentHash 检测手写/手改 .md → 进入违规统计（audit_logs）
 *  - 孤儿 Recipe（DB 有但 .md 不存在）→ 自动标记 deprecated
 *
 * 使用方式：
 *  - CLI: `asd sync [--force] [--dry-run] [-d <dir>]`
 *  - 内部: SetupService.stepDatabase() 委托调用（skipViolations=true）
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RECIPES_DIR } from '../infrastructure/config/Defaults.js';
import { computeContentHash, parseRecipeMarkdown } from '../service/recipe/RecipeFileWriter.js';
import { inferKind } from '../domain/recipe/Recipe.js';
import Logger from '../infrastructure/logging/Logger.js';

export class SyncService {
  /**
   * @param {string} projectRoot
   */
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.recipesDir = path.join(projectRoot, RECIPES_DIR);
    this.logger = Logger.getInstance();
  }

  /**
   * 执行增量同步：.md → DB
   * @param {import('better-sqlite3').Database} db  better-sqlite3 原始句柄
   * @param {object}  [opts={}]
   * @param {boolean} [opts.dryRun=false]       只报告不写入
   * @param {boolean} [opts.force=false]        忽略 hash，强制覆盖
   * @param {boolean} [opts.skipViolations=false] 跳过违规记录（setup 场景）
   * @returns {{ synced: number, created: number, updated: number, violations: string[], orphaned: string[], skipped: number }}
   */
  sync(db, opts = {}) {
    const { dryRun = false, force = false, skipViolations = false } = opts;

    const report = {
      synced: 0,
      created: 0,
      updated: 0,
      violations: [],   // 手动编辑的文件列表
      orphaned: [],     // DB 有但 .md 不存在
      skipped: 0,
    };

    // ── 1. 收集 .md 文件 ──
    const mdFiles = this._collectMdFiles();
    if (mdFiles.length === 0) {
      this.logger.info('SyncService: no .md files found in recipes/');
      return report;
    }

    // ── 2. 准备 upsert 语句 ──
    const upsertStmt = dryRun ? null : this._prepareUpsert(db);
    const auditStmt  = (dryRun || skipViolations) ? null : this._prepareAuditInsert(db);

    // ── 3. 逐文件同步 ──
    const syncedIds = new Set();

    for (const { absPath, relPath } of mdFiles) {
      try {
        const content = fs.readFileSync(absPath, 'utf8');
        const parsed  = parseRecipeMarkdown(content, relPath);

        if (!parsed.id) {
          this.logger.warn(`SyncService: skip file without id — ${relPath}`);
          report.skipped++;
          continue;
        }

        syncedIds.add(parsed.id);

        // ── 检测手动编辑 ──
        const actualHash = computeContentHash(content);
        const storedHash = parsed._contentHash;
        const isManualEdit = storedHash && storedHash !== actualHash && !force;

        if (isManualEdit) {
          report.violations.push(relPath);
          if (auditStmt) {
            this._logViolation(auditStmt, parsed.id, relPath, storedHash, actualHash);
          }
        }

        // ── upsert ──
        if (!dryRun) {
          const existed = this._recipeExists(db, parsed.id);
          const row = this._buildDbRow(parsed, relPath, content);
          upsertStmt.run(...Object.values(row));

          if (existed) {
            report.updated++;
          } else {
            report.created++;
          }
        }

        report.synced++;
      } catch (err) {
        this.logger.error(`SyncService: failed to sync ${relPath}`, { error: err.message });
        report.skipped++;
      }
    }

    // ── 4. 检测孤儿（DB 有但 .md 不存在）──
    report.orphaned = this._detectOrphans(db, syncedIds, dryRun);

    this.logger.info('SyncService: sync complete', {
      synced: report.synced,
      created: report.created,
      updated: report.updated,
      violations: report.violations.length,
      orphaned: report.orphaned.length,
      skipped: report.skipped,
    });

    return report;
  }

  /* ═══ 文件收集 ═══════════════════════════════════════════ */

  /**
   * 递归收集 recipes/ 下所有 .md 文件（跳过 _ 前缀模板）
   * @returns {{ absPath: string, relPath: string }[]}
   */
  _collectMdFiles() {
    if (!fs.existsSync(this.recipesDir)) return [];

    const results = [];
    const walk = (dir, base) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel  = base ? `${base}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          walk(full, rel);
        } else if (entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
          results.push({ absPath: full, relPath: rel });
        }
      }
    };
    walk(this.recipesDir, '');
    return results;
  }

  /* ═══ DB 操作 ═══════════════════════════════════════════ */

  /**
   * 构建 DB upsert 所需的行数据
   * @param {object} parsed  parseRecipeMarkdown 返回值
   * @param {string} relPath 相对于项目根目录的 source_file
   * @param {string} rawContent 原始 .md 全文
   * @returns {object}  列名→值映射
   */
  _buildDbRow(parsed, relPath, rawContent) {
    // 从 body 提取代码块和结构化段落
    const codeMatch = rawContent.match(/```\w*\s*\r?\n([\s\S]*?)```/);
    const pattern = codeMatch ? codeMatch[1].trim() : '';

    // 提取结构化段落（从 Markdown body 中按 ## 标题解析）
    const rationale = this._extractSection(rawContent, '设计原理|Rationale|Why') || '';
    const verification = this._extractSection(rawContent, '验证|Verification|Test') || '';

    const contentJson = JSON.stringify({
      pattern,
      rationale,
      verification: verification ? { method: 'section', expectedResult: verification } : null,
      markdown: rawContent,
    });

    // usage_guide: 从 body 提取“使用指南/Usage”段落，同时兑容 frontmatter
    const usageGuideCn = parsed.usageGuideCn || this._extractSection(rawContent, '使用指南|使用方法|如何使用') || null;
    const usageGuideEn = parsed.usageGuideEn || this._extractSection(rawContent, 'Usage Guide|How to Use') || null;

    const sourceFilePath = path.join(RECIPES_DIR, relPath).replace(/\\/g, '/');
    const knowledgeType = parsed.knowledgeType || 'code-pattern';

    return {
      id:                           parsed.id,
      title:                        parsed.title || '',
      description:                  parsed.summaryCn || parsed.summaryEn || '',
      language:                     parsed.language || 'swift',
      category:                     parsed.category || 'general',
      summary_cn:                   parsed.summaryCn || null,
      summary_en:                   parsed.summaryEn || null,
      usage_guide_cn:               usageGuideCn,
      usage_guide_en:               usageGuideEn,
      knowledge_type:               knowledgeType,
      kind:                         parsed.kind || inferKind(knowledgeType),
      complexity:                   parsed.complexity || 'intermediate',
      scope:                        parsed.scope || null,
      trigger:                      parsed.trigger || '',
      source_file:                  sourceFilePath,
      content_json:                 contentJson,
      relations_json:               JSON.stringify(parsed.relations || {}),
      constraints_json:             JSON.stringify(parsed.constraints || {}),
      quality_code_completeness:    parsed.quality?.codeCompleteness ?? 0,
      quality_project_adaptation:   parsed.quality?.projectAdaptation ?? 0,
      quality_documentation_clarity: parsed.quality?.documentationClarity ?? 0,
      quality_overall:              parsed.quality?.overall ?? 0,
      dimensions_json:              JSON.stringify({
        headers:    parsed.headers || [],
        authority:  parsed.authority,
        difficulty: parsed.difficulty,
        version:    parsed.version,
      }),
      tags_json:                    JSON.stringify(parsed.tags || []),
      adoption_count:               parsed.statistics?.adoptionCount ?? 0,
      application_count:            parsed.statistics?.applicationCount ?? 0,
      guard_hit_count:              parsed.statistics?.guardHitCount ?? 0,
      view_count:                   parsed.statistics?.viewCount ?? 0,
      success_count:                parsed.statistics?.successCount ?? 0,
      feedback_score:               parsed.statistics?.feedbackScore ?? 0,
      status:                       parsed.status || 'active',
      created_by:                   parsed.createdBy || 'file-sync',
      created_at:                   parsed.createdAt || Math.floor(Date.now() / 1000),
      updated_at:                   parsed.updatedAt || Math.floor(Date.now() / 1000),
      published_by:                 parsed.publishedBy || null,
      published_at:                 parsed.publishedAt || null,
      deprecation_reason:           parsed.deprecationReason || null,
      deprecated_at:                parsed.deprecatedAt || null,
      source_candidate_id:          parsed.sourceCandidate || null,
    };
  }

  /**
   * 从 Markdown body 中按 ## 标题匹配提取段落内容
   * @param {string} content 原始 Markdown 全文
   * @param {string} headingPattern 标题的正则 alternation（如 '设计原理|Rationale'）
   * @returns {string|null}
   */
  _extractSection(content, headingPattern) {
    const regex = new RegExp(`^##\\s+(${headingPattern})\\s*$`, 'im');
    const match = content.match(regex);
    if (!match) return null;

    const startIdx = match.index + match[0].length;
    // 查找下一个 ## 标题或文件末尾
    const rest = content.slice(startIdx);
    const nextHeading = rest.search(/^##\s+/m);
    const sectionContent = (nextHeading >= 0 ? rest.slice(0, nextHeading) : rest).trim();
    return sectionContent || null;
  }

  /**
   * 准备 upsert 语句（INSERT ... ON CONFLICT DO UPDATE 全字段）
   */
  _prepareUpsert(db) {
    const cols = [
      'id', 'title', 'description', 'language', 'category',
      'summary_cn', 'summary_en', 'usage_guide_cn', 'usage_guide_en',
      'knowledge_type', 'kind', 'complexity', 'scope', 'trigger',
      'source_file', 'content_json', 'relations_json', 'constraints_json',
      'quality_code_completeness', 'quality_project_adaptation',
      'quality_documentation_clarity', 'quality_overall',
      'dimensions_json', 'tags_json',
      'adoption_count', 'application_count', 'guard_hit_count',
      'view_count', 'success_count', 'feedback_score',
      'status', 'created_by', 'created_at', 'updated_at',
      'published_by', 'published_at',
      'deprecation_reason', 'deprecated_at',
      'source_candidate_id',
    ];

    // ON CONFLICT 更新除 id, created_by, created_at 以外的所有列
    const updateCols = cols.filter(c => !['id', 'created_by', 'created_at'].includes(c));
    const setClauses = updateCols.map(c => `${c} = excluded.${c}`).join(',\n      ');

    const sql = `
      INSERT INTO recipes (${cols.join(', ')})
      VALUES (${cols.map(() => '?').join(', ')})
      ON CONFLICT(id) DO UPDATE SET
      ${setClauses}
    `;

    return db.prepare(sql);
  }

  /**
   * 检查 recipe 是否已存在于 DB
   */
  _recipeExists(db, id) {
    const row = db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(id);
    return !!row;
  }

  /* ═══ 违规记录 ═══════════════════════════════════════════ */

  _prepareAuditInsert(db) {
    // 确保 audit_logs 表存在（可能在无迁移的情况下不存在）
    try {
      return db.prepare(`
        INSERT INTO audit_logs (id, timestamp, actor, actor_context, action, resource, operation_data, result, error_message, duration)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
    } catch {
      return null;
    }
  }

  _logViolation(stmt, recipeId, filePath, expectedHash, actualHash) {
    try {
      stmt.run(
        randomUUID(),
        Math.floor(Date.now() / 1000),
        'sync',
        JSON.stringify({ source: 'cli' }),
        'manual_recipe_edit',
        recipeId,
        JSON.stringify({ file: filePath, expectedHash, actualHash }),
        'violation_detected',
        null,
        0,
      );
    } catch (err) {
      this.logger.warn('SyncService: failed to log violation', { recipeId, error: err.message });
    }
  }

  /* ═══ 孤儿检测 ═══════════════════════════════════════════ */

  /**
   * 检测 DB 中存在但 .md 已删除的 Recipe → 标记 deprecated
   * @returns {string[]} 孤儿 recipe id 列表
   */
  _detectOrphans(db, syncedIds, dryRun) {
    const orphanIds = [];
    try {
      const rows = db.prepare(
        `SELECT id, source_file FROM recipes WHERE status != 'deprecated' AND source_file IS NOT NULL`
      ).all();

      for (const row of rows) {
        if (!syncedIds.has(row.id)) {
          orphanIds.push(row.id);
          if (!dryRun) {
            db.prepare(
              `UPDATE recipes SET status = 'deprecated', deprecation_reason = ?, deprecated_at = ?, updated_at = ? WHERE id = ?`
            ).run('source file deleted (orphan)', Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), row.id);
          }
        }
      }
    } catch (err) {
      this.logger.warn('SyncService: orphan detection failed', { error: err.message });
    }
    return orphanIds;
  }
}
