import { Recipe, RecipeStatus, KnowledgeType } from '../../domain/index.js';
import Logger from '../../infrastructure/logging/Logger.js';
import { ValidationError, ConflictError, NotFoundError } from '../../shared/errors/index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * GuardService
 * 管理 Guard 约束规则的生命周期（现在统一存储在 Recipe 实体中）
 * Guard 规则 = knowledgeType: 'boundary-constraint' 的 Recipe，
 * 具体 pattern 存在 constraints.guards[] 里
 */
export class GuardService {
  constructor(recipeRepository, auditLogger, gateway) {
    this.recipeRepository = recipeRepository;
    this.auditLogger = auditLogger;
    this.gateway = gateway;
    this.logger = Logger.getInstance();
  }

  /**
   * 创建新规则 → 创建一个 knowledgeType=boundary-constraint 的 Recipe
   */
  async createRule(data, context) {
    try {
      this._validateCreateInput(data);

      const recipe = new Recipe({
        id: uuidv4(),
        title: data.name,
        description: data.description,
        language: (data.languages || [])[0] || '',
        category: data.category || 'guard',
        knowledgeType: KnowledgeType.BOUNDARY_CONSTRAINT,
        content: {
          pattern: data.pattern || '',
          rationale: data.note || data.sourceReason || '',
        },
        constraints: {
          boundaries: [],
          preconditions: [],
          sideEffects: [],
          guards: [{
            pattern: data.pattern,
            severity: data.severity || 'warning',
            message: data.description || '',
          }],
        },
        tags: data.languages || [],
        status: RecipeStatus.ACTIVE,
        createdBy: context.userId,
      });

      const created = await this.recipeRepository.create(recipe);

      await this.auditLogger.log({
        action: 'create_guard_rule',
        resourceType: 'recipe',
        resourceId: created.id,
        actor: context.userId,
        details: `Created guard recipe: ${data.name}`,
        timestamp: Math.floor(Date.now() / 1000),
      });

      return created;
    } catch (error) {
      this.logger.error('Error creating guard rule', { error: error.message, data });
      throw error;
    }
  }

  /**
   * 启用规则（将 Recipe 状态设为 ACTIVE）
   */
  async enableRule(ruleId, context) {
    try {
      const recipe = await this.recipeRepository.findById(ruleId);
      if (!recipe) throw new NotFoundError('Guard recipe not found', 'recipe', ruleId);
      if (recipe.status === RecipeStatus.ACTIVE) {
        throw new ConflictError('Rule is already enabled', 'Cannot enable an already enabled rule');
      }

      await this.recipeRepository.update(ruleId, { status: RecipeStatus.ACTIVE });

      await this.auditLogger.log({
        action: 'enable_guard_rule',
        resourceType: 'recipe',
        resourceId: ruleId,
        actor: context.userId,
        details: `Enabled guard recipe: ${recipe.title}`,
        timestamp: Math.floor(Date.now() / 1000),
      });

      return this.recipeRepository.findById(ruleId);
    } catch (error) {
      this.logger.error('Error enabling guard rule', { ruleId, error: error.message });
      throw error;
    }
  }

  /**
   * 禁用规则（将 Recipe 状态设为 DEPRECATED）
   */
  async disableRule(ruleId, reason, context) {
    try {
      const recipe = await this.recipeRepository.findById(ruleId);
      if (!recipe) throw new NotFoundError('Guard recipe not found', 'recipe', ruleId);
      if (recipe.status === RecipeStatus.DEPRECATED) {
        throw new ConflictError('Rule is already disabled', 'Cannot disable an already disabled rule');
      }

      if (!reason || reason.trim().length === 0) {
        throw new ValidationError('Disable reason is required');
      }

      await this.recipeRepository.update(ruleId, {
        status: RecipeStatus.DEPRECATED,
        deprecation_reason: reason,
        deprecated_at: Math.floor(Date.now() / 1000),
      });

      await this.auditLogger.log({
        action: 'disable_guard_rule',
        resourceType: 'recipe',
        resourceId: ruleId,
        actor: context.userId,
        details: `Disabled guard recipe: ${reason}`,
        timestamp: Math.floor(Date.now() / 1000),
      });

      return this.recipeRepository.findById(ruleId);
    } catch (error) {
      this.logger.error('Error disabling guard rule', { ruleId, error: error.message });
      throw error;
    }
  }

  /**
   * 检查代码是否匹配 Guard 规则
   */
  async checkCode(code, options = {}) {
    try {
      if (!code || code.trim().length === 0) {
        throw new ValidationError('Code is required');
      }

      const { language = null } = options;

      // 获取所有包含 guards 的 active Recipe
      const guardRecipes = await this.recipeRepository.findWithGuards(language);

      const matches = [];
      for (const recipe of guardRecipes) {
        for (const guard of (recipe.constraints?.guards || [])) {
          try {
            const regex = new RegExp(guard.pattern, 'gm');
            const codeMatches = [...code.matchAll(regex)];
            if (codeMatches.length > 0) {
              matches.push({
                ruleId: recipe.id,
                ruleName: recipe.title,
                severity: guard.severity || 'warning',
                message: guard.message || '',
                matches: codeMatches.map(m => ({
                  match: m[0],
                  index: m.index,
                  line: code.substring(0, m.index).split('\\n').length,
                })),
                matchCount: codeMatches.length,
              });
            }
          } catch (e) {
            this.logger.warn('Error matching guard pattern', { recipeId: recipe.id, error: e.message });
          }
        }
      }

      return matches;
    } catch (error) {
      this.logger.error('Error checking code against rules', { error: error.message });
      throw error;
    }
  }

  /**
   * 查询规则列表（boundary-constraint Recipes）
   */
  async listRules(filters = {}, pagination = {}) {
    try {
      const { page = 1, pageSize = 20 } = pagination;
      return this.recipeRepository.findByKnowledgeType(
        KnowledgeType.BOUNDARY_CONSTRAINT, { page, pageSize }
      );
    } catch (error) {
      this.logger.error('Error listing rules', { error: error.message, filters });
      throw error;
    }
  }

  /**
   * 搜索规则
   */
  async searchRules(keyword, pagination = {}) {
    try {
      const { page = 1, pageSize = 20 } = pagination;
      // 搜索所有 Recipes 然后过滤 boundary-constraint
      const result = await this.recipeRepository.search(keyword, { page, pageSize });
      result.data = (result.data || []).filter(
        r => r.knowledgeType === KnowledgeType.BOUNDARY_CONSTRAINT
      );
      result.total = result.data.length;
      return result;
    } catch (error) {
      this.logger.error('Error searching rules', { keyword, error: error.message });
      throw error;
    }
  }

  /**
   * 获取规则统计
   */
  async getRuleStats() {
    try {
      // 基于 recipes 表的 boundary-constraint 统计
      return this.recipeRepository.getStats();
    } catch (error) {
      this.logger.error('Error getting rule stats', { error: error.message });
      throw error;
    }
  }

  /**
   * 验证创建输入
   */
  _validateCreateInput(data) {
    if (!data.name || data.name.trim().length === 0) {
      throw new ValidationError('Rule name is required');
    }
    if (!data.description || data.description.trim().length === 0) {
      throw new ValidationError('Rule description is required');
    }
    if (!data.pattern || data.pattern.trim().length === 0) {
      throw new ValidationError('Pattern is required');
    }
  }
}

export default GuardService;
