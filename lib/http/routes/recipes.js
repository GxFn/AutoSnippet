/**
 * Recipe API 路由
 * 管理代码模式和最佳实践的 CRUD 和生命周期操作
 */

import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getServiceContainer } from '../../injection/ServiceContainer.js';
import { NotFoundError, ValidationError } from '../../shared/errors/index.js';
import Logger from '../../infrastructure/logging/Logger.js';

const logger = Logger.getInstance();

const router = express.Router();

/** 从请求中提取操作上下文 */
function getContext(req) {
  return {
    userId: req.headers['x-user-id'] || 'anonymous',
    ip: req.ip,
    userAgent: req.headers['user-agent'] || '',
  };
}

/** 安全的整数解析 */
function safeInt(value, defaultValue, min = 1, max = 1000) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return Math.max(min, Math.min(max, parsed));
}

/**
 * GET /api/v1/recipes
 * 获取 Recipe 列表（支持筛选和分页）
 */
router.get('/', asyncHandler(async (req, res) => {
  const { status, category, language, knowledgeType, kind, keyword, tag } = req.query;
  const page = safeInt(req.query.page, 1);
  const pageSize = safeInt(req.query.limit, 20, 1, 100);

  const container = getServiceContainer();
  const recipeService = container.get('recipeService');

  if (keyword) {
    const result = await recipeService.searchRecipes(keyword, { page, pageSize });
    return res.json({ success: true, data: result });
  }

  const filters = {};
  if (status) filters.status = status;
  if (category) filters.category = category;
  if (language) filters.language = language;
  if (knowledgeType) filters.knowledgeType = knowledgeType;
  if (kind) filters.kind = kind;
  if (tag) filters.tag = tag;

  const result = await recipeService.listRecipes(filters, { page, pageSize });
  res.json({ success: true, data: result });
}));

/**
 * GET /api/v1/recipes/stats
 * 获取 Recipe 统计
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const container = getServiceContainer();
  const recipeService = container.get('recipeService');
  const stats = await recipeService.getRecipeStats();
  res.json({ success: true, data: stats });
}));

/**
 * GET /api/v1/recipes/recommendations
 * 获取推荐 Recipe
 */
router.get('/recommendations', asyncHandler(async (req, res) => {
  const limit = safeInt(req.query.limit, 10, 1, 50);
  const container = getServiceContainer();
  const recipeService = container.get('recipeService');
  const recommendations = await recipeService.getRecommendations(limit);
  res.json({ success: true, data: recommendations });
}));

/**
 * GET /api/v1/recipes/:id
 * 获取 Recipe 详情
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const container = getServiceContainer();
  const recipeRepo = container.get('recipeRepository');
  const recipe = await recipeRepo.findById(id);

  if (!recipe) {
    throw new NotFoundError('Recipe not found', 'recipe', id);
  }

  res.json({ success: true, data: recipe });
}));

/**
 * POST /api/v1/recipes
 * 创建新 Recipe（草稿状态）(Gateway 管控: 权限 + 宪法 + 审计)
 */
router.post('/', asyncHandler(async (req, res) => {
  const {
    title, description, language, category, content,
    relations, constraints, knowledgeType, complexity, scope,
    sourceCandidate, tags, dimensions, trigger,
    summaryCn, summaryEn, usageGuideCn, usageGuideEn,
  } = req.body;

  if (!title || !language || !category) {
    throw new ValidationError('title, language and category are required');
  }

  const result = await req.gw('recipe:create', 'recipes', {
    title, description, language, category, content,
    relations, constraints, knowledgeType, complexity, scope,
    sourceCandidate, tags, dimensions, trigger,
    summaryCn, summaryEn, usageGuideCn, usageGuideEn,
  });

  res.status(201).json({ success: true, data: result.data, requestId: result.requestId });
}));

/**
 * PATCH /api/v1/recipes/:id
 * 通用更新 Recipe（白名单字段）
 */
router.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const container = getServiceContainer();
  const recipeService = container.get('recipeService');
  const context = getContext(req);

  const recipe = await recipeService.updateRecipe(id, req.body, context);
  res.json({ success: true, data: recipe });
}));

/**
 * DELETE /api/v1/recipes/:id
 * 删除 Recipe (Gateway 管控: 权限 + 宪法 + 审计)
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await req.gw('recipe:delete', 'recipes', {
    recipeId: id,
    confirmed: true,
  });

  res.json({ success: true, data: result.data, requestId: result.requestId });
}));

/**
 * PATCH /api/v1/recipes/:id/publish
 * 发布 Recipe（DRAFT → ACTIVE）(Gateway 管控)
 */
