/**
 * RecipeRepository - Recipe 统一知识实体仓储接口
 *
 * Recipe 是唯一的知识实体，通过 knowledgeType 区分 12 种知识维度。
 * 实现层负责映射 content_json / relations_json / constraints_json 等 JSON 列。
 */
export class RecipeRepository {
  /** 创建 Recipe */
  async create(recipe) { throw new Error('Not implemented'); }

  /** 根据 ID 获取 */
  async findById(id) { throw new Error('Not implemented'); }

  /** 获取所有 Recipes（支持过滤） */
  async findAll(filters = {}) { throw new Error('Not implemented'); }

  /** 按状态查询 */
  async findByStatus(status) { throw new Error('Not implemented'); }

  /** 按语言查询 */
  async findByLanguage(language) { throw new Error('Not implemented'); }

  /** 按分类查询 */
  async findByCategory(category) { throw new Error('Not implemented'); }

  /** 按知识类型查询 */
  async findByKnowledgeType(knowledgeType) { throw new Error('Not implemented'); }

  /** 按 scope 查询 (universal | project | target-specific) */
  async findByScope(scope) { throw new Error('Not implemented'); }

  /** 搜索 Recipes（关键词匹配 title / content / constraints） */
  async search(keyword) { throw new Error('Not implemented'); }

  /** 更新 Recipe */
  async update(id, updates) { throw new Error('Not implemented'); }

  /** 删除 Recipe */
  async delete(id) { throw new Error('Not implemented'); }

  /** 查询与指定 Recipe 有关系的所有 Recipes */
  async findRelated(recipeId) { throw new Error('Not implemented'); }

  /** 查询包含 Guard 约束的 Recipes（用于 Guard 引擎） */
  async findWithGuards(language) { throw new Error('Not implemented'); }

  /** 获取推荐 Recipes */
  async getRecommendations(limit = 10) { throw new Error('Not implemented'); }

  /** 获取统计信息 */
  async getStats() { throw new Error('Not implemented'); }
}

export default RecipeRepository;
