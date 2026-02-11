/**
 * ComplianceEvaluator - 宪法合规评估工具
 * 
 * 自动评估系统在四大优先级上的合规程度，生成结构化报告。
 * 可通过 CLI 命令 `asd compliance` 或 API 调用。
 * 
 * 四大优先级:
 * 1. Data Integrity - 数据完整性
 * 2. Human Oversight - 人工监督
 * 3. AI Transparency - AI 透明性
 * 4. Helpfulness - 帮助性
 */

import Logger from '../logging/Logger.js';

export class ComplianceEvaluator {
  constructor(db) {
    this.db = typeof db?.getDb === 'function' ? db.getDb() : db;
    this.logger = Logger.getInstance();
  }

  /**
   * 执行完整合规评估
   * @param {object} options - { period: 'all'|'weekly'|'monthly', priority: null|string }
   * @returns {object} 合规报告
   */
  evaluate(options = {}) {
    const since = this._getSinceTimestamp(options.period);
    const report = {
      evaluatedAt: new Date().toISOString(),
      period: options.period || 'all',
      priorities: {},
      overallScore: 0,
      recommendations: [],
    };

    // 评估每个优先级
    report.priorities.dataIntegrity = this._evaluateDataIntegrity(since);
    report.priorities.humanOversight = this._evaluateHumanOversight(since);
    report.priorities.aiTransparency = this._evaluateAITransparency(since);
    report.priorities.helpfulness = this._evaluateHelpfulness(since);

    // 加权总分 (P1=35%, P2=30%, P3=20%, P4=15%)
    report.overallScore = Math.round((
      report.priorities.dataIntegrity.score * 0.35 +
      report.priorities.humanOversight.score * 0.30 +
      report.priorities.aiTransparency.score * 0.20 +
      report.priorities.helpfulness.score * 0.15
    ) * 100) / 100;

    // 生成改进建议
    report.recommendations = this._generateRecommendations(report.priorities);

    return report;
  }

  // ========== Priority 1: Data Integrity ==========

  _evaluateDataIntegrity(since) {
    const result = { score: 0, metrics: {}, issues: [] };
    const whereTime = since ? 'AND created_at >= ?' : '';
    const whereParams = since ? [since] : [];

    // 1. Candidate → Recipe 转化率 (目标 > 60%)
    const candidateStats = this._safeQuery(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) as applied,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved
      FROM candidates WHERE 1=1 ${whereTime}
    `, whereParams);
    const conversionRate = candidateStats.total > 0 
      ? (candidateStats.applied + candidateStats.approved) / candidateStats.total 
      : 0;
    result.metrics.candidateConversionRate = Math.round(conversionRate * 100) / 100;

    if (conversionRate < 0.6) {
      result.issues.push({ severity: 'warning', message: `Candidate conversion rate ${(conversionRate * 100).toFixed(0)}% is below 60% target` });
    }

    // 2. Recipe 版本追踪 (audit_logs 覆盖率)
    const recipeCount = this._safeQuery(`SELECT COUNT(*) as total FROM recipes WHERE 1=1 ${whereTime}`, whereParams);
    const auditedRecipes = this._safeQuery(`
      SELECT COUNT(DISTINCT resource_id) as total FROM audit_logs 
      WHERE resource_type = 'recipe' ${whereTime}
    `, whereParams);
    const auditCoverage = recipeCount.total > 0 ? auditedRecipes.total / recipeCount.total : 1;
    result.metrics.recipeAuditCoverage = Math.round(auditCoverage * 100) / 100;

    if (auditCoverage < 1) {
      result.issues.push({ severity: 'info', message: `${((1 - auditCoverage) * 100).toFixed(0)}% of recipes lack audit trail` });
    }

    // 3. Candidate 有推理过程的比率
    const withReasoning = this._safeQuery(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN reasoning_json IS NOT NULL AND reasoning_json != '{}' AND reasoning_json != 'null' THEN 1 ELSE 0 END) as with_reasoning
      FROM candidates WHERE 1=1 ${whereTime}
    `, whereParams);
    const reasoningRate = withReasoning.total > 0 ? withReasoning.with_reasoning / withReasoning.total : 0;
    result.metrics.reasoningRate = Math.round(reasoningRate * 100) / 100;

