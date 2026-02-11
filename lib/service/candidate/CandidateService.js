import { Candidate, CandidateStatus, Reasoning } from '../../domain/index.js';
import { isValidStateTransition } from '../../domain/types/CandidateStatus.js';
import Logger from '../../infrastructure/logging/Logger.js';
import { ValidationError, ConflictError, NotFoundError } from '../../shared/errors/index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * CandidateService
 * 管理代码候选项的完整生命周期
 * 包括创建、批准、驳回和应用到 Recipe 的业务逻辑
 */
export class CandidateService {
  constructor(candidateRepository, auditLogger, gateway, { fileWriter } = {}) {
    this.candidateRepository = candidateRepository;
    this.auditLogger = auditLogger;
    this.gateway = gateway;
    this.fileWriter = fileWriter || null;
    this.logger = Logger.getInstance();
  }

  /**
   * 创建新的候选项
   */
  async createCandidate(data, context) {
    try {
      // 验证输入
      this._validateCreateInput(data);

      // 创建实体
      const candidate = new Candidate({
        id: uuidv4(),
        code: data.code,
        language: data.language,
        category: data.category,
        source: data.source || 'manual',
        reasoning: data.reasoning
          ? new Reasoning({
              whyStandard: data.reasoning.whyStandard,
              sources: data.reasoning.sources || [],
              qualitySignals: data.reasoning.qualitySignals || {},
              alternatives: data.reasoning.alternatives || [],
              confidence: data.reasoning.confidence || 0.7,
            })
          : null,
        createdBy: context.userId,
        status: CandidateStatus.PENDING,
        metadata: data.metadata || {},
      });

      if (!candidate.isValid()) {
        throw new ValidationError('Invalid candidate data');
      }

      // 保存到数据库
      const created = await this.candidateRepository.create(candidate);

      // 落盘 .md 文件（Git 友好）
      if (this.fileWriter) {
        this.fileWriter.persistCandidate(created);
      }

      // 审计日志
      await this.auditLogger.log({
        action: 'create_candidate',
        resource: `candidate:${created.id}`,
        actor: context.userId,
        result: 'success',
        data: { codeLength: created.code.length },
      });

      this.logger.info('Candidate created', {
        candidateId: created.id,
        createdBy: context.userId,
        codeLength: created.code.length,
      });

      return created;
    } catch (error) {
      this.logger.error('Error creating candidate', {
        error: error.message,
        data,
      });
      throw error;
    }
  }

