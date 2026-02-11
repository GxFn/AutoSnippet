/**
 * GatewayActionRegistry - 将所有服务操作注册为 Gateway 路由
 * 
 * 这是连接 Gateway ↔ Service 的桥梁：
 * - 路由层格式化 Gateway 请求 {actor, action, resource, data}
 * - Gateway 执行权限/宪法/审计
 * - GatewayActionRegistry 将 action 路由到正确的 Service 方法
 */

import Logger from '../../infrastructure/logging/Logger.js';

const logger = Logger.getInstance();

/**
 * 注册所有 Gateway actions
 * @param {import('./Gateway.js').Gateway} gateway
 * @param {import('../../injection/ServiceContainer.js').ServiceContainer} container
 */
export function registerGatewayActions(gateway, container) {
  // ========== Candidate Actions ==========

  gateway.register('candidate:create', async (ctx) => {
    const service = container.get('candidateService');
    return service.createCandidate(ctx.data, {
      userId: ctx.actor,
      ip: ctx.data._ip,
      userAgent: ctx.data._userAgent,
    });
  });

  gateway.register('candidate:approve', async (ctx) => {
    const service = container.get('candidateService');
    return service.approveCandidate(ctx.data.candidateId, {
      userId: ctx.actor,
    });
  });

  gateway.register('candidate:reject', async (ctx) => {
    const service = container.get('candidateService');
    return service.rejectCandidate(ctx.data.candidateId, ctx.data.reason, {
      userId: ctx.actor,
    });
  });

  gateway.register('candidate:apply_to_recipe', async (ctx) => {
    const service = container.get('candidateService');
    return service.applyToRecipe(ctx.data.candidateId, ctx.data.recipeId, {
      userId: ctx.actor,
    });
  });

  gateway.register('candidate:list', async (ctx) => {
    const service = container.get('candidateService');
    return service.listCandidates(ctx.data.filters, ctx.data.pagination);
  });

  gateway.register('candidate:search', async (ctx) => {
    const service = container.get('candidateService');
    return service.searchCandidates(ctx.data.keyword, ctx.data.pagination);
  });

  gateway.register('candidate:get_stats', async (ctx) => {
    const service = container.get('candidateService');
    return service.getCandidateStats();
  });

  gateway.register('candidate:get', async (ctx) => {
    const repo = container.get('candidateRepository');
    return repo.findById(ctx.data.id);
  });

  gateway.register('candidate:delete', async (ctx) => {
    const repo = container.get('candidateRepository');
    return repo.delete(ctx.data.candidateId);
  });

  // ========== Recipe Actions ==========

  gateway.register('recipe:create', async (ctx) => {
    const service = container.get('recipeService');
    return service.createRecipe(ctx.data, {
      userId: ctx.actor,
      ip: ctx.data._ip,
      userAgent: ctx.data._userAgent,
    });
  });

  gateway.register('recipe:publish', async (ctx) => {
    const service = container.get('recipeService');
    return service.publishRecipe(ctx.data.recipeId, {
      userId: ctx.actor,
    });
  });

  gateway.register('recipe:deprecate', async (ctx) => {
    const service = container.get('recipeService');
    return service.deprecateRecipe(ctx.data.recipeId, ctx.data.reason, {
      userId: ctx.actor,
    });
  });

  gateway.register('recipe:update_quality', async (ctx) => {
    const service = container.get('recipeService');
    return service.updateQuality(ctx.data.recipeId, ctx.data.metrics, {
      userId: ctx.actor,
    });
  });

  gateway.register('recipe:adopt', async (ctx) => {
    const service = container.get('recipeService');
    return service.incrementAdoption(ctx.data.recipeId);
  });

  gateway.register('recipe:apply', async (ctx) => {
    const service = container.get('recipeService');
    return service.incrementApplication(ctx.data.recipeId);
  });

  gateway.register('recipe:list', async (ctx) => {
    const service = container.get('recipeService');
    return service.listRecipes(ctx.data.filters, ctx.data.pagination);
  });

  gateway.register('recipe:search', async (ctx) => {
    const service = container.get('recipeService');
    return service.searchRecipes(ctx.data.keyword, ctx.data.pagination);
  });

  gateway.register('recipe:get_stats', async (ctx) => {
    const service = container.get('recipeService');
    return service.getRecipeStats();
  });

  gateway.register('recipe:get', async (ctx) => {
    const repo = container.get('recipeRepository');
    return repo.findById(ctx.data.id);
  });

  gateway.register('recipe:get_recommendations', async (ctx) => {
    const service = container.get('recipeService');
    return service.getRecommendations(ctx.data.limit);
  });

  gateway.register('recipe:delete', async (ctx) => {
    const service = container.get('recipeService');
    return service.deleteRecipe(ctx.data.recipeId, {
      userId: ctx.actor,
    });
  });

  // ========== Guard Rule Actions ==========

  gateway.register('guard_rule:create', async (ctx) => {
    const service = container.get('guardService');
    return service.createRule(ctx.data, {
      userId: ctx.actor,
      ip: ctx.data._ip,
      userAgent: ctx.data._userAgent,
    });
  });

  gateway.register('guard_rule:enable', async (ctx) => {
    const service = container.get('guardService');
    return service.enableRule(ctx.data.ruleId, {
      userId: ctx.actor,
    });
  });

  gateway.register('guard_rule:disable', async (ctx) => {
    const service = container.get('guardService');
    return service.disableRule(ctx.data.ruleId, ctx.data.reason, {
      userId: ctx.actor,
    });
  });

  gateway.register('guard_rule:check_code', async (ctx) => {
    const service = container.get('guardService');
    return service.checkCode(ctx.data.code, ctx.data.options);
  });

  gateway.register('guard_rule:import_from_recipe', async (ctx) => {
    // importRulesFromRecipe 已废弃，使用 createRule 代替
    const service = container.get('guardService');
    return service.createRule(ctx.data, { userId: ctx.actor });
  });

  gateway.register('guard_rule:list', async (ctx) => {
    const service = container.get('guardService');
    return service.listRules(ctx.data.filters, ctx.data.pagination);
  });

  gateway.register('guard_rule:search', async (ctx) => {
    const service = container.get('guardService');
    return service.searchRules(ctx.data.keyword, ctx.data.pagination);
  });

  gateway.register('guard_rule:get_stats', async (ctx) => {
    const service = container.get('guardService');
    return service.getRuleStats();
  });

  gateway.register('guard_rule:get', async (ctx) => {
    const repo = container.get('recipeRepository');
    return repo.findById(ctx.data.id);
  });

  // ========== Search Actions ==========

  gateway.register('search:query', async (ctx) => {
    const service = container.get('searchService');
    return service.search(ctx.data.keyword, ctx.data.options);
  });

  logger.info('Gateway: All actions registered', {
    actionCount: gateway.getRegisteredActions().length,
  });
}

/**
 * 辅助函数: 创建 Gateway 请求对象
 * 用于路由层格式化请求
 */
export function buildGatewayRequest(req, action, resource, data = {}) {
  return {
    actor: req.headers['x-user-id'] || 'anonymous',
    action,
    resource,
    data: {
      ...data,
      _ip: req.ip,
      _userAgent: req.headers['user-agent'] || '',
    },
    session: req.headers['x-session-id'],
  };
}