    // 综合评分
    result.score = Math.round((conversionRate * 0.4 + auditCoverage * 0.3 + reasoningRate * 0.3) * 100) / 100;
    return result;
  }

  // ========== Priority 2: Human Oversight ==========

  _evaluateHumanOversight(since) {
    const result = { score: 0, metrics: {}, issues: [] };
    const whereTime = since ? 'AND created_at >= ?' : '';
    const whereParams = since ? [since] : [];

    // 1. 零自动修改事件 (AI 不应直接修改 Recipe)
    const autoModifications = this._safeQuery(`
      SELECT COUNT(*) as total FROM audit_logs 
      WHERE action IN ('create_recipe', 'publish_recipe', 'update_recipe') 
      AND actor IN ('cursor_agent', 'asd_ais', 'guard_engine') ${whereTime}
    `, whereParams);
    result.metrics.autoModifications = autoModifications.total;
    const noAutoModScore = autoModifications.total === 0 ? 1 : Math.max(0, 1 - autoModifications.total * 0.1);

    if (autoModifications.total > 0) {
      result.issues.push({ severity: 'error', message: `${autoModifications.total} auto-modifications by AI actors detected` });
    }

    // 2. 审核覆盖率 (所有 Candidate 都有人工操作)
    const reviewed = this._safeQuery(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('approved', 'rejected', 'applied') THEN 1 ELSE 0 END) as reviewed
      FROM candidates WHERE 1=1 ${whereTime}
    `, whereParams);
    const reviewRate = reviewed.total > 0 ? reviewed.reviewed / reviewed.total : 1;
    result.metrics.reviewRate = Math.round(reviewRate * 100) / 100;

    // 3. 审计日志完整性
    const totalActions = this._safeQuery(`SELECT COUNT(*) as total FROM audit_logs WHERE 1=1 ${whereTime}`, whereParams);
    const failedAudits = this._safeQuery(`
      SELECT COUNT(*) as total FROM audit_logs WHERE result = 'failure' ${whereTime}
    `, whereParams);
    const auditSuccess = totalActions.total > 0 ? 1 - (failedAudits.total / totalActions.total) : 1;
    result.metrics.auditSuccessRate = Math.round(auditSuccess * 100) / 100;

    result.score = Math.round((noAutoModScore * 0.5 + reviewRate * 0.3 + auditSuccess * 0.2) * 100) / 100;
    return result;
  }

  // ========== Priority 3: AI Transparency ==========

  _evaluateAITransparency(since) {
    const result = { score: 0, metrics: {}, issues: [] };
    const whereTime = since ? 'AND created_at >= ?' : '';
    const whereParams = since ? [since] : [];

    // 1. AI 创建的 Candidate 推理完整性
    const aiCandidates = this._safeQuery(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN reasoning_json IS NOT NULL AND reasoning_json != '{}' AND reasoning_json != 'null' AND LENGTH(reasoning_json) > 20 THEN 1 ELSE 0 END) as with_full_reasoning
      FROM candidates 
      WHERE source IN ('cursor_agent', 'asd_ais', 'ai') ${whereTime}
    `, whereParams);
    const aiReasoningRate = aiCandidates.total > 0 ? aiCandidates.with_full_reasoning / aiCandidates.total : 1;
    result.metrics.aiReasoningCompleteness = Math.round(aiReasoningRate * 100) / 100;

    if (aiReasoningRate < 0.7) {
      result.issues.push({ severity: 'warning', message: `Only ${(aiReasoningRate * 100).toFixed(0)}% of AI candidates have complete reasoning (target: 70%)` });
    }

    // 2. Guard 规则（boundary-constraint 类型 Recipe）有来源的比率
    const guardRecipes = this._safeQuery(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN source_candidate_id IS NOT NULL AND source_candidate_id != '' THEN 1 ELSE 0 END) as with_source
      FROM recipes WHERE knowledge_type = 'boundary-constraint' ${whereTime}
    `, whereParams);
    const guardSourceRate = guardRecipes.total > 0 ? guardRecipes.with_source / guardRecipes.total : 1;
    result.metrics.guardRuleSourceRate = Math.round(guardSourceRate * 100) / 100;

    // 3. 推理日志记录率
    let reasoningLogRate = 1;
    try {
      const hasTable = this.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='reasoning_logs'`).get();
      if (hasTable) {
        const logs = this._safeQuery(`SELECT COUNT(*) as total FROM reasoning_logs WHERE 1=1 ${whereTime}`, whereParams);
        const expected = aiCandidates.total + (guardRecipes.total > 0 ? 1 : 0);
        reasoningLogRate = expected > 0 ? Math.min(1, logs.total / expected) : 1;
      }
    } catch {}
    result.metrics.reasoningLogRate = Math.round(reasoningLogRate * 100) / 100;

    result.score = Math.round((aiReasoningRate * 0.4 + guardSourceRate * 0.3 + reasoningLogRate * 0.3) * 100) / 100;
    return result;
  }

  // ========== Priority 4: Helpfulness ==========

  _evaluateHelpfulness(since) {
    const result = { score: 0, metrics: {}, issues: [] };
    const whereTime = since ? 'AND created_at >= ?' : '';
    const whereParams = since ? [since] : [];

    // 1. Recipe 采纳率
    const recipes = this._safeQuery(`
      SELECT 
        COUNT(*) as total,
        SUM(adoption_count) as total_adoptions,
        SUM(application_count) as total_applications,
        AVG(quality_overall) as avg_quality
      FROM recipes WHERE status = 'active' ${whereTime}
    `, whereParams);
    result.metrics.activeRecipes = recipes.total;
    result.metrics.totalAdoptions = recipes.total_adoptions || 0;
    result.metrics.totalApplications = recipes.total_applications || 0;
    result.metrics.avgQuality = Math.round((recipes.avg_quality || 0) * 100) / 100;

    // 活跃 Recipe 有使用记录的比率
    const usedRecipes = this._safeQuery(`
      SELECT COUNT(*) as total FROM recipes 
      WHERE status = 'active' AND (adoption_count > 0 OR application_count > 0) ${whereTime}
    `, whereParams);
    const usageRate = recipes.total > 0 ? usedRecipes.total / recipes.total : 0;
    result.metrics.recipeUsageRate = Math.round(usageRate * 100) / 100;

    // 2. Guard 规则启用率（boundary-constraint 类型 Recipe 中 active 的比率）
    const guardStats = this._safeQuery(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as enabled_count
      FROM recipes WHERE knowledge_type = 'boundary-constraint'
    `);
    const enabledRate = guardStats.total > 0 ? guardStats.enabled_count / guardStats.total : 0;
    result.metrics.guardRuleEnabledRate = Math.round(enabledRate * 100) / 100;

    // 3. Candidate 采纳率 (approved+applied vs total)
    const candidates = this._safeQuery(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('approved', 'applied') THEN 1 ELSE 0 END) as accepted
      FROM candidates WHERE 1=1 ${whereTime}
    `, whereParams);
    const acceptRate = candidates.total > 0 ? candidates.accepted / candidates.total : 0;
    result.metrics.candidateAcceptRate = Math.round(acceptRate * 100) / 100;

    if (acceptRate < 0.6) {
      result.issues.push({ severity: 'info', message: `Candidate acceptance rate ${(acceptRate * 100).toFixed(0)}% is below 60% target` });
    }

    result.score = Math.round((usageRate * 0.3 + enabledRate * 0.2 + acceptRate * 0.3 + (recipes.avg_quality || 0) * 0.2) * 100) / 100;
    return result;
  }

  // ========== Recommendations ==========

  _generateRecommendations(priorities) {
    const recs = [];

    if (priorities.dataIntegrity.score < 0.7) {
      recs.push({
        priority: 'P1:DataIntegrity',
        action: 'Improve candidate reasoning completeness and conversion rate',
        severity: 'high',
      });
    }
    if (priorities.humanOversight.metrics.autoModifications > 0) {
      recs.push({
        priority: 'P2:HumanOversight',
        action: 'Investigate and block AI auto-modifications to recipes',
        severity: 'critical',
      });
    }
    if (priorities.aiTransparency.metrics.aiReasoningCompleteness < 0.7) {
      recs.push({
        priority: 'P3:AITransparency',
        action: 'Enforce reasoning field for AI-generated candidates',
        severity: 'medium',
      });
    }
    if (priorities.helpfulness.metrics.candidateAcceptRate < 0.6) {
      recs.push({
        priority: 'P4:Helpfulness',
        action: 'Improve AI candidate quality to increase acceptance rate',
        severity: 'medium',
      });
    }

    return recs;
  }

  // ========== Helpers ==========

  _getSinceTimestamp(period) {
    if (!period || period === 'all') return null;
    const now = Math.floor(Date.now() / 1000);
    switch (period) {
      case 'weekly': return now - 7 * 86400;
      case 'monthly': return now - 30 * 86400;
      case 'daily': return now - 86400;
      default: return null;
    }
  }

  _safeQuery(sql, params = []) {
    try {
      return this.db.prepare(sql).get(...params) || {};
    } catch {
      return {};
    }
  }
}

let instance = null;

export function initComplianceEvaluator(db) {
  instance = new ComplianceEvaluator(db);
  return instance;
}

export function getComplianceEvaluator() {
  return instance;
}

export default ComplianceEvaluator;
