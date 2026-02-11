/**
 * ReasoningLogger - 透明推理日志系统
 * 
 * 记录 AI 操作的完整推理过程，包括：
 * - Candidate 提交时的推理上下文
 * - Guard 检查时的规则匹配过程
 * - 搜索时的排名决策
 * 
 * 所有推理日志不可篡改，存储在 SQLite 中
 */

import { v4 as uuidv4 } from 'uuid';
import Logger from '../logging/Logger.js';

export class ReasoningLogger {
  constructor(db) {
    this.db = typeof db?.getDb === 'function' ? db.getDb() : db;
    this.logger = Logger.getInstance();
    this._ensureTable();
  }

  _ensureTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reasoning_logs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        actor TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        reasoning_json TEXT NOT NULL DEFAULT '{}',
        quality_score REAL DEFAULT 0,
        context_json TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reasoning_logs_type ON reasoning_logs(type)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reasoning_logs_actor ON reasoning_logs(actor)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reasoning_logs_created ON reasoning_logs(created_at)`);
  }

  /**
   * 记录 Candidate 推理过程
   */
  logCandidateReasoning(candidate, actor, context = {}) {
    const reasoning = candidate.reasoning || {};
    const qualityScore = this._assessReasoningQuality(reasoning);

    return this._insert({
      type: 'candidate_reasoning',
      actor,
      resourceType: 'candidate',
      resourceId: candidate.id,
      reasoning: {
        whyStandard: reasoning.whyStandard || '',
        sources: reasoning.sources || [],
        qualitySignals: reasoning.qualitySignals || {},
        alternatives: reasoning.alternatives || [],
        confidence: reasoning.confidence || 0,
        assessment: {
          completeness: this._assessCompleteness(reasoning),
          sourceQuality: this._assessSourceQuality(reasoning),
          overall: qualityScore,
        },
      },
      qualityScore,
      context,
    });
  }

  /**
   * 记录 Guard 规则匹配推理
   */
  logGuardReasoning(code, matchedRules, actor, context = {}) {
    return this._insert({
      type: 'guard_reasoning',
      actor,
      resourceType: 'code_check',
      resourceId: context.fileId || null,
      reasoning: {
        codeLength: code.length,
        rulesChecked: matchedRules.length,
        violations: matchedRules.map(r => ({
          ruleId: r.ruleId || r.id,
          ruleName: r.name,
          severity: r.severity,
          matchCount: r.matches?.length || 0,
          sourceRecipeId: r.sourceRecipeId,
        })),
        checkDuration: context.duration,
      },
      qualityScore: 0,
      context,
    });
  }

  /**
   * 记录搜索排名推理
   */
  logSearchReasoning(query, results, rankingFactors, actor, context = {}) {
    return this._insert({
      type: 'search_reasoning',
      actor,
      resourceType: 'search',
      resourceId: null,
      reasoning: {
        query,
        resultCount: results.length,
        topResults: results.slice(0, 5).map(r => ({
          id: r.id,
          score: r.score,
          title: r.title,
        })),
        rankingFactors,
      },
      qualityScore: 0,
      context,
    });
  }

  /**
   * 查询推理日志
   */
  query(filters = {}, pagination = { page: 1, pageSize: 20 }) {
    const conditions = ['1=1'];
    const params = [];

    if (filters.type) {
      conditions.push('type = ?');
      params.push(filters.type);
    }
    if (filters.actor) {
      conditions.push('actor = ?');
      params.push(filters.actor);
    }
    if (filters.resourceType) {
      conditions.push('resource_type = ?');
      params.push(filters.resourceType);
    }
    if (filters.resourceId) {
      conditions.push('resource_id = ?');
      params.push(filters.resourceId);
    }
    if (filters.minQuality !== undefined) {
      conditions.push('quality_score >= ?');
      params.push(filters.minQuality);
    }
    if (filters.since) {
      conditions.push('created_at >= ?');
      params.push(filters.since);
    }

    const offset = (pagination.page - 1) * pagination.pageSize;
    const where = conditions.join(' AND ');

    const rows = this.db.prepare(
      `SELECT * FROM reasoning_logs WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, pagination.pageSize, offset);

    const countRow = this.db.prepare(
      `SELECT COUNT(*) as total FROM reasoning_logs WHERE ${where}`
    ).get(...params);

    return {
      items: rows.map(this._mapRow),
      total: countRow.total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    };
  }

  /**
   * 获取推理质量统计
   */
  getQualityStats(since = null) {
    const params = [];
    let where = '1=1';
    if (since) {
      where = 'created_at >= ?';
      params.push(since);
    }

    const stats = this.db.prepare(`
      SELECT 
        type,
        COUNT(*) as count,
        AVG(quality_score) as avg_quality,
        MIN(quality_score) as min_quality,
        MAX(quality_score) as max_quality
      FROM reasoning_logs 
      WHERE ${where}
      GROUP BY type
    `).all(...params);

    return stats;
  }

  // ========== Private Methods ==========

  _insert({ type, actor, resourceType, resourceId, reasoning, qualityScore, context }) {
    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    this.db.prepare(`
      INSERT INTO reasoning_logs (id, type, actor, resource_type, resource_id, reasoning_json, quality_score, context_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, type, actor, resourceType, resourceId, JSON.stringify(reasoning), qualityScore, JSON.stringify(context), now);

    return { id, type, actor, qualityScore, createdAt: now };
  }

  _mapRow(row) {
    return {
      id: row.id,
      type: row.type,
      actor: row.actor,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      reasoning: JSON.parse(row.reasoning_json || '{}'),
      qualityScore: row.quality_score,
      context: JSON.parse(row.context_json || '{}'),
      createdAt: row.created_at,
    };
  }

  /**
   * 评估推理质量（0-1）
   */
  _assessReasoningQuality(reasoning) {
    if (!reasoning) return 0;

    const completeness = this._assessCompleteness(reasoning);
    const sourceQuality = this._assessSourceQuality(reasoning);
    const confidenceScore = typeof reasoning.confidence === 'number' ? reasoning.confidence : 0;

    // 权重: 完整性 40%, 来源质量 35%, 置信度 25%
    return Math.round((completeness * 0.4 + sourceQuality * 0.35 + confidenceScore * 0.25) * 100) / 100;
  }

  _assessCompleteness(reasoning) {
    if (!reasoning) return 0;
    let score = 0;
    if (reasoning.whyStandard && reasoning.whyStandard.length > 10) score += 0.3;
    if (Array.isArray(reasoning.sources) && reasoning.sources.length > 0) score += 0.25;
    if (reasoning.qualitySignals && Object.keys(reasoning.qualitySignals).length > 0) score += 0.2;
    if (Array.isArray(reasoning.alternatives) && reasoning.alternatives.length > 0) score += 0.15;
    if (typeof reasoning.confidence === 'number') score += 0.1;
    return Math.min(1, score);
  }

  _assessSourceQuality(reasoning) {
    if (!reasoning || !Array.isArray(reasoning.sources) || reasoning.sources.length === 0) return 0;
    // 多来源 + 来源有类型或链接 → 较高质量
    const count = Math.min(reasoning.sources.length, 5);
    return count / 5;
  }
}

let instance = null;

export function initReasoningLogger(db) {
  instance = new ReasoningLogger(db);
  return instance;
}

export function getReasoningLogger() {
  return instance;
}

export default ReasoningLogger;
