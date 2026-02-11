import { Recipe, RecipeStatus, KnowledgeType, Complexity, Kind, inferKind } from '../../domain/index.js';
import Logger from '../../infrastructure/logging/Logger.js';
import { ValidationError, ConflictError, NotFoundError } from '../../shared/errors/index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * RecipeService
 * 管理代码模式和最佳实践的发布与生命周期
 * 包括创建、发布、质量管理和推荐等业务逻辑
 *
 * V2 唯一数据源策略：
 *   DB 写入成功后自动落盘到 AutoSnippet/recipes/{category}/ 目录
 *   .md 文件 = Source of Truth，DB = 索引缓存
 */
export class RecipeService {
  /**
   * @param {object} recipeRepository
   * @param {object} auditLogger
   * @param {object} gateway
   * @param {object} knowledgeGraphService
   * @param {object} [options]
   * @param {import('./RecipeFileWriter.js').RecipeFileWriter} [options.fileWriter]
   */
  constructor(recipeRepository, auditLogger, gateway, knowledgeGraphService, options = {}) {
    this.recipeRepository = recipeRepository;
    this.auditLogger = auditLogger;
    this.gateway = gateway;
    this._knowledgeGraphService = knowledgeGraphService || null;
    this._fileWriter = options.fileWriter || null;
    this.logger = Logger.getInstance();
  }

  /**
   * 创建新 Recipe（草稿状态）
   */
  async createRecipe(data, context) {
    try {
      this._validateCreateInput(data);

      const recipe = new Recipe({
        id: uuidv4(),
        title: data.title,
        description: data.description || '',
        language: data.language,
        category: data.category,
        summaryCn: data.summaryCn || '',
        summaryEn: data.summaryEn || '',
        usageGuideCn: data.usageGuideCn || '',
        usageGuideEn: data.usageGuideEn || '',
        knowledgeType: data.knowledgeType || KnowledgeType.CODE_PATTERN,
        kind: data.kind || inferKind(data.knowledgeType || KnowledgeType.CODE_PATTERN),
        complexity: data.complexity || Complexity.INTERMEDIATE,
        scope: data.scope || null,
        content: data.content || {
          pattern: data.pattern || '',
          rationale: data.rationale || '',
          steps: data.steps || [],
          codeChanges: data.codeChanges || [],
          verification: data.verification || null,
          markdown: data.markdown || '',
        },
        relations: data.relations || {},
        constraints: data.constraints || {},
        dimensions: data.dimensions || {},
        trigger: data.trigger || '',
        tags: data.tags || [],
        quality: {
          codeCompleteness: 0,
          projectAdaptation: 0,
          documentationClarity: 0,
          overall: 0,
        },
        statistics: {
          adoptionCount: 0,
          applicationCount: 0,
          guardHitCount: 0,
          viewCount: 0,
          successCount: 0,
          feedbackScore: 0,
        },
        status: RecipeStatus.DRAFT,
        createdBy: context.userId,
        sourceCandidate: data.sourceCandidate || null,
      });

      if (!recipe.isValid()) {
        throw new ValidationError('Invalid recipe data');
      }

      const created = await this.recipeRepository.create(recipe);

      // 同步 relations → knowledge_edges
      this._syncRelationsToGraph(created.id, created.relations);

      // V2: 落盘到 AutoSnippet/recipes/{category}/ (.md = Source of Truth)
      this._persistToFile(created);

      await this.auditLogger.log({
        action: 'create_recipe',
        resourceType: 'recipe',
        resourceId: created.id,
        actor: context.userId,
        details: `Created recipe: ${created.title}`,
        timestamp: Math.floor(Date.now() / 1000),
      });

      this.logger.info('Recipe created', {
        recipeId: created.id,
        createdBy: context.userId,
        title: created.title,
      });

      return created;
    } catch (error) {
      this.logger.error('Error creating recipe', {
        error: error.message,
        data,
      });
      throw error;
    }
  }

