/**
 * CandidateSyncService — 将 AutoSnippet/candidates/*.md 增量同步到 SQLite DB
 *
 * 设计原则（与 RecipeSyncService 对齐）：
 *  - .md 文件 = 完整唯一数据源（Source of Truth），DB = 索引缓存
 *  - 通过 _contentHash 检测手写/手改 .md → 进入违规统计
 *  - 孤儿 Candidate（DB 有但 .md 不存在）→ 自动标记（仅报告，不删除）
 *
 * 使用方式：
 *  - CLI: `asd sync` 同时同步 Recipes + Candidates
 *  - 内部: SetupService 委托调用
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CANDIDATES_DIR } from '../infrastructure/config/Defaults.js';
import { computeCandidateHash, parseCandidateMarkdown } from '../service/candidate/CandidateFileWriter.js';
import Logger from '../infrastructure/logging/Logger.js';

export class CandidateSyncService {
  /**
   * @param {string} projectRoot
   */
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.candidatesDir = path.join(projectRoot, CANDIDATES_DIR);
    this.logger = Logger.getInstance();
  }

  /**
   * 执行增量同步：.md → DB
   * @param {import('better-sqlite3').Database} db  better-sqlite3 原始句柄
   * @param {object}  [opts={}]
   * @param {boolean} [opts.dryRun=false]
   * @param {boolean} [opts.force=false]
   * @param {boolean} [opts.skipViolations=false]
   * @returns {{ synced: number, created: number, updated: number, violations: string[], orphaned: string[], skipped: number }}
   */
  sync(db, opts = {}) {
    const { dryRun = false, force = false, skipViolations = false } = opts;

    const report = {
      synced: 0,
      created: 0,
      updated: 0,
      violations: [],
      orphaned: [],
      skipped: 0,
    };

    // ── 1. 收集 .md 文件 ──
    const mdFiles = this._collectMdFiles();
    if (mdFiles.length === 0) {
      this.logger.info('CandidateSyncService: no .md files found in candidates/');
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
        const parsed  = parseCandidateMarkdown(content, relPath);

        if (!parsed.id) {
          this.logger.warn(`CandidateSyncService: skip file without id — ${relPath}`);
          report.skipped++;
          continue;
        }

        syncedIds.add(parsed.id);

        // ── 检测手动编辑 ──
        const actualHash = computeCandidateHash(content);
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
          const existed = this._candidateExists(db, parsed.id);
          const row = this._buildDbRow(parsed, content);
          upsertStmt.run(...Object.values(row));

          if (existed) {
            report.updated++;
          } else {
            report.created++;
          }
        }

        report.synced++;
      } catch (err) {
        this.logger.error(`CandidateSyncService: failed to sync ${relPath}`, { error: err.message });
        report.skipped++;
      }
    }

    // ── 4. 检测孤儿 ──
    report.orphaned = this._detectOrphans(db, syncedIds, dryRun);

    this.logger.info('CandidateSyncService: sync complete', {
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

  _collectMdFiles() {
    if (!fs.existsSync(this.candidatesDir)) return [];

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
    walk(this.candidatesDir, '');
    return results;
  }

  /* ═══ DB 操作 ═══════════════════════════════════════════ */

  _buildDbRow(parsed, rawContent) {
    // 从 body 提取代码块
    const code = parsed._bodyCode || '';

    // 重建 JSON 字段
    const reasoning = parsed._reasoning || null;
    const metadata  = parsed._metadata || {};
    const history   = parsed._statusHistory || '[]';

    return {
      id:                   parsed.id,
      code:                 code,
      language:             parsed.language || 'swift',
      category:             parsed.category || 'general',
      source:               parsed.source || 'manual',
      reasoning_json:       typeof reasoning === 'object' ? JSON.stringify(reasoning) : (reasoning || null),
      status:               parsed.status || 'pending',
      status_history_json:  typeof history === 'object' ? JSON.stringify(history) : (history || '[]'),
      approved_by:          parsed.approvedBy || null,
      approved_at:          parsed.approvedAt || null,
      rejected_by:          parsed.rejectedBy || null,
      rejection_reason:     parsed.rejectionReason || null,
      applied_recipe_id:    parsed.appliedRecipeId || null,
      metadata_json:        typeof metadata === 'object' ? JSON.stringify(metadata) : (metadata || '{}'),
      created_by:           parsed.createdBy || 'file-sync',
      created_at:           parsed.createdAt || Math.floor(Date.now() / 1000),
      updated_at:           parsed.updatedAt || Math.floor(Date.now() / 1000),
    };
  }

  _prepareUpsert(db) {
    const cols = [
      'id', 'code', 'language', 'category', 'source',
      'reasoning_json', 'status', 'status_history_json',
      'approved_by', 'approved_at', 'rejected_by', 'rejection_reason',
      'applied_recipe_id', 'metadata_json',
      'created_by', 'created_at', 'updated_at',
    ];

    const updateCols = cols.filter(c => !['id', 'created_by', 'created_at'].includes(c));
    const setClauses = updateCols.map(c => `${c} = excluded.${c}`).join(',\n      ');

    const sql = `
      INSERT INTO candidates (${cols.join(', ')})
      VALUES (${cols.map(() => '?').join(', ')})
      ON CONFLICT(id) DO UPDATE SET
      ${setClauses}
    `;

    return db.prepare(sql);
  }

  _candidateExists(db, id) {
    const row = db.prepare('SELECT 1 FROM candidates WHERE id = ?').get(id);
    return !!row;
  }

  /* ═══ 违规记录 ═══════════════════════════════════════════ */

  _prepareAuditInsert(db) {
    try {
      return db.prepare(`
        INSERT INTO audit_logs (id, timestamp, actor, actor_context, action, resource, operation_data, result, error_message, duration)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
    } catch {
      return null;
    }
  }

  _logViolation(stmt, candidateId, filePath, expectedHash, actualHash) {
    try {
      stmt.run(
        randomUUID(),
        Math.floor(Date.now() / 1000),
        'sync',
        JSON.stringify({ source: 'cli' }),
        'manual_candidate_edit',
        candidateId,
        JSON.stringify({ file: filePath, expectedHash, actualHash }),
        'violation_detected',
        null,
        0,
      );
    } catch (err) {
      this.logger.warn('CandidateSyncService: failed to log violation', { candidateId, error: err.message });
    }
  }

  /* ═══ 孤儿检测 ═══════════════════════════════════════════ */

  /**
   * 检测 DB 中存在但 .md 已删除的 Candidate（仅报告，不自动删除）
   */
  _detectOrphans(db, syncedIds, _dryRun) {
    const orphanIds = [];
    try {
      const rows = db.prepare(
        `SELECT id FROM candidates WHERE status NOT IN ('applied', 'rejected')`
      ).all();

      for (const row of rows) {
        if (!syncedIds.has(row.id)) {
          orphanIds.push(row.id);
        }
      }
    } catch (err) {
      this.logger.warn('CandidateSyncService: orphan detection failed', { error: err.message });
    }
    return orphanIds;
  }
}
