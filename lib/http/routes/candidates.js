/**
 * 候选项 API 路由
 * 管理代码候选项的 CRUD 和生命周期操作
 */

import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getServiceContainer } from '../../injection/ServiceContainer.js';
import { NotFoundError, ValidationError } from '../../shared/errors/index.js';
import Logger from '../../infrastructure/logging/Logger.js';
import { getContext, safeInt } from '../utils/routeHelpers.js';

const router = express.Router();
const logger = Logger.getInstance();

const MAX_BATCH_SIZE = 100;

/**
 * GET /api/v1/candidates
 * 获取候选项列表（支持筛选和分页）
 */
router.get('/', asyncHandler(async (req, res) => {
  const { status, language, category, keyword } = req.query;
  const page = safeInt(req.query.page, 1);
  const pageSize = safeInt(req.query.limit, 20, 1, 100);

  const container = getServiceContainer();
  const candidateService = container.get('candidateService');

  if (keyword) {
    const result = await candidateService.searchCandidates(keyword, { page, pageSize });
    return res.json({ success: true, data: result });
  }

  const filters = {};
  if (status) filters.status = status;
  if (language) filters.language = language;
  if (category) filters.category = category;

  const result = await candidateService.listCandidates(filters, { page, pageSize });
  res.json({ success: true, data: result });
}));

/**
 * GET /api/v1/candidates/stats
 * 获取候选项统计
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const container = getServiceContainer();
  const candidateService = container.get('candidateService');
  const stats = await candidateService.getCandidateStats();
  res.json({ success: true, data: stats });
}));

/**
 * GET /api/v1/candidates/:id
 * 获取候选项详情
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const container = getServiceContainer();
  const candidateRepo = container.get('candidateRepository');
  const candidate = await candidateRepo.findById(id);

  if (!candidate) {
    throw new NotFoundError('Candidate not found', 'candidate', id);
  }

  res.json({ success: true, data: candidate });
}));

/**
 * POST /api/v1/candidates
 * 创建新候选项 (Gateway 管控: 权限 + 宪法 + 审计)
 * 自动查重: 创建后通过 ChatAgent check_duplicate 工具检测重复
 */
router.post('/', asyncHandler(async (req, res) => {
  const { code, language, category, source, reasoning, metadata } = req.body;

  if (!code || !language || !category) {
    throw new ValidationError('code, language and category are required');
  }

  const result = await req.gw('candidate:create', 'candidates', {
    code, language, category, source, reasoning, metadata,
  });

  // 自动查重（非阻塞 — AI 不可用时不影响提交）
  let duplicateCheck = null;
  try {
    const container = getServiceContainer();
    const chatAgent = container.get('chatAgent');
    const candidateForCheck = {
      title: metadata?.title || '',
      summary: metadata?.summary_cn || metadata?.summary || '',
      code: code,
      usageGuide: metadata?.usageGuide_cn || metadata?.usageGuide || '',
    };
    duplicateCheck = await chatAgent.executeTool('check_duplicate', {
      candidate: candidateForCheck,
    });
  } catch (err) {
    logger.warn('自动查重失败，不阻塞创建', { error: err.message });
  }

  res.status(201).json({
    success: true,
    data: result.data,
    requestId: result.requestId,
    duplicateCheck,
  });
}));

/**
 * POST /api/v1/candidates/batch-approve
 * 批量批准候选项
 */
router.post('/batch-approve', asyncHandler(async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ValidationError('ids array is required and must not be empty');
  }
  if (ids.length > MAX_BATCH_SIZE) {
    throw new ValidationError(`Batch size exceeds limit of ${MAX_BATCH_SIZE}`);
  }

  const container = getServiceContainer();
  const candidateService = container.get('candidateService');
  const context = getContext(req);

  const results = await Promise.allSettled(
    ids.map(id => candidateService.approveCandidate(id, context)),
  );

  const approved = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  const failed = results
    .map((r, i) => r.status === 'rejected' ? { id: ids[i], error: r.reason?.message } : null)
    .filter(Boolean);

  res.json({
    success: true,
    data: { approved, failed, total: ids.length, successCount: approved.length, failureCount: failed.length },
  });
}));

/**
 * POST /api/v1/candidates/batch-reject
 * 批量驳回候选项
 */
