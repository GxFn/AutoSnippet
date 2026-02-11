/**
 * Snippets API 路由
 * Snippet = Recipe 的附属产物，从 Recipe 实时生成，不存 DB
 */

import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getServiceContainer } from '../../injection/ServiceContainer.js';
import { NotFoundError } from '../../shared/errors/index.js';

const router = express.Router();

/**
 * GET /api/v1/snippets
 * 从 Recipe 实时生成 Snippet 列表
 */
router.get('/', asyncHandler(async (req, res) => {
  const container = getServiceContainer();
  const snippetFactory = container.get('snippetFactory');

  const { language, category, keyword } = req.query;
  const filters = {};
  if (language) filters.language = language;
  if (category) filters.category = category;
  if (keyword) filters.keyword = keyword;

  const snippets = await snippetFactory.listSnippets(filters);

  res.json({
    success: true,
    data: {
      snippets,
      total: snippets.length,
    },
  });
}));

/**
 * GET /api/v1/snippets/:id
 * 从单个 Recipe 实时生成 Snippet
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const container = getServiceContainer();
  const snippetFactory = container.get('snippetFactory');

  const snippet = await snippetFactory.getSnippet(req.params.id);
  if (!snippet) {
    throw new NotFoundError('Snippet (recipe)', req.params.id);
  }

  res.json({ success: true, data: snippet });
}));

/**
 * POST /api/v1/snippets/install
 * 从全部 Recipe 生成并同步到 Xcode
 */
router.post('/install', asyncHandler(async (req, res) => {
  const container = getServiceContainer();
  const snippetFactory = container.get('snippetFactory');
  const snippetInstaller = container.get('snippetInstaller');
  const recipeRepository = container.get('recipeRepository');

  // 获取所有活跃 Recipe
  const result = await recipeRepository.findWithPagination(
    { status: 'active' },
    { page: 1, pageSize: 9999 },
  );
  const recipes = (result?.data || result?.items || []).map(r => ({
    id: r.id,
    title: r.title,
    trigger: r.trigger,
    code: r.content?.pattern || '',
    description: r.description || r.summaryCn || '',
    language: r.language || 'swift',
  }));

  // 批量安装
  const installResult = snippetInstaller.installFromRecipes(recipes);

  res.json({
    success: true,
    data: installResult,
  });
}));

export default router;
