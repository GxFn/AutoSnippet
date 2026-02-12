/**
 * MCP Handlers — 知识浏览类
 * listByKind, listRecipes, getRecipe, recipeInsights, complianceReport, confirmUsage
 */

import { envelope } from '../envelope.js';

export async function listByKind(ctx, kind, args) {
  const recipeService = ctx.container.get('recipeService');
  const filters = { kind };
  if (args.status) filters.status = args.status;
  if (args.language) filters.language = args.language;
  if (args.category) filters.category = args.category;
  const result = await recipeService.listRecipes(filters, { page: 1, pageSize: args.limit || 20 });
  const items = (result?.data || result?.items || []).map(r => ({
    id: r.id, title: r.title || r.name, description: r.description,
    trigger: r.trigger || '', status: r.status, language: r.language, category: r.category,
    knowledgeType: r.knowledgeType || r.knowledge_type, kind: r.kind,
    complexity: r.complexity, scope: r.scope, tags: r.tags || [],
    quality: r.quality || null, statistics: r.statistics || null,
  }));
  return envelope({ success: true, data: { kind, count: items.length, total: result?.pagination?.total || items.length, items }, meta: { tool: `autosnippet_list_${kind}s` } });
}

export async function listRecipes(ctx, args) {
  const recipeService = ctx.container.get('recipeService');
  const filters = {};
  if (args.kind) filters.kind = args.kind;
  if (args.language) filters.language = args.language;
  if (args.category) filters.category = args.category;
  if (args.knowledgeType) filters.knowledgeType = args.knowledgeType;
  if (args.status) filters.status = args.status;
  if (args.complexity) filters.complexity = args.complexity;
  const result = await recipeService.listRecipes(filters, { page: 1, pageSize: args.limit || 20 });
  const items = (result?.data || result?.items || []).map(r => ({
    id: r.id, title: r.title, description: r.description,
    trigger: r.trigger || '', status: r.status, language: r.language, category: r.category,
    kind: r.kind, knowledgeType: r.knowledgeType, complexity: r.complexity,
    scope: r.scope, tags: r.tags,
    quality: r.quality, statistics: r.statistics,
  }));
  return envelope({ success: true, data: { count: items.length, total: result?.pagination?.total || items.length, items }, meta: { tool: 'autosnippet_list_recipes' } });
}

export async function getRecipe(ctx, args) {
  if (!args.id) throw new Error('id is required');
  const recipeService = ctx.container.get('recipeService');
  const recipe = await recipeService.getRecipe(args.id);
  if (!recipe) throw new Error(`Recipe not found: ${args.id}`);
  return envelope({ success: true, data: recipe, meta: { tool: 'autosnippet_get_recipe' } });
}

export async function recipeInsights(ctx, args) {
  if (!args.id) throw new Error('id is required');
  const recipeService = ctx.container.get('recipeService');
  const recipe = await recipeService.getRecipe(args.id);
  if (!recipe) throw new Error(`Recipe not found: ${args.id}`);

  // 聚合关系摘要
  const relationsSummary = {};
  if (recipe.relations) {
    for (const [type, targets] of Object.entries(recipe.relations)) {
      if (Array.isArray(targets) && targets.length > 0) {
        relationsSummary[type] = targets.length;
      }
    }
  }

  // 约束条件概览
  const constraintsSummary = {};
  if (recipe.constraints) {
    for (const [type, items] of Object.entries(recipe.constraints)) {
      if (Array.isArray(items) && items.length > 0) {
        constraintsSummary[type] = items;
      }
    }
  }

  const insights = {
    id: recipe.id,
    title: recipe.title,
    trigger: recipe.trigger || '',
    kind: recipe.kind,
    status: recipe.status,
    language: recipe.language,
    category: recipe.category,
    knowledgeType: recipe.knowledgeType,
    quality: {
      overall: recipe.quality?.overall ?? null,
      codeCompleteness: recipe.quality?.codeCompleteness ?? null,
      projectAdaptation: recipe.quality?.projectAdaptation ?? null,
      documentationClarity: recipe.quality?.documentationClarity ?? null,
    },
    statistics: {
      adoptionCount: recipe.statistics?.adoptionCount ?? 0,
      applicationCount: recipe.statistics?.applicationCount ?? 0,
      guardHitCount: recipe.statistics?.guardHitCount ?? 0,
      viewCount: recipe.statistics?.viewCount ?? 0,
      successCount: recipe.statistics?.successCount ?? 0,
      feedbackScore: recipe.statistics?.feedbackScore ?? 0,
    },
    content: {
      hasPattern: !!recipe.content?.pattern,
      hasRationale: !!recipe.content?.rationale,
      hasMarkdown: !!recipe.content?.markdown,
      stepsCount: recipe.content?.steps?.length ?? 0,
      codeChangesCount: recipe.content?.codeChanges?.length ?? 0,
    },
    relations: relationsSummary,
    constraints: constraintsSummary,
    tags: recipe.tags || [],
    complexity: recipe.complexity,
    scope: recipe.scope,
    createdBy: recipe.createdBy,
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
  };

  return envelope({ success: true, data: insights, meta: { tool: 'autosnippet_recipe_insights' } });
}

export async function confirmUsage(ctx, args) {
  if (!args.recipeId) throw new Error('recipeId is required');
  const recipeService = ctx.container.get('recipeService');
  const usageType = args.usageType || 'adoption';
  const feedback = args.feedback || null;

  await recipeService.incrementUsage(args.recipeId, usageType, {
    feedback,
    actor: 'mcp_user',
  });

  // 持久化反馈到 FeedbackCollector（如有反馈内容）
  if (feedback) {
    try {
      const feedbackCollector = ctx.container.get('feedbackCollector');
      if (feedbackCollector) {
        feedbackCollector.record('feedback', args.recipeId, {
          usageType,
          comment: feedback,
        });
      }
    } catch { /* feedbackCollector 降级不影响主流程 */ }
  }

  return envelope({
    success: true,
    data: { recipeId: args.recipeId, usageType, feedback },
    message: `已记录 Recipe ${args.recipeId} 的${usageType === 'adoption' ? '采纳' : '应用'}`,
    meta: { tool: 'autosnippet_confirm_usage' },
  });
}