router.post('/batch-reject', asyncHandler(async (req, res) => {
  const { ids, reasoning } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ValidationError('ids array is required and must not be empty');
  }
  if (ids.length > MAX_BATCH_SIZE) {
    throw new ValidationError(`Batch size exceeds limit of ${MAX_BATCH_SIZE}`);
  }
  if (!reasoning) {
    throw new ValidationError('reasoning is required for rejection');
  }

  const container = getServiceContainer();
  const candidateService = container.get('candidateService');
  const context = getContext(req);

  const results = await Promise.allSettled(
    ids.map(id => candidateService.rejectCandidate(id, reasoning, context)),
  );

  const rejected = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  const failed = results
    .map((r, i) => r.status === 'rejected' ? { id: ids[i], error: r.reason?.message } : null)
    .filter(Boolean);

  res.json({
    success: true,
    data: { rejected, failed, total: ids.length, successCount: rejected.length, failureCount: failed.length },
  });
}));

/**
 * PATCH /api/v1/candidates/:id/approve
 * 批准候选项 (Gateway 管控)
 */
router.patch('/:id/approve', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await req.gw('candidate:approve', 'candidates', {
    candidateId: id,
  });

  res.json({ success: true, data: result.data, requestId: result.requestId });
}));

/**
 * PATCH /api/v1/candidates/:id/reject
 * 驳回候选项 (Gateway 管控)
 */
router.patch('/:id/reject', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reasoning } = req.body;

  if (!reasoning) {
    throw new ValidationError('reasoning is required for rejection');
  }

  const result = await req.gw('candidate:reject', 'candidates', {
    candidateId: id,
    reason: reasoning,
  });

  res.json({ success: true, data: result.data, requestId: result.requestId });
}));

/**
 * DELETE /api/v1/candidates/:id
 * 删除候选项 (Gateway 管控: 权限 + 宪法 + 审计)
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await req.gw('candidate:delete', 'candidates', {
    candidateId: id,
    confirmed: true,
  });
  res.json({ success: true, requestId: result.requestId });
}));

/**
 * POST /api/v1/candidates/batch-delete
 * 批量删除候选项（按 targetName / category）
 */
router.post('/batch-delete', asyncHandler(async (req, res) => {
  const { targetName } = req.body;
  if (!targetName) {
    throw new ValidationError('targetName is required');
  }
  const container = getServiceContainer();
  const candidateService = container.get('candidateService');

  // 查两次：按 category 字段 + 全量扫描 metadata.targetName
  // （前端分组 key = metadata.targetName || category，两者可能不同）
  const byCategory = await candidateService.listCandidates({ category: targetName }, { page: 1, pageSize: 2000 });
  const byCategoryItems = byCategory.data || byCategory.items || [];

  // 全量扫描 metadata.targetName 匹配（避免 category 不一致导致漏删）
  const allList = await candidateService.listCandidates({}, { page: 1, pageSize: 5000 });
  const allItems = allList.data || allList.items || [];
  const byTargetName = allItems.filter(c => {
    const meta = c.metadata || {};
    return meta.targetName === targetName;
  });

  // 合并去重
  const seen = new Set();
  const merged = [];
  for (const item of [...byCategoryItems, ...byTargetName]) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }

  let deleted = 0;
  for (const item of merged) {
    try { await candidateService.deleteCandidate(item.id, { userId: 'batch-delete' }); deleted++; } catch (err) {
      logger.debug('批量删除: 单条失败', { id: item.id, error: err.message });
    }
  }
  res.json({ success: true, data: { deleted } });
}));

/**
 * POST /api/v1/candidates/similarity
 * 查找与候选项相似的 Recipe
 */
router.post('/similarity', asyncHandler(async (req, res) => {
  const { targetName, candidateId, candidate } = req.body;
  const container = getServiceContainer();
  const candidateService = container.get('candidateService');
  const recipeService = container.get('recipeService');

  let cand = candidate;
  if (!cand && candidateId) {
    const list = await candidateService.listCandidates({}, { page: 1, pageSize: 2000 });
    const items = list.data || list.items || [];
    const found = items.find(c => c.id === candidateId);
    if (found) {
      const meta = found.metadata || {};
      cand = {
        title: meta.title || '',
        summary: meta.summary_cn || meta.summary || '',
        code: found.code || '',
        usageGuide: meta.usageGuide_cn || meta.usageGuide || '',
      };
    }
  }
  if (!cand) {
    return res.json({ success: true, data: { similar: [] } });
  }

  // Try SimilarityService first
  try {
    const { default: SimilarityService } = await import('../../service/candidate/SimilarityService.js');
    const config = container.get('config') || {};
    const projectRoot = config.projectRoot || container.singletons?._projectRoot || process.cwd();
    const simService = new SimilarityService();
    const result = await simService.findSimilarRecipes(projectRoot, cand);
    if (result && result.length > 0) {
      return res.json({ success: true, data: { similar: result } });
    }
  } catch (err) {
    logger.debug('SimilarityService 不可用，降级到文本相似度', { error: err.message });
  }

  // Fallback: text-based similarity
  const allRecipes = await recipeService.listRecipes({}, { page: 1, pageSize: 500 });
  const recipeItems = allRecipes.data || allRecipes.items || [];
  const candText = [cand.title, cand.summary, cand.code, cand.usageGuide].filter(Boolean).join(' ').toLowerCase();
  const candWords = new Set(candText.split(/\s+/).filter(w => w.length > 2));
  const similar = [];
  for (const r of recipeItems) {
    const recipeText = [r.title, r.description, (r.content || {}).pattern].filter(Boolean).join(' ').toLowerCase();
    const recipeWords = new Set(recipeText.split(/\s+/).filter(w => w.length > 2));
    let matches = 0;
    for (const w of candWords) { if (recipeWords.has(w)) matches++; }
    const similarity = matches / Math.max(candWords.size, recipeWords.size, 1);
    if (similarity >= 0.15) {
      similar.push({ recipeName: (r.title || r.id) + '.md', similarity: Math.round(similarity * 100) / 100 });
    }
  }
  similar.sort((a, b) => b.similarity - a.similarity);
  res.json({ success: true, data: { similar: similar.slice(0, 5) } });
}));

