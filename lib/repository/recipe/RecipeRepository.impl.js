import { BaseRepository } from '../base/BaseRepository.js';
import { Recipe, RecipeStatus, KnowledgeType, Complexity, Kind, inferKind } from '../../domain/index.js';
import Logger from '../../infrastructure/logging/Logger.js';

/**
 * RecipeRepository 实现 — 统一知识实体
 * 面向 SQLite 数据库的 Recipe 持久化，支持 content_json / relations_json / constraints_json
 */
export class RecipeRepositoryImpl extends BaseRepository {
  constructor(database) {
    super(database, 'recipes');
    this.logger = Logger.getInstance();
  }

  /**
   * 覆写分页查询 — 支持 _tagLike 特殊过滤
   */
  async findWithPagination(filters = {}, options = {}) {
    // 如果无特殊 filter，走 BaseRepository
    if (!filters._tagLike) {
      return super.findWithPagination(filters, options);
    }

    const { _tagLike, ...normalFilters } = filters;
    const { page = 1, pageSize = 20 } = options;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    const params = [];

    for (const [key, value] of Object.entries(normalFilters)) {
      this._assertSafeColumn(key);
      conditions.push(`${key} = ?`);
      params.push(value);
    }

    // tag filter: JSON array 中包含标签名
    conditions.push(`tags_json LIKE ?`);
    const escaped = _tagLike.replace(/[%_\\]/g, ch => `\\${ch}`);
    params.push(`%"${escaped}"%`);

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    const total = this.db.prepare(`SELECT COUNT(*) as count FROM recipes${where}`).get(...params).count;
    const data = this.db.prepare(`SELECT * FROM recipes${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset);

    return {
      data: data.map(row => this._mapRowToEntity(row)),
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    };
  }

  /**
   * 创建 Recipe
   */
  async create(recipe) {
    if (!recipe || !recipe.isValid()) {
      throw new Error('Invalid recipe entity');
    }

    try {
      const row = this._mapEntityToRow(recipe);
      const keys = Object.keys(row);
      const placeholders = keys.map(() => '?').join(', ');
      const query = `
        INSERT INTO recipes (${keys.join(', ')})
        VALUES (${placeholders})
      `;

      const stmt = this.db.prepare(query);
      stmt.run(...Object.values(row));

      return this.findById(recipe.id);
    } catch (error) {
      this.logger.error('Error creating recipe', {
        recipeId: recipe.id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 根据状态查询
   */
  async findByStatus(status, { page = 1, pageSize = 20 } = {}) {
    if (!Object.values(RecipeStatus).includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    try {
      return this.findWithPagination({ status }, { page, pageSize });
    } catch (error) {
      this.logger.error('Error finding by status', {
        status,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 根据编程语言查询
   */
  async findByLanguage(language, { page = 1, pageSize = 20 } = {}) {
    try {
      return this.findWithPagination({ language }, { page, pageSize });
    } catch (error) {
      this.logger.error('Error finding by language', {
        language,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 根据分类查询
   */
  async findByCategory(category, { page = 1, pageSize = 20 } = {}) {
    try {
      return this.findWithPagination({ category }, { page, pageSize });
    } catch (error) {
      this.logger.error('Error finding by category', {
        category,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 根据知识类型查询
   */
  async findByKnowledgeType(knowledgeType, { page = 1, pageSize = 20 } = {}) {
    if (!Object.values(KnowledgeType).includes(knowledgeType)) {
      throw new Error(`Invalid knowledge type: ${knowledgeType}`);
    }

    try {
      return this.findWithPagination({ knowledge_type: knowledgeType }, { page, pageSize });
    } catch (error) {
      this.logger.error('Error finding by knowledge type', {
        knowledgeType,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 根据 Kind 查询（rule / pattern / fact）
   */
  async findByKind(kind, { page = 1, pageSize = 20, status } = {}) {
    if (!Object.values(Kind).includes(kind)) {
      throw new Error(`Invalid kind: ${kind}`);
    }
    try {
      const filters = { kind };
      if (status) filters.status = status;
      return this.findWithPagination(filters, { page, pageSize });
    } catch (error) {
      this.logger.error('Error finding by kind', { kind, error: error.message });
      throw error;
    }
  }

  /** 查询所有 Rules (kind='rule') */
  async findRules({ page = 1, pageSize = 50, status = 'active' } = {}) {
    return this.findByKind(Kind.RULE, { page, pageSize, status });
  }

  /** 查询所有 Patterns (kind='pattern') */
  async findPatterns({ page = 1, pageSize = 50, status = 'active' } = {}) {
    return this.findByKind(Kind.PATTERN, { page, pageSize, status });
  }

  /**
   * 搜索 Recipe（按标题、内容、约束）
   */
  async search(keyword, { page = 1, pageSize = 20 } = {}) {
    try {
      const offset = (page - 1) * pageSize;
      // 转义 LIKE 通配符 (% → \%, _ → \_) 防止特殊字符注入
      const escaped = keyword.replace(/[%_\\]/g, ch => `\\${ch}`);
      const like = `%${escaped}%`;

      const countStmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM recipes
        WHERE title LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' OR content_json LIKE ? ESCAPE '\\' OR constraints_json LIKE ? ESCAPE '\\'
          OR tags_json LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR trigger LIKE ? ESCAPE '\\'
      `);
      const total = countStmt.get(like, like, like, like, like, like, like).count;

      const stmt = this.db.prepare(`
        SELECT * FROM recipes
        WHERE title LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' OR content_json LIKE ? ESCAPE '\\' OR constraints_json LIKE ? ESCAPE '\\'
          OR tags_json LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR trigger LIKE ? ESCAPE '\\'
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `);
      const data = stmt.all(like, like, like, like, like, like, like, pageSize, offset);

      return {
        data: data.map((row) => this._mapRowToEntity(row)),
        pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
      };
    } catch (error) {
      this.logger.error('Error searching recipes', { keyword, error: error.message });
      throw error;
    }
  }

  /**
   * 按 scope 查询
   */
  async findByScope(scope, { page = 1, pageSize = 20 } = {}) {
    try {
      return this.findWithPagination({ scope }, { page, pageSize });
    } catch (error) {
      this.logger.error('Error finding by scope', { scope, error: error.message });
      throw error;
    }
  }

  /**
   * 查询与指定 Recipe 有关系的所有 Recipes
   * 基于 relations_json 中的 target 字段做正向查找 + 被引用的反向查找
   */
  async findRelated(recipeId) {
    try {
      // 正向: 当前 Recipe 的 relations_json 引用了哪些
      const self = await this.findById(recipeId);
      if (!self) return [];

      const targetIds = new Set();
      const rels = self.relations || {};
      for (const group of Object.values(rels)) {
        if (Array.isArray(group)) {
          for (const r of group) {
            if (r.target) targetIds.add(r.target);
          }
        }
      }

      // 反向: 哪些 Recipe 的 relations_json 引用了当前 recipeId
      const reverseStmt = this.db.prepare(
        `SELECT * FROM recipes WHERE relations_json LIKE ? AND id != ?`
      );
      const reverseRows = reverseStmt.all(`%${recipeId}%`, recipeId);
      for (const row of reverseRows) targetIds.add(row.id);

      if (targetIds.size === 0) return [];

      const ids = [...targetIds];
      const placeholders = ids.map(() => '?').join(', ');
      const stmt = this.db.prepare(`SELECT * FROM recipes WHERE id IN (${placeholders})`);
      return stmt.all(...ids).map(row => this._mapRowToEntity(row));
    } catch (error) {
      this.logger.error('Error finding related recipes', { recipeId, error: error.message });
      throw error;
    }
  }

  /**
   * 查询包含 Guard 约束的 Recipes（用于 Guard 引擎）
   * 筛选 constraints_json 中有 guards 数组且语言匹配的条目
   */
  async findWithGuards(language = null) {
    try {
      let query = `SELECT * FROM recipes WHERE kind = 'rule' AND status = ?`;
      const params = [RecipeStatus.ACTIVE];

      if (language) {
        query += ` AND language = ?`;
        params.push(language);
      }

      const stmt = this.db.prepare(query);
      const rows = stmt.all(...params);
      return rows
        .map(row => this._mapRowToEntity(row))
        .filter(r => r.constraints?.guards?.length > 0);
    } catch (error) {
      this.logger.error('Error finding recipes with guards', { language, error: error.message });
      throw error;
    }
  }

  /**
   * 获取推荐 Recipe（最高质量最高采用率）
   */
  async getRecommendations(limit = 10) {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM recipes
        WHERE status = ?
        ORDER BY (
          COALESCE(quality_overall, 0) * 0.5 +
          MIN(COALESCE(adoption_count, 0) * 1.0 / 100.0, 1.0) * 0.3 +
          MIN(COALESCE(application_count, 0) * 1.0 / 100.0, 1.0) * 0.2
        ) DESC
        LIMIT ?
      `);
      const rows = stmt.all(RecipeStatus.ACTIVE, limit);
      return rows.map((row) => this._mapRowToEntity(row));
    } catch (error) {
      this.logger.error('Error getting recommendations', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 获取统计信息
   */
  async getStats() {
    try {
      const stmt = this.db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status = 'deprecated' THEN 1 ELSE 0 END) as deprecated,
          SUM(CASE WHEN kind = 'rule' THEN 1 ELSE 0 END) as rules,
          SUM(CASE WHEN kind = 'pattern' THEN 1 ELSE 0 END) as patterns,
          SUM(CASE WHEN kind = 'fact' THEN 1 ELSE 0 END) as facts,
          AVG(quality_overall) as avg_quality,
          AVG(adoption_count) as avg_adoption,
          AVG(application_count) as avg_application
        FROM recipes
      `);      return stmt.get();
    } catch (error) {
      this.logger.error('Error getting recipe stats', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 映射 SQLite 行到 Recipe 实体（统一模型）
   */
  _mapRowToEntity(row) {
    if (!row) return null;

    // 解析新 JSON 列（migration 003+）
    const contentJson     = this._parseJson(row.content_json, {});
    const relationsJson   = this._parseJson(row.relations_json, {});
    const constraintsJson = this._parseJson(row.constraints_json, {});

    return new Recipe({
      id: row.id,
      title: row.title,
      description: row.description,
      language: row.language,
      category: row.category,
      summaryCn: row.summary_cn || '',
      summaryEn: row.summary_en || '',
      usageGuideCn: row.usage_guide_cn || '',
      usageGuideEn: row.usage_guide_en || '',

      kind: row.kind || inferKind(row.knowledge_type),
      knowledgeType: row.knowledge_type,
      complexity: row.complexity,
      scope: row.scope,

      // 内容
      content: {
        pattern:      contentJson.pattern      || '',
        rationale:    contentJson.rationale     || '',
        steps:        contentJson.steps         || [],
        codeChanges:  contentJson.codeChanges   || [],
        verification: contentJson.verification  || null,
        markdown:     contentJson.markdown      || '',
      },

      // 关系图
      relations: {
        inherits:   relationsJson.inherits   || [],
        implements: relationsJson.implements || [],
        calls:      relationsJson.calls      || [],
        dependsOn:  relationsJson.dependsOn  || [],
        dataFlow:   relationsJson.dataFlow   || [],
        conflicts:  relationsJson.conflicts  || [],
        extends:    relationsJson.extends    || [],
        related:    relationsJson.related    || [],
      },

      // 约束
      constraints: {
        boundaries:    constraintsJson.boundaries    || [],
        preconditions: constraintsJson.preconditions || [],
        sideEffects:   constraintsJson.sideEffects   || [],
        guards:        constraintsJson.guards        || [],
      },

      quality: {
        codeCompleteness: row.quality_code_completeness,
        projectAdaptation: row.quality_project_adaptation,
        documentationClarity: row.quality_documentation_clarity,
        overall: row.quality_overall,
      },

      trigger: row.trigger || '',
      dimensions: this._parseJson(row.dimensions_json, {}),
      tags: this._parseJson(row.tags_json, []),

      statistics: {
        adoptionCount:    row.adoption_count    || 0,
        applicationCount: row.application_count || 0,
        guardHitCount:    row.guard_hit_count   || 0,
        viewCount:        row.view_count        || 0,
        successCount:     row.success_count     || 0,
        feedbackScore:    row.feedback_score    || 0,
      },

      status: row.status,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      publishedBy: row.published_by,
      publishedAt: row.published_at,
      deprecation: row.deprecation_reason ? {
        reason: row.deprecation_reason,
        deprecatedAt: row.deprecated_at,
      } : null,
      sourceCandidate: row.source_candidate_id,
      sourceFile: row.source_file,
    });
  }

  /**
   * 映射 Recipe 实体到 SQLite 行（统一模型）
   */
  _mapEntityToRow(entity) {
    const now = Math.floor(Date.now() / 1000);

    return {
      id: entity.id,
      title: entity.title,
      description: entity.description || null,
      language: entity.language,
      category: entity.category,
      summary_cn: entity.summaryCn || null,
      summary_en: entity.summaryEn || null,
      usage_guide_cn: entity.usageGuideCn || null,
      usage_guide_en: entity.usageGuideEn || null,

      knowledge_type: entity.knowledgeType,
      kind: entity.kind || inferKind(entity.knowledgeType),
      complexity: entity.complexity,
      scope: entity.scope || null,
      source_file: entity.sourceFile || null,

      // 新 JSON 列
      content_json: JSON.stringify(entity.content || {}),
      relations_json: JSON.stringify(entity.relations || {}),
      constraints_json: JSON.stringify(entity.constraints || {}),

      quality_code_completeness: entity.quality.codeCompleteness,
      quality_project_adaptation: entity.quality.projectAdaptation,
      quality_documentation_clarity: entity.quality.documentationClarity,
      quality_overall: entity.quality.overall,

      trigger: entity.trigger || '',
      dimensions_json: JSON.stringify(entity.dimensions || {}),
      tags_json: JSON.stringify(entity.tags || []),

      adoption_count: entity.statistics.adoptionCount,
      application_count: entity.statistics.applicationCount,
      guard_hit_count: entity.statistics.guardHitCount,
      view_count: entity.statistics.viewCount || 0,
      success_count: entity.statistics.successCount || 0,
      feedback_score: entity.statistics.feedbackScore || 0,

      status: entity.status,
      created_by: entity.createdBy,
      created_at: entity.createdAt || now,
      updated_at: entity.updatedAt || now,
      published_by: entity.publishedBy,
      published_at: entity.publishedAt,
      deprecation_reason: entity.deprecation?.reason || null,
      deprecated_at: entity.deprecation?.deprecatedAt || null,
      source_candidate_id: entity.sourceCandidate,
    };
  }

  /** @private 安全解析 JSON */
  _parseJson(value, fallback) {
    if (!value || value === 'null') return fallback;
    try { return JSON.parse(value); } catch { return fallback; }
  }
}

export default RecipeRepositoryImpl;