  /**
   * 批准候选项
   */
  async approveCandidate(candidateId, context) {
    try {
      const candidate = await this.candidateRepository.findById(candidateId);

      if (!candidate) {
        throw new NotFoundError('Candidate not found', 'candidate', candidateId);
      }

      // 检查状态转移的合法性
      if (!isValidStateTransition(candidate.status, CandidateStatus.APPROVED)) {
        throw new ConflictError(
          `Cannot approve candidate in ${candidate.status} status`,
          `Invalid transition from ${candidate.status} to APPROVED`
        );
      }

      // 执行批准
      candidate.approve(context.userId);

      // 保存
      const updated = await this.candidateRepository.update(candidateId, {
        status: candidate.status,
        status_history_json: JSON.stringify(candidate.statusHistory),
        approved_by: candidate.approvedBy,
        approved_at: candidate.approvedAt,
      });

      // 落盘 .md 文件
      if (this.fileWriter) {
        this.fileWriter.persistCandidate(updated);
      }

      // 审计日志
      await this.auditLogger.log({
        action: 'approve_candidate',
        resource: `candidate:${candidateId}`,
        actor: context.userId,
        result: 'success',
      });

      this.logger.info('Candidate approved', {
        candidateId,
        approvedBy: context.userId,
      });

      return updated;
    } catch (error) {
      this.logger.error('Error approving candidate', {
        candidateId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 驳回候选项
   */
  async rejectCandidate(candidateId, reason, context) {
    try {
      const candidate = await this.candidateRepository.findById(candidateId);

      if (!candidate) {
        throw new NotFoundError('Candidate not found', 'candidate', candidateId);
      }

      // 检查状态转移的合法性
      if (!isValidStateTransition(candidate.status, CandidateStatus.REJECTED)) {
        throw new ConflictError(
          `Cannot reject candidate in ${candidate.status} status`,
          `Invalid transition from ${candidate.status} to REJECTED`
        );
      }

      if (!reason || reason.trim().length === 0) {
        throw new ValidationError('Rejection reason is required');
      }

      // 执行驳回
      candidate.reject(reason, context.userId);

      // 保存
      const updated = await this.candidateRepository.update(candidateId, {
        status: candidate.status,
        status_history_json: JSON.stringify(candidate.statusHistory),
        rejection_reason: candidate.rejectionReason,
        rejected_by: candidate.rejectedBy,
      });

      // 落盘 .md 文件（保留驳回原因）
      if (this.fileWriter) {
        this.fileWriter.persistCandidate(updated);
      }

      // 审计日志
      await this.auditLogger.log({
        action: 'reject_candidate',
        resource: `candidate:${candidateId}`,
        actor: context.userId,
        result: 'success',
        data: { reason },
      });

      this.logger.info('Candidate rejected', {
        candidateId,
        rejectedBy: context.userId,
        reason,
      });

      return updated;
    } catch (error) {
      this.logger.error('Error rejecting candidate', {
        candidateId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 将候选项应用到 Recipe（标记为已被用于发布）
   */
  async applyToRecipe(candidateId, recipeId, context) {
    try {
      const candidate = await this.candidateRepository.findById(candidateId);

      if (!candidate) {
        throw new NotFoundError('Candidate not found', 'candidate', candidateId);
      }

      // 检查状态转移的合法性
      if (!isValidStateTransition(candidate.status, CandidateStatus.APPLIED)) {
        throw new ConflictError(
          `Cannot apply candidate in ${candidate.status} status`,
          `Invalid transition from ${candidate.status} to APPLIED`
        );
      }

      // 执行应用
      candidate.applyToRecipe(recipeId);

      // 保存
      const updated = await this.candidateRepository.update(candidateId, {
        status: candidate.status,
        status_history_json: JSON.stringify(candidate.statusHistory),
        applied_recipe_id: candidate.appliedRecipeId,
      });

      // 落盘 .md 文件
      if (this.fileWriter) {
        this.fileWriter.persistCandidate(updated);
      }

      // 审计日志
      await this.auditLogger.log({
        action: 'apply_candidate_to_recipe',
        resource: `candidate:${candidateId}`,
        actor: context.userId,
        result: 'success',
        data: { recipeId },
      });

      this.logger.info('Candidate applied to recipe', {
        candidateId,
        recipeId,
        appliedBy: context.userId,
      });

      return updated;
    } catch (error) {
      this.logger.error('Error applying candidate to recipe', {
        candidateId,
        recipeId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 查询候选项列表
   */
  async listCandidates(filters = {}, pagination = {}) {
    try {
      const { status, language, category, createdBy, source } = filters;
      const { page = 1, pageSize = 20 } = pagination;

      // 组合查询 — 支持多条件同时筛选
      const dbFilters = {};
      if (status)    dbFilters.status = status;
      if (language)  dbFilters.language = language;
      if (category)  dbFilters.category = category;
      if (source)    dbFilters.source = source;
      if (createdBy) dbFilters.created_by = createdBy;

      return this.candidateRepository.findWithPagination(dbFilters, { page, pageSize });
    } catch (error) {
      this.logger.error('Error listing candidates', {
        error: error.message,
        filters,
      });
      throw error;
    }
  }

  /**
   * 搜索候选项
   */
  async searchCandidates(keyword, pagination = {}) {
    try {
      const { page = 1, pageSize = 20 } = pagination;
      return this.candidateRepository.search(keyword, { page, pageSize });
    } catch (error) {
      this.logger.error('Error searching candidates', {
        keyword,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 获取候选项统计
   */
  async getCandidateStats() {
    try {
      return this.candidateRepository.getStats();
    } catch (error) {
      this.logger.error('Error getting candidate stats', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * AI 语义字段补全 — 对已有候选补充缺失的 rationale/knowledgeType/complexity/scope/steps/constraints
   * @param {string[]} candidateIds - 候选 ID 列表
   * @param {object} aiProvider - AiProvider 实例（由调用方注入）
   * @param {object} context
   * @returns {Promise<{enriched: number, results: object[]}>}
   */
  async enrichCandidates(candidateIds, aiProvider, context) {
    if (!aiProvider || typeof aiProvider.enrichCandidates !== 'function') {
      throw new ValidationError('AI provider with enrichCandidates capability is required');
    }

    // 1. 从 DB 取出候选
    const candidates = [];
    for (const id of candidateIds) {
      const c = await this.candidateRepository.findById(id);
      if (c) candidates.push(c);
    }
    if (candidates.length === 0) throw new NotFoundError('No candidates found');

    // 2. 构建 AI 输入（合并 metadata 字段到顶层供 AI 分析）
    const aiInput = candidates.map(c => {
      const m = c.metadata || {};
      return {
        code: c.code,
        language: c.language,
        category: c.category,
        title: m.title || '',
        description: m.description || m.summary || '',
        summary: m.summary || '',
        rationale: m.rationale || '',
        knowledgeType: m.knowledgeType || '',
        complexity: m.complexity || '',
        scope: m.scope || '',
        steps: m.steps || [],
        constraints: m.constraints || {},
      };
    });

    // 3. 调用 AI 补全
    const enrichResults = await aiProvider.enrichCandidates(aiInput);

    // 4. 合并结果写回 metadata
    let enrichedCount = 0;
    const results = [];
    for (const enriched of enrichResults) {
      const idx = enriched.index;
      if (idx == null || idx < 0 || idx >= candidates.length) continue;
      const candidate = candidates[idx];
      const meta = { ...(candidate.metadata || {}) };
      let changed = false;

      const SEMANTIC_KEYS = ['rationale', 'knowledgeType', 'complexity', 'scope', 'steps', 'constraints'];
      for (const key of SEMANTIC_KEYS) {
        if (enriched[key] !== undefined && enriched[key] !== null && enriched[key] !== '') {
          // 只填充缺失的字段
          if (!meta[key] || (typeof meta[key] === 'string' && meta[key].trim() === '') ||
              (Array.isArray(meta[key]) && meta[key].length === 0) ||
              (typeof meta[key] === 'object' && !Array.isArray(meta[key]) && Object.keys(meta[key]).length === 0)) {
            meta[key] = enriched[key];
            changed = true;
          }
        }
      }

      if (changed) {
        const enrichedCandidate = await this.candidateRepository.update(candidate.id, { metadata_json: JSON.stringify(meta) });
        // 落盘 .md 文件
        if (this.fileWriter && enrichedCandidate) {
          this.fileWriter.persistCandidate(enrichedCandidate);
        }
        enrichedCount++;
      }

      results.push({
        id: candidate.id,
        enriched: changed,
        filledFields: Object.keys(enriched).filter(k => k !== 'index'),
      });
    }

    // 5. 审计
    await this.auditLogger.log({
      action: 'enrich_candidates',
      resource: 'candidates',
      actor: context.userId || 'system',
      result: 'success',
      data: { total: candidates.length, enriched: enrichedCount },
    });

    return { enriched: enrichedCount, total: candidates.length, results };
  }

  /**
   * 验证创建输入
   */
  _validateCreateInput(data) {
    if (!data.code || data.code.trim().length === 0) {
      throw new ValidationError('Code is required');
    }

    if (!data.language || data.language.trim().length === 0) {
      throw new ValidationError('Language is required');
    }

    if (!data.category || data.category.trim().length === 0) {
      throw new ValidationError('Category is required');
    }

    if (data.code.length > 50 * 1024) {
      throw new ValidationError('Code exceeds maximum size of 50KB');
    }

    // reasoning 校验 — 提供明确错误信息而非泛化的 "Invalid candidate data"
    if (!data.reasoning) {
      throw new ValidationError('Reasoning is required — provide { whyStandard, sources, confidence }');
    }
    if (!data.reasoning.whyStandard || (typeof data.reasoning.whyStandard === 'string' && data.reasoning.whyStandard.trim().length === 0)) {
      throw new ValidationError('reasoning.whyStandard is required — explain why this code is worth capturing');
    }
    if (!Array.isArray(data.reasoning.sources) || data.reasoning.sources.length === 0) {
      throw new ValidationError('reasoning.sources must be a non-empty array — list at least one source file or reference');
    }

    // metadata 大小限制
    if (data.metadata) {
      const metaStr = typeof data.metadata === 'string' ? data.metadata : JSON.stringify(data.metadata);
      if (metaStr.length > 200 * 1024) {
        throw new ValidationError('Metadata exceeds maximum size of 200KB');
      }
    }
  }
}

export default CandidateService;
