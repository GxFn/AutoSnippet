/**
 * Snippet 实体
 * 代表一个 Snippet（代码片段）
 */

class Snippet {
  /**
   * @param {Object} data - 初始化数据
   * @param {string} data.id - Snippet ID
   * @param {string} data.recipeId - 关联的 Recipe ID
   * @param {string} data.name - Snippet 名称
   * @param {string} data.content - Snippet 内容（代码）
   * @param {string} data.language - 编程语言
   * @param {string} data.filePath - 源文件路径
   * @param {number} [data.lineStart] - 起始行号
   * @param {number} [data.lineEnd] - 结束行号
   * @param {Object} [data.metadata] - 元数据
   * @param {number} [data.createdAt] - 创建时间戳
   * @param {number} [data.updatedAt] - 更新时间戳
   */
  constructor(data) {
    this.id = data.id;
    this.recipeId = data.recipeId;
    this.name = data.name;
    this.content = data.content;
    this.language = data.language;
    this.filePath = data.filePath;
    this.lineStart = data.lineStart || 0;
    this.lineEnd = data.lineEnd || 0;
    this.metadata = data.metadata || {};
    this.createdAt = data.createdAt || Date.now();
    this.updatedAt = data.updatedAt || Date.now();
  }

  /**
   * 验证 Snippet 是否有效
   * @returns {boolean}
   */
  isValid() {
    return !!(this.id && this.recipeId && this.name && this.content);
  }

  /**
   * 验证并返回错误信息
   * @returns {string|null}
   */
  validate() {
    if (!this.id) return 'Snippet ID is required';
    if (!this.recipeId) return 'Snippet recipe ID is required';
    if (!this.name) return 'Snippet name is required';
    if (!this.content) return 'Snippet content is required';

    return null;
  }

  /**
   * 更新 Snippet
   * @param {Object} updates - 更新数据
   * @returns {Snippet}
   */
  update(updates) {
    Object.assign(this, updates);
    this.updatedAt = Date.now();
    return this;
  }

  /**
   * 获取 Snippet 的行数
   * @returns {number}
   */
  getLineCount() {
    return this.content.split('\n').length;
  }

  /**
   * 获取 Snippet 的大小（字节）
   * @returns {number}
   */
  getSize() {
    return Buffer.byteLength(this.content, 'utf8');
  }

  /**
   * 转换为 JSON
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      recipeId: this.recipeId,
      name: this.name,
      content: this.content,
      language: this.language,
      filePath: this.filePath,
      lineStart: this.lineStart,
      lineEnd: this.lineEnd,
      metadata: this.metadata,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  /**
   * 从 JSON 创建实例
   * @param {Object} json
   * @returns {Snippet}
   */
  static fromJSON(json) {
    return new Snippet(json);
  }

  /**
   * 克隆 Snippet
   * @returns {Snippet}
   */
  clone() {
    return new Snippet(this.toJSON());
  }
}

module.exports = Snippet;