/**
 * POST /api/v1/candidates/:id/apply-to-recipe
 * 将候选项应用到 Recipe (Gateway 管控)
 */
router.post('/:id/apply-to-recipe', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { recipeId } = req.body;

  if (!recipeId) {
    throw new ValidationError('recipeId is required');
  }

  const result = await req.gw('candidate:apply_to_recipe', 'candidates', {
    candidateId: id,
    recipeId,
  });

  res.json({ success: true, data: result.data, requestId: result.requestId });
}));

/**
 * POST /api/v1/candidates/:id/promote
 * 将 APPROVED 候选项一键提升为 Recipe（自动创建 Recipe + 标记 APPLIED）
 * Body: { title?, category?, knowledgeType?, trigger?, tags? }
 */
router.post('/:id/promote', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const container = getServiceContainer();
  const candidateService = container.get('candidateService');
  const context = getContext(req);

  // overrides 允许用户在提升时微调字段
  const overrides = {};
  const ALLOWED = ['title', 'description', 'category', 'language', 'knowledgeType',
                   'complexity', 'scope', 'trigger', 'tags', 'rationale', 'kind', 'relations'];
  for (const key of ALLOWED) {
    if (req.body[key] !== undefined) overrides[key] = req.body[key];
  }

  const result = await candidateService.promoteCandidateToRecipe(id, overrides, context);
  res.status(201).json({ success: true, data: result });
}));

/**
 * POST /api/v1/candidates/batch-create
 * 批量创建候选项（从外部数据源批量导入）
 * Body: { items: Array<{ code, language, category, source?, reasoning?, metadata? }> }
 */
router.post('/batch-create', asyncHandler(async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError('items array is required');
  }
  if (items.length > MAX_BATCH_SIZE) {
    throw new ValidationError(`Max ${MAX_BATCH_SIZE} items per batch`);
  }

  const container = getServiceContainer();
  const candidateService = container.get('candidateService');
  const context = getContext(req);

  let created = 0;
  const errors = [];
  for (const item of items) {
    try {
      if (!item.code || !item.language || !item.category) {
        errors.push({ index: items.indexOf(item), error: 'code, language and category are required' });
        continue;
      }
      await candidateService.createCandidate({
        code: item.code,
        language: item.language,
        category: item.category,
        source: item.source || 'batch-import',
        reasoning: item.reasoning || undefined,
        metadata: item.metadata || undefined,
      }, context);
      created++;
    } catch (err) {
      errors.push({ index: items.indexOf(item), error: err.message });
    }
  }
  res.status(201).json({ success: true, data: { created, failed: errors.length, errors } });
}));

/**
 * POST /api/v1/candidates/enrich
 * AI 语义字段补全 — 对候选批量补充缺失的 rationale/knowledgeType/complexity/scope/steps/constraints
 * Body: { candidateIds: string[] }
 */
router.post('/enrich', asyncHandler(async (req, res) => {
  const { candidateIds } = req.body;

  if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
    throw new ValidationError('candidateIds array is required');
  }
  if (candidateIds.length > 20) {
    throw new ValidationError('Max 20 candidates per enrichment call');
  }

  const container = getServiceContainer();
  const chatAgent = container.get('chatAgent');
  const result = await chatAgent.executeTool('enrich_candidate', { candidateIds });

  if (result?.error) {
    throw new ValidationError(result.error);
  }

  res.json({ success: true, data: result });
}));