  /**
   * 发布 Recipe（从 DRAFT 变为 ACTIVE）
   */
  async publishRecipe(recipeId, context) {
    try {
      const recipe = await this.recipeRepository.findById(recipeId);

      if (!recipe) {
        throw new NotFoundError('Recipe not found', 'recipe', recipeId);
      }

      if (recipe.status !== RecipeStatus.DRAFT) {
        throw new ConflictError(
          `Cannot publish recipe in ${recipe.status} status`,
          `Must be in DRAFT status to publish`
        );
      }

      const publishResult = recipe.publish(context.userId);
      if (!publishResult.success) {
        throw new ValidationError(publishResult.error || 'Cannot publish recipe');
      }

      const updated = await this.recipeRepository.update(recipeId, {
        status: recipe.status,
        published_by: recipe.publishedBy,
        published_at: recipe.publishedAt,
      });

      // V2: 发布后落盘/更新 .md 文件（status → active）
      this._persistToFile(updated);

      await this.auditLogger.log({
        action: 'publish_recipe',
        resourceType: 'recipe',
        resourceId: recipeId,
        actor: context.userId,
        details: `Published recipe: ${recipe.title}`,
        timestamp: Math.floor(Date.now() / 1000),
      });

      this.logger.info('Recipe published', {
        recipeId,
        publishedBy: context.userId,
      });

      return updated;
    } catch (error) {
      this.logger.error('Error publishing recipe', {
        recipeId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 废弃 Recipe（从 ACTIVE 变为 DEPRECATED）
   */
  async deprecateRecipe(recipeId, reason, context) {
    try {
      const recipe = await this.recipeRepository.findById(recipeId);

      if (!recipe) {
        throw new NotFoundError('Recipe not found', 'recipe', recipeId);
      }

      if (recipe.status !== RecipeStatus.ACTIVE) {
        throw new ConflictError(
          `Cannot deprecate recipe in ${recipe.status} status`,
          `Must be in ACTIVE status to deprecate`
        );
      }

      if (!reason || reason.trim().length === 0) {
        throw new ValidationError('Deprecation reason is required');
      }

      recipe.deprecate(reason);

      const updated = await this.recipeRepository.update(recipeId, {
        status: recipe.status,
        deprecation_reason: recipe.deprecation?.reason,
        deprecated_at: recipe.deprecation?.deprecatedAt,
      });

      // V2: 废弃时更新 .md 文件的 status（不删除，保留 Git 历史）
      this._persistToFile(updated);

      await this.auditLogger.log({
        action: 'deprecate_recipe',
        resourceType: 'recipe',
        resourceId: recipeId,
        actor: context.userId,
        details: `Deprecated recipe: ${reason}`,
        timestamp: Math.floor(Date.now() / 1000),
      });

      this.logger.info('Recipe deprecated', {
        recipeId,
        deprecatedBy: context.userId,
        reason,
      });

      return updated;
    } catch (error) {
      this.logger.error('Error deprecating recipe', {
        recipeId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 更新质量指标
   */
  async updateQuality(recipeId, metrics, context) {
    try {
      const recipe = await this.recipeRepository.findById(recipeId);

      if (!recipe) {
        throw new NotFoundError('Recipe not found', 'recipe', recipeId);
      }

      // 验证指标
      if (
        typeof metrics.codeCompleteness === 'number' &&
        (metrics.codeCompleteness < 0 || metrics.codeCompleteness > 1)
      ) {
        throw new ValidationError('Code completeness must be between 0 and 1');
      }

      if (
        typeof metrics.projectAdaptation === 'number' &&
        (metrics.projectAdaptation < 0 || metrics.projectAdaptation > 1)
      ) {
        throw new ValidationError('Project adaptation must be between 0 and 1');
      }

      if (
        typeof metrics.documentationClarity === 'number' &&
        (metrics.documentationClarity < 0 || metrics.documentationClarity > 1)
      ) {
        throw new ValidationError('Documentation clarity must be between 0 and 1');
      }

      recipe.updateQuality(metrics);

      const updated = await this.recipeRepository.update(recipeId, {
        quality_code_completeness: recipe.quality.codeCompleteness,
        quality_project_adaptation: recipe.quality.projectAdaptation,
        quality_documentation_clarity: recipe.quality.documentationClarity,
        quality_overall: recipe.quality.overall,
      });

      await this.auditLogger.log({
        action: 'update_recipe_quality',
        resourceType: 'recipe',
        resourceId: recipeId,
        actor: context.userId,
        details: `Updated quality scores: overall=${recipe.quality.overall}`,
        timestamp: Math.floor(Date.now() / 1000),
      });

      this.logger.info('Recipe quality updated', {
        recipeId,
        qualityOverall: recipe.quality.overall,
      });

      return updated;
    } catch (error) {
      this.logger.error('Error updating recipe quality', {
        recipeId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 通用使用计数递增（含审计日志）
   * @param {string} recipeId
   * @param {'adoption'|'application'} type
   * @param {{ feedback?: string, actor?: string }} options
   */
  async incrementUsage(recipeId, type = 'adoption', options = {}) {
    try {
      const recipe = await this.recipeRepository.findById(recipeId);

      if (!recipe) {
        throw new NotFoundError('Recipe not found', 'recipe', recipeId);
      }

      recipe.incrementUsage(type);

      const column = type === 'application' ? 'application_count' : 'adoption_count';
      const count = type === 'application'
        ? recipe.statistics.applicationCount
        : recipe.statistics.adoptionCount;

      const updated = await this.recipeRepository.update(recipeId, {
        [column]: count,
      });

      // 审计日志
      await this.auditLogger.log({
        action: type === 'application' ? 'apply_recipe' : 'adopt_recipe',
        resourceType: 'recipe',
        resourceId: recipeId,
        actor: options.actor || 'user',
        details: `Recipe ${type}: ${recipe.title}${options.feedback ? ` | feedback: ${options.feedback}` : ''}`,
        timestamp: Math.floor(Date.now() / 1000),
      });

      this.logger.debug(`Recipe ${type} incremented`, {
        recipeId,
        [column]: count,
      });

      return updated;
    } catch (error) {
      this.logger.error(`Error incrementing recipe ${type}`, {
        recipeId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 记录采用（向后兼容）
   */
  async incrementAdoption(recipeId) {
    return this.incrementUsage(recipeId, 'adoption');
  }

  /**
   * 记录应用（向后兼容）
   */
  async incrementApplication(recipeId) {
    return this.incrementUsage(recipeId, 'application');
  }

  /**
   * 通用更新 Recipe（仅允许更新白名单字段）
   */
  async updateRecipe(recipeId, data, context) {
    try {
      const recipe = await this.recipeRepository.findById(recipeId);

      if (!recipe) {
        throw new NotFoundError('Recipe not found', 'recipe', recipeId);
      }

      // 白名单字段
      const UPDATABLE = [
        'title', 'description', 'language', 'category', 'trigger',
        'summaryCn', 'summaryEn', 'usageGuideCn', 'usageGuideEn',
        'knowledgeType', 'complexity', 'scope',
        'content', 'relations', 'constraints',
        'dimensions', 'tags',
      ];

      // 构建 DB 列更新映射
      const dbUpdates = {};

      for (const key of UPDATABLE) {
        if (data[key] === undefined) continue;

        switch (key) {
          case 'title':
          case 'description':
          case 'language':
          case 'category':
          case 'trigger':
          case 'scope':
            dbUpdates[key] = data[key];
            // 同步实体属性以便 kind 推导
            recipe[key] = data[key];
            break;

          case 'summaryCn':
            dbUpdates.summary_cn = data.summaryCn;
            recipe.summaryCn = data.summaryCn;
            break;
          case 'summaryEn':
            dbUpdates.summary_en = data.summaryEn;
            recipe.summaryEn = data.summaryEn;
            break;
          case 'usageGuideCn':
            dbUpdates.usage_guide_cn = data.usageGuideCn;
            recipe.usageGuideCn = data.usageGuideCn;
            break;
          case 'usageGuideEn':
            dbUpdates.usage_guide_en = data.usageGuideEn;
            recipe.usageGuideEn = data.usageGuideEn;
            break;

          case 'knowledgeType':
            dbUpdates.knowledge_type = data.knowledgeType;
            recipe.knowledgeType = data.knowledgeType;
            // 联动更新 kind
            dbUpdates.kind = inferKind(data.knowledgeType);
            recipe.kind = dbUpdates.kind;
            break;

          case 'complexity':
            dbUpdates.complexity = data.complexity;
            recipe.complexity = data.complexity;
            break;

          case 'content':
            // 深合并: 保留已有字段，覆盖传入字段
            recipe.content = { ...recipe.content, ...data.content };
            dbUpdates.content_json = JSON.stringify(recipe.content);
            break;

          case 'relations':
            recipe.relations = { ...recipe.relations, ...data.relations };
            dbUpdates.relations_json = JSON.stringify(recipe.relations);
            break;

          case 'constraints':
            recipe.constraints = { ...recipe.constraints, ...data.constraints };
            dbUpdates.constraints_json = JSON.stringify(recipe.constraints);
            break;

          case 'dimensions':
            recipe.dimensions = { ...recipe.dimensions, ...data.dimensions };
            dbUpdates.dimensions_json = JSON.stringify(recipe.dimensions);
            break;

          case 'tags':
            recipe.tags = data.tags;
            dbUpdates.tags_json = JSON.stringify(data.tags);
            break;
        }
      }

      if (Object.keys(dbUpdates).length === 0) {
        throw new ValidationError('No updatable fields provided');
      }

      const updated = await this.recipeRepository.update(recipeId, dbUpdates);

      // 若 relations 发生变更，同步到 knowledge_edges
      if (dbUpdates.relations_json) {
        this._syncRelationsToGraph(recipeId, recipe.relations);
      }

      // V2: 更新后同步落盘
      this._persistToFile(updated);

      await this.auditLogger.log({
        action: 'update_recipe',
        resourceType: 'recipe',
        resourceId: recipeId,
        actor: context.userId,
        details: `Updated recipe fields: ${Object.keys(dbUpdates).join(', ')}`,
        timestamp: Math.floor(Date.now() / 1000),
      });

      this.logger.info('Recipe updated', {
        recipeId,
        updatedBy: context.userId,
        fields: Object.keys(dbUpdates),
      });

      return updated;
    } catch (error) {
      this.logger.error('Error updating recipe', {
        recipeId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 删除 Recipe
   */
  async deleteRecipe(recipeId, context) {
    try {
      const recipe = await this.recipeRepository.findById(recipeId);

      if (!recipe) {
        throw new NotFoundError('Recipe not found', 'recipe', recipeId);
      }

      // V2: 删除 .md 文件
      this._removeFile(recipe);

      // 清除 knowledge_edges 中所有关联边
      this._removeAllEdges(recipeId);

      const deleted = await this.recipeRepository.delete(recipeId);

      await this.auditLogger.log({
        action: 'delete_recipe',
        resourceType: 'recipe',
        resourceId: recipeId,
        actor: context.userId,
        details: `Deleted recipe: ${recipe.title}`,
        timestamp: Math.floor(Date.now() / 1000),
      });

      this.logger.info('Recipe deleted', {
        recipeId,
        deletedBy: context.userId,
        title: recipe.title,
      });

      return { success: true, id: recipeId };
    } catch (error) {
      this.logger.error('Error deleting recipe', {
        recipeId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 按 Kind 查询 Recipe 列表
   */
  async listByKind(kind, pagination = {}) {
    try {
      const { page = 1, pageSize = 20 } = pagination;
      return this.recipeRepository.findByKind(kind, { page, pageSize });
    } catch (error) {
      this.logger.error('Error listing recipes by kind', {
        kind,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 查询 Recipe 列表（支持多条件组合过滤）
   */
  async listRecipes(filters = {}, pagination = {}) {
    try {
      const { status, language, category, knowledgeType, kind, scope, tag } = filters;
      const { page = 1, pageSize = 20 } = pagination;

      // 构建组合过滤条件（DB 列名 → 值）
      const dbFilters = {};
      if (status)        dbFilters.status = status;
      if (language)      dbFilters.language = language;
      if (category)      dbFilters.category = category;
      if (knowledgeType) dbFilters.knowledge_type = knowledgeType;
      if (kind)          dbFilters.kind = kind;
      if (scope)         dbFilters.scope = scope;

      // tag 过滤通过 tags_json LIKE 实现
      if (tag) dbFilters._tagLike = tag;

      return this.recipeRepository.findWithPagination(dbFilters, { page, pageSize });
    } catch (error) {
      this.logger.error('Error listing recipes', {
        error: error.message,
        filters,
      });
      throw error;
    }
  }

  /**
   * 搜索 Recipe
   */
  async searchRecipes(keyword, pagination = {}) {
    try {
      const { page = 1, pageSize = 20 } = pagination;
      return this.recipeRepository.search(keyword, { page, pageSize });
    } catch (error) {
      this.logger.error('Error searching recipes', {
        keyword,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 获取推荐 Recipe
   */
  async getRecommendations(limit = 10) {
    try {
      return this.recipeRepository.getRecommendations(limit);
    } catch (error) {
      this.logger.error('Error getting recommendations', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 获取单个 Recipe
   */
  async getRecipe(recipeId) {
    try {
      const recipe = await this.recipeRepository.findById(recipeId);
      if (!recipe) {
        throw new NotFoundError('Recipe not found', 'recipe', recipeId);
      }
      return recipe;
    } catch (error) {
      this.logger.error('Error getting recipe', {
        recipeId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 获取 Recipe 统计
   */
  async getRecipeStats() {
    try {
      return this.recipeRepository.getStats();
    } catch (error) {
      this.logger.error('Error getting recipe stats', {
        error: error.message,
      });
      throw error;
    }
  }

  // ─── Knowledge Graph 同步 ─────────────────────────────────────

  /**
   * 将 Recipe 的 relations 同步到 knowledge_edges 表
   * 策略：先删旧边，再批量写入新边（保证幂等）
   */
  _syncRelationsToGraph(recipeId, relations) {
    const gs = this._knowledgeGraphService;
    if (!gs) return;

    try {
      // 1. 删除当前 Recipe 的所有出边
      gs.db.prepare(
        `DELETE FROM knowledge_edges WHERE from_id = ? AND from_type = 'recipe'`
      ).run(recipeId);

      // 2. 写入新边
      if (!relations || typeof relations !== 'object') return;

      for (const [relType, targets] of Object.entries(relations)) {
        if (!Array.isArray(targets)) continue;
        for (const t of targets) {
          const targetId = t.target || t.id || (typeof t === 'string' ? t : null);
          if (targetId) {
            gs.addEdge(recipeId, 'recipe', targetId, 'recipe', relType, {
              weight: t.weight || 1.0,
            });
          }
        }
      }
    } catch (err) {
      // 同步失败不应阻断主流程（表可能不存在）
      this.logger.warn('Failed to sync relations to knowledge_edges', {
        recipeId, error: err.message,
      });
    }
  }

  /**
   * 删除 Recipe 关联的所有 knowledge_edges（出边 + 入边）
   */
  _removeAllEdges(recipeId) {
    const gs = this._knowledgeGraphService;
    if (!gs) return;

    try {
      gs.db.prepare(
        `DELETE FROM knowledge_edges WHERE from_id = ? OR to_id = ?`
      ).run(recipeId, recipeId);
    } catch (err) {
      this.logger.warn('Failed to remove edges from knowledge_edges', {
        recipeId, error: err.message,
      });
    }
  }

  /**
   * 验证创建输入
   */
  _validateCreateInput(data) {
    if (!data.title || data.title.trim().length === 0) {
      throw new ValidationError('Title is required');
    }

    if (!data.language || data.language.trim().length === 0) {
      throw new ValidationError('Language is required');
    }

    if (!data.category || data.category.trim().length === 0) {
      throw new ValidationError('Category is required');
    }

    // 内容至少需要 pattern 或 rationale 或 steps 或 markdown
    const c = data.content || {};
    if (!c.pattern && !c.rationale && !(c.steps?.length > 0) && !c.markdown && !data.pattern) {
      throw new ValidationError('Content is required (pattern, rationale, steps, or markdown)');
    }
  }

  /* ═══ V2 文件落盘 ═══════════════════════════════════════ */

  /**
   * 将 Recipe 落盘到 AutoSnippet/recipes/{category}/ 目录
   * 落盘后回写 source_file 到 DB（保证源文件路径可追溯）
   * 失败不阻断主流程（DB 写入已成功）
   */
  _persistToFile(recipe) {
    if (!this._fileWriter) return;
    try {
      const oldSourceFile = recipe.sourceFile;
      this._fileWriter.persistRecipe(recipe);
      // 回写 source_file 到 DB（新建或路径变更时）
      if (recipe.sourceFile && recipe.sourceFile !== oldSourceFile) {
        this.recipeRepository.update(recipe.id, { source_file: recipe.sourceFile }).catch(err => {
          this.logger.warn('Failed to update source_file in DB', {
            recipeId: recipe.id, error: err.message,
          });
        });
      }
    } catch (err) {
      this.logger.warn('Recipe file persist failed (non-blocking)', {
        recipeId: recipe?.id,
        error: err.message,
      });
    }
  }

  /**
   * 删除 Recipe 对应的 .md 文件
   */
  _removeFile(recipe) {
    if (!this._fileWriter) return;
    try {
      this._fileWriter.removeRecipe(recipe);
    } catch (err) {
      this.logger.warn('Recipe file remove failed (non-blocking)', {
        recipeId: recipe?.id,
        error: err.message,
      });
    }
  }
}

export default RecipeService;