router.patch('/:id/publish', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await req.gw('recipe:publish', 'recipes', {
    recipeId: id,
  });

  // 发布后自动发现知识图谱关系（非阻塞）
  try {
    const container = getServiceContainer();
    const chatAgent = container.get('chatAgent');
    const recipeRepo = container.get('recipeRepository');
    const published = await recipeRepo.findById(id);
    if (published) {
      // 获取同分类/同语言的其他 Recipe，与新发布的 Recipe 配对分析
      const { items = [], data: listData = [] } = await container.get('recipeService').listRecipes(
        { language: published.language },
        { page: 1, pageSize: 20 },
      );
      const peers = (items.length > 0 ? items : listData).filter(r => r.id !== id).slice(0, 10);
      if (peers.length > 0) {
        const recipePairs = peers.map(peer => ({
          a: { id: published.id, title: published.title, category: published.category, language: published.language, code: (published.content || published.code || '').substring(0, 500) },
          b: { id: peer.id, title: peer.title, category: peer.category, language: peer.language, code: (peer.content || peer.code || '').substring(0, 500) },
        }));
        // 异步执行，不阻塞响应
        chatAgent.executeTool('discover_relations', { recipePairs }).catch(err => {
          logger.debug('Auto discover_relations skipped', { error: err.message });
        });
      }
    }
  } catch { /* Agent 不可用时不阻塞发布 */ }

  res.json({ success: true, data: result.data, requestId: result.requestId });
}));

/**
 * PATCH /api/v1/recipes/:id/deprecate
 * 弃用 Recipe (Gateway 管控)
 */
router.patch('/:id/deprecate', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  if (!reason) {
    throw new ValidationError('reason is required for deprecation');
  }

  const result = await req.gw('recipe:deprecate', 'recipes', {
    recipeId: id,
    reason,
  });

  res.json({ success: true, data: result.data, requestId: result.requestId });
}));

/**
 * PATCH /api/v1/recipes/:id/quality
 * 更新 Recipe 质量指标
 */
router.patch('/:id/quality', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { codeCompleteness, projectAdaptation, documentationClarity } = req.body;

  const metrics = {};
  if (codeCompleteness !== undefined) metrics.codeCompleteness = codeCompleteness;
  if (projectAdaptation !== undefined) metrics.projectAdaptation = projectAdaptation;
  if (documentationClarity !== undefined) metrics.documentationClarity = documentationClarity;

  if (Object.keys(metrics).length === 0) {
    throw new ValidationError('At least one quality metric is required');
  }

  const container = getServiceContainer();
  const recipeService = container.get('recipeService');
  const context = getContext(req);

  const recipe = await recipeService.updateQuality(id, metrics, context);
  res.json({ success: true, data: recipe });
}));

/**
 * POST /api/v1/recipes/:id/adopt
 * 记录 Recipe 被采纳
 */
router.post('/:id/adopt', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const container = getServiceContainer();
  const recipeService = container.get('recipeService');
  await recipeService.incrementAdoption(id);
  res.json({ success: true, message: 'Adoption recorded' });
}));

/**
 * POST /api/v1/recipes/:id/apply
 * 记录 Recipe 被应用
 */
router.post('/:id/apply', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const container = getServiceContainer();
  const recipeService = container.get('recipeService');
  await recipeService.incrementApplication(id);
  res.json({ success: true, message: 'Application recorded' });
}));

/**
 * POST /api/v1/recipes/batch-record-usage
 * 批量记录 Recipe 使用（按关键词搜索匹配）
 * Body: { items: Array<{ keyword: string, usageType?: 'adoption'|'application' }> }
 */
router.post('/batch-record-usage', asyncHandler(async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError('items array is required');
  }
  if (items.length > 100) {
    throw new ValidationError('Max 100 items per batch');
  }

  const container = getServiceContainer();
  const recipeService = container.get('recipeService');
  let recorded = 0;

  for (const entry of items) {
    const keyword = entry.keyword || entry.recipeFilePath || '';
    if (!keyword) continue;
    try {
      const result = await recipeService.searchRecipes(
        keyword.replace(/\.md$/, ''),
        { page: 1, pageSize: 1 },
      );
      const found = result?.items?.[0];
      if (found) {
        const type = entry.usageType || 'adoption';
        await recipeService.incrementUsage(found.id, type);
        recorded++;
      }
    } catch { /* skip individual failures */ }
  }

  res.json({ success: true, data: { recorded, total: items.length } });
}));

