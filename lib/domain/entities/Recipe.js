/**
 * Recipe 实体
 * 代表一个 Recipe（菜谱/知识片段）
 */

class Recipe {
  /**
   * @param {Object} data - 初始化数据
   * @param {string} data.id - Recipe ID
   * @param {string} data.title - 标题
   * @param {string} data.description - 描述
   * @param {string} data.language - 编程语言（javascript, swift, objective-c等）
   * @param {string} data.category - 分类
   * @param {string[]} [data.semanticTags] - 语义标签
   * @param {string[]} [data.keywords] - 关键词
   * @param {string} [data.content] - Recipe 内容
   * @param {Object} [data.quality] - 质量评分
   * @param {Object} [data.dependencies] - 依赖信息
   * @param {number[]} [data.embedding] - 嵌入向量
   * @param {number} [data.createdAt] - 创建时间戳
   * @param {number} [data.updatedAt] - 更新时间戳
   */
  constructor(data) {
    this.id = data.id;
    this.title = data.title;
    this.description = data.description;
    this.language = data.language;
    this.category = data.category;
    this.semanticTags = data.semanticTags || [];
    this.keywords = data.keywords || [];
    this.content = data.content || '';
    this.quality = data.quality || {};
    this.dependencies = data.dependencies || {};
    this.embedding = data.embedding || null;
    this.createdAt = data.createdAt || Date.now();
    this.updatedAt = data.updatedAt || Date.now();
  }

  /**
   * 验证 Recipe 是否有效
   * @returns {boolean}
   */
  isValid() {
    return !!(this.id && this.title && this.language && this.category);
  }

  /**
   * 验证并返回错误信息
   * @returns {string|null} 错误信息，无效返回 null
   */
  validate() {
    if (!this.id) return 'Recipe ID is required';
    if (!this.title) return 'Recipe title is required';
    if (!this.language) return 'Recipe language is required';
    if (!this.category) return 'Recipe category is required';

    return null;
  }

  /**
   * 更新 Recipe
   * @param {Object} updates - 更新数据
   * @returns {Recipe}
   */
  update(updates) {
    Object.assign(this, updates);
    this.updatedAt = Date.now();
    return this;
  }

  /**
   * 转换为 JSON
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      language: this.language,
      category: this.category,
      semanticTags: this.semanticTags,
      keywords: this.keywords,
      content: this.content,
      quality: this.quality,
      dependencies: this.dependencies,
      embedding: this.embedding,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  /**
   * 从 JSON 创建实例
   * @param {Object} json - JSON 对象
   * @returns {Recipe}
   */
  static fromJSON(json) {
    return new Recipe(json);
  }

  /**
   * 克隆 Recipe
   * @returns {Recipe}
   */
  clone() {
    return new Recipe(this.toJSON());
  }

  /**
   * 检查是否需要重新嵌入
   * 当内容或标签更新时需要重新嵌入
   * @returns {boolean}
   */
  needsReembedding() {
    return this.embedding === null || this.embedding === undefined;
  }

  /**
   * 设置嵌入向量
   * @param {number[]} embedding - 嵌入向量
   * @returns {Recipe}
   */
  setEmbedding(embedding) {
    this.embedding = embedding;
    this.updatedAt = Date.now();
    return this;
  }

  /**
   * 添加语义标签
   * @param {string} tag - 标签
   * @returns {Recipe}
   */
  addSemanticTag(tag) {
    if (!this.semanticTags.includes(tag)) {
      this.semanticTags.push(tag);
      this.updatedAt = Date.now();
    }
    return this;
  }

  /**
   * 移除语义标签
   * @param {string} tag - 标签
   * @returns {Recipe}
   */
  removeSemanticTag(tag) {
    const index = this.semanticTags.indexOf(tag);
    if (index > -1) {
      this.semanticTags.splice(index, 1);
      this.updatedAt = Date.now();
    }
    return this;
  }

  /**
   * 添加关键词
   * @param {string} keyword - 关键词
   * @returns {Recipe}
   */
  addKeyword(keyword) {
    if (!this.keywords.includes(keyword)) {
      this.keywords.push(keyword);
      this.updatedAt = Date.now();
    }
    return this;
  }

  /**
   * 移除关键词
   * @param {string} keyword - 关键词
   * @returns {Recipe}
   */
  removeKeyword(keyword) {
    const index = this.keywords.indexOf(keyword);
    if (index > -1) {
      this.keywords.splice(index, 1);
      this.updatedAt = Date.now();
    }
    return this;
  }

  /**
   * 更新质量评分
   * @param {Object} quality - 质量信息
   * @returns {Recipe}
   */
  updateQuality(quality) {
    this.quality = { ...this.quality, ...quality };
    this.updatedAt = Date.now();
    return this;
  }
}

module.exports = Recipe;