/**
 * POST /api/v1/candidates/bootstrap-refine
 * Phase 6 AI 润色 — 对 Bootstrap 候选批量改进描述、补充关系、调整评分
 * Body: { candidateIds?: string[], userPrompt?: string, dryRun?: boolean }
 */
router.post('/bootstrap-refine', asyncHandler(async (req, res) => {
  const { candidateIds, userPrompt, dryRun } = req.body;

  const container = getServiceContainer();
  const chatAgent = container.get('chatAgent');
  const result = await chatAgent.executeTool('refine_bootstrap_candidates', { candidateIds, userPrompt, dryRun });

  if (result?.error) {
    throw new ValidationError(result.error);
  }

  res.json({ success: true, data: result });
}));

/**
 * POST /api/v1/candidates/refine-preview
 * 对话式润色预览 — 单条候选 dryRun，返回 before/after 对比
 * Body: { candidateId: string, userPrompt?: string }
 */
router.post('/refine-preview', asyncHandler(async (req, res) => {
  const { candidateId, userPrompt } = req.body;
  if (!candidateId) throw new ValidationError('candidateId is required');

  const container = getServiceContainer();
  const candidateRepo = container.get('candidateRepository');
  const chatAgent = container.get('chatAgent');

  // 获取当前状态 (before)
  const candidate = await candidateRepo.findById(candidateId);
  if (!candidate) throw new NotFoundError('Candidate not found', 'candidate', candidateId);

  const meta = candidate.metadata || {};
  const before = {
    title: meta.title || '',
    summary: meta.summary || '',
    code: candidate.code || '',
    tags: meta.tags || [],
    confidence: meta.reasoning?.confidence ?? meta.refinedConfidence ?? 0.6,
    relations: meta.relations || [],
    insight: meta.aiInsight || null,
    agentNotes: meta.agentNotes || null,
  };

  // DryRun 润色取得 AI 预览
  const result = await chatAgent.executeTool('refine_bootstrap_candidates', {
    candidateIds: [candidateId],
    userPrompt,
    dryRun: true,
  });

  if (result?.error) throw new ValidationError(result.error);

  const preview = result.results?.[0]?.preview || {};

  // 构建 after 对象（增强 code 字段校验：防止 AI 返回截断/片段代码或类型变更）
  const origCode = before.code || '';
  const isOrigMarkdown = /^---\s*\n/.test(origCode) || /^#\s+/.test(origCode) || (origCode.match(/^#{1,3}\s+/gm) || []).length >= 2;
  const isPreviewMarkdown = preview.code && (/^---\s*\n/.test(preview.code) || /^#\s+/.test(preview.code) || (preview.code.match(/^#{1,3}\s+/gm) || []).length >= 2);
  // 防止源代码被转成 Markdown 文档
  const codeTypeChanged = !isOrigMarkdown && isPreviewMarkdown;
  const isCodeValid = preview.code
    && preview.code.length > 50
    && preview.code !== before.code
    && preview.code.length >= before.code.length * 0.4 // 不能太短（防止截断）
    && !codeTypeChanged; // 不允许类型变更
  const after = {
    title: preview.title || before.title,
    summary: preview.summary || before.summary,
    code: isCodeValid ? preview.code : before.code,
    tags: preview.tags ? [...new Set([...(before.tags || []), ...preview.tags])] : before.tags,
    confidence: (typeof preview.confidence === 'number' && preview.confidence !== 0.6) ? preview.confidence : before.confidence,
    relations: (preview.relations && Array.isArray(preview.relations) && preview.relations.length > 0) ? preview.relations : before.relations,
    insight: preview.insight || before.insight,
    agentNotes: (preview.agentNotes && Array.isArray(preview.agentNotes)) ? preview.agentNotes : before.agentNotes,
  };

  res.json({ success: true, data: { candidateId, before, after, preview } });
}));

/**
 * POST /api/v1/candidates/refine-apply
 * 对话式润色应用 — 确认后真正写入变更（非 dryRun）
 * Body: { candidateId: string, userPrompt?: string }
 */
router.post('/refine-apply', asyncHandler(async (req, res) => {
  const { candidateId, userPrompt } = req.body;
  if (!candidateId) throw new ValidationError('candidateId is required');

  const container = getServiceContainer();
  const chatAgent = container.get('chatAgent');

  const result = await chatAgent.executeTool('refine_bootstrap_candidates', {
    candidateIds: [candidateId],
    userPrompt,
    dryRun: false,
  });

  if (result?.error) throw new ValidationError(result.error);

  // 返回更新后的候选数据，供前端直接替换
  const candidateRepo = container.get('candidateRepository');
  const updated = await candidateRepo.findById(candidateId);

  res.json({ success: true, data: { ...result, candidate: updated } });
}));

export default router;
