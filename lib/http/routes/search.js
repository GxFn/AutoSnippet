/**
 * Search API 路由
 * 统一搜索接口 - 搜 Recipe（含所有知识类型）
 */

import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getServiceContainer } from '../../injection/ServiceContainer.js';
import { ValidationError } from '../../shared/errors/index.js';

const router = express.Router();

function safeInt(value, defaultValue, min = 1, max = 1000) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return Math.max(min, Math.min(max, parsed));
}

/**
 * GET /api/v1/search
 * 统一搜索
 * ?q=keyword&type=all|recipe|solution|rule&limit=20&mode=keyword|bm25|semantic&groupByKind=true
 */
router.get('/', asyncHandler(async (req, res) => {
  const { q, type = 'all', mode = 'keyword' } = req.query;
  const limit = safeInt(req.query.limit, 20, 1, 100);
  const page = safeInt(req.query.page, 1);
  const groupByKind = req.query.groupByKind === 'true';

  if (!q || !q.trim()) {
    throw new ValidationError('Search query (q) is required');
  }

  const container = getServiceContainer();

  // 如果指定了 mode (bm25/semantic)，使用 SearchEngine 直接搜索
  if (mode === 'bm25' || mode === 'semantic' || mode === 'ranking') {
    try {
      const searchEngine = container.get('searchEngine');
      const result = await searchEngine.search(q, { type, limit, mode, groupByKind });
      return res.json({ success: true, data: result });
    } catch {
      // 降级到传统搜索
    }
  }

  const results = {};
  const pagination = { page, pageSize: limit };

  // 搜索 Recipe（统一模型，包含所有知识类型）
  if (type === 'all' || type === 'recipe' || type === 'solution') {
    try {
      const recipeService = container.get('recipeService');
      results.recipes = await recipeService.searchRecipes(q, pagination);
    } catch {
      results.recipes = { items: [], total: 0 };
    }
  }

  // 搜索 Guard Rule（boundary-constraint 类型的 Recipe）
  if (type === 'all' || type === 'rule') {
    try {
      const guardService = container.get('guardService');
      results.rules = await guardService.searchRules(q, pagination);
    } catch {
      results.rules = { items: [], total: 0 };
    }
  }

  // 搜索 Candidate
  if (type === 'all' || type === 'candidate') {
    try {
      const candidateService = container.get('candidateService');
      results.candidates = await candidateService.searchCandidates(q, pagination);
    } catch {
      results.candidates = { items: [], total: 0 };
    }
  }

  const totalResults = Object.values(results).reduce((sum, r) => sum + (r.total || r.items?.length || 0), 0);

  res.json({
    success: true,
    data: {
      query: q,
      type,
      mode,
      totalResults,
      ...results,
    },
  });
}));

/**
 * GET /api/v1/search/graph
 * 知识图谱查询
 * ?nodeId=xxx&nodeType=recipe
 */
router.get('/graph', asyncHandler(async (req, res) => {
  const { nodeId, nodeType, relation, direction = 'both' } = req.query;

  if (!nodeId || !nodeType) {
    throw new ValidationError('nodeId and nodeType are required');
  }

  const container = getServiceContainer();
  const graphService = container.get('knowledgeGraphService');

  if (!graphService) {
    return res.json({ success: true, data: { outgoing: [], incoming: [] } });
  }

  const edges = relation
    ? graphService.getRelated(nodeId, nodeType, relation)
    : graphService.getEdges(nodeId, nodeType, direction);

  res.json({ success: true, data: edges });
}));

/**
 * GET /api/v1/search/graph/impact
 * 影响分析
 */
router.get('/graph/impact', asyncHandler(async (req, res) => {
  const { nodeId, nodeType } = req.query;
  const maxDepth = safeInt(req.query.maxDepth, 3, 1, 5);

  if (!nodeId || !nodeType) {
    throw new ValidationError('nodeId and nodeType are required');
  }

  const container = getServiceContainer();
  const graphService = container.get('knowledgeGraphService');

  if (!graphService) {
    return res.json({ success: true, data: [] });
  }

  const impact = graphService.getImpactAnalysis(nodeId, nodeType, maxDepth);
  res.json({ success: true, data: impact });
}));

/**
 * GET /api/v1/search/graph/all
 * 全量知识图谱边（Dashboard 可视化用）
 * ?limit=500
 */
router.get('/graph/all', asyncHandler(async (req, res) => {
  const limit = safeInt(req.query.limit, 500, 1, 2000);

  const container = getServiceContainer();
  const graphService = container.get('knowledgeGraphService');

  if (!graphService) {
    return res.json({ success: true, data: { edges: [], nodeLabels: {} } });
  }

  const edges = graphService.getAllEdges(limit);

  // 收集节点 ID → 查 Recipe 标题用于节点标签
  const nodeIds = new Set();
  for (const e of edges) {
    nodeIds.add(e.fromId);
    nodeIds.add(e.toId);
  }

  const nodeLabels = {};
  if (nodeIds.size > 0) {
    try {
      const recipeService = container.get('recipeService');
      if (recipeService) {
        for (const id of nodeIds) {
          try {
            const r = await recipeService.getRecipe(id);
            if (r) nodeLabels[id] = r.title || r.name || id;
          } catch { nodeLabels[id] = id; }
        }
      }
    } catch { /* recipeService not available */ }
  }

  res.json({ success: true, data: { edges, nodeLabels } });
}));

/**
 * GET /api/v1/search/graph/stats
 * 图谱统计
 */
router.get('/graph/stats', asyncHandler(async (req, res) => {
  const container = getServiceContainer();
  const graphService = container.get('knowledgeGraphService');

  if (!graphService) {
    return res.json({ success: true, data: { totalEdges: 0, byRelation: {}, nodeTypes: [] } });
  }

  const stats = graphService.getStats();
  res.json({ success: true, data: stats });
}));

/**
 * GET /api/v1/search/compliance
 * 合规评估报告
 */
router.get('/compliance', asyncHandler(async (req, res) => {
  const { period } = req.query;
  const container = getServiceContainer();
  const evaluator = container.get('complianceEvaluator');

  if (!evaluator) {
    return res.json({ success: true, data: { overallScore: 0, message: 'ComplianceEvaluator not available' } });
  }

  const report = evaluator.evaluate({ period });
  res.json({ success: true, data: report });
}));

/**
 * POST /api/v1/search/trigger-from-code
 * Xcode trigger 搜索模拟 (stub — 功能未完整实现)
 */
router.post('/trigger-from-code', asyncHandler(async (req, res) => {
  res.json({ success: true, data: { results: [], total: 0, triggered: false } });
}));

/**
 * POST /api/v1/search/context-aware
 * 上下文感知搜索
 */
router.post('/context-aware', asyncHandler(async (req, res) => {
  const { keyword, limit } = req.body;
  if (!keyword || !keyword.trim()) {
    throw new ValidationError('keyword is required');
  }
  const container = getServiceContainer();
  const recipeService = container.get('recipeService');
  const pageSize = Math.min(limit || 10, 100);
  const list = await recipeService.searchRecipes(keyword, { page: 1, pageSize });
  const items = list.data || list.items || [];
  const results = items.map(r => ({
    name: (r.title || r.id) + '.md',
    content: (r.content || {}).pattern || (r.content || {}).markdown || '',
    similarity: 1,
    authority: (r.quality || {}).overall || 0,
    matchType: 'keyword',
    qualityScore: (r.quality || {}).overall || 0,
  }));
  res.json({
    success: true,
    data: { results, context: {}, total: list.total || results.length, hasAiEvaluation: false, searchTime: 0 },
  });
}));

export default router;