/**
 * POST /api/v1/recipes/discover-relations
 * AI 批量发现知识图谱关系（异步后台任务）
 * Body: { batchSize?: number }
 */

// 内存中的任务状态（单进程足够）
const _discoverTask = { running: false, result: null, error: null, startedAt: null, finishedAt: null };

// 10 分钟超时保护
const DISCOVER_TIMEOUT_MS = 10 * 60 * 1000;

router.post('/discover-relations', asyncHandler(async (req, res) => {
  if (_discoverTask.running) {
    // 检查是否已超时
    const elapsed = Date.now() - new Date(_discoverTask.startedAt).getTime();
    if (elapsed > DISCOVER_TIMEOUT_MS) {
      _discoverTask.running = false;
      _discoverTask.error = `任务超时（运行 ${Math.round(elapsed / 1000)}s 后强制结束）`;
      _discoverTask.finishedAt = new Date().toISOString();
      return res.json({ success: true, data: { status: 'timeout', error: _discoverTask.error, startedAt: _discoverTask.startedAt } });
    }
    return res.json({ success: true, data: { status: 'running', startedAt: _discoverTask.startedAt, elapsed: Math.round(elapsed / 1000) } });
  }

  const { batchSize = 20 } = req.body;
  const container = getServiceContainer();

  // 前置检查：ChatAgent 和 AI Provider 是否可用
  const chatAgent = container.get('chatAgent');
  if (!chatAgent) {
    return res.status(503).json({ success: false, error: { message: 'ChatAgent 服务不可用，请检查服务配置' } });
  }

  const recipeService = container.get('recipeService');
  if (!recipeService) {
    return res.status(503).json({ success: false, error: { message: 'RecipeService 不可用' } });
  }

  // 检查是否有足够 Recipe
  try {
    const { items = [], data = [] } = await recipeService.listRecipes({}, { page: 1, pageSize: 5 });
    const count = (items.length > 0 ? items : data).length;
    if (count < 2) {
      return res.json({ success: true, data: { status: 'empty', message: `当前只有 ${count} 条 Recipe，至少需要 2 条才能分析关系` } });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: `检查 Recipe 失败: ${err.message}` } });
  }

  _discoverTask.running = true;
  _discoverTask.result = null;
  _discoverTask.error = null;
  _discoverTask.finishedAt = null;
  _discoverTask.startedAt = new Date().toISOString();

  // 后台执行，不阻塞请求
  const timeoutHandle = setTimeout(() => {
    if (_discoverTask.running) {
      _discoverTask.running = false;
      _discoverTask.error = '任务超时（超过 10 分钟）';
      _discoverTask.finishedAt = new Date().toISOString();
      logger.warn('discover-relations timed out');
    }
  }, DISCOVER_TIMEOUT_MS);

  chatAgent.runTask('discover_all_relations', { batchSize })
    .then(result => { _discoverTask.result = result; })
    .catch(err => {
      _discoverTask.error = err.message || String(err);
      logger.error('discover-relations failed', { error: err.message });
    })
    .finally(() => {
      clearTimeout(timeoutHandle);
      _discoverTask.running = false;
      _discoverTask.finishedAt = new Date().toISOString();
    });

  res.json({ success: true, data: { status: 'started', startedAt: _discoverTask.startedAt } });
}));

/**
 * GET /api/v1/recipes/discover-relations/status
 * 查询关系发现任务进度
 */
router.get('/discover-relations/status', asyncHandler(async (req, res) => {
  const elapsed = _discoverTask.startedAt
    ? Math.round((Date.now() - new Date(_discoverTask.startedAt).getTime()) / 1000)
    : 0;

  if (_discoverTask.running) {
    return res.json({ success: true, data: { status: 'running', startedAt: _discoverTask.startedAt, elapsed } });
  }
  if (_discoverTask.error) {
    return res.json({ success: true, data: { status: 'error', error: _discoverTask.error, startedAt: _discoverTask.startedAt, finishedAt: _discoverTask.finishedAt } });
  }
  if (_discoverTask.result) {
    return res.json({ success: true, data: {
      status: 'done',
      ...(_discoverTask.result),
      startedAt: _discoverTask.startedAt,
      finishedAt: _discoverTask.finishedAt,
    } });
  }
  res.json({ success: true, data: { status: 'idle' } });
}));

export default router;
