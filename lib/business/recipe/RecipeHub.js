/**
 * RecipeHub - 知识库和最佳实践管理
 * 
 * 功能：
 * - Recipe 创建、编辑、发布
 * - 版本控制和历史跟踪
 * - 审批流程
 * - 分类和标签管理
 * - Recipe 搜索和过滤
 */

const crypto = require('crypto');

/**
 * Recipe 版本
 */
class RecipeVersion {
  constructor(content, options = {}) {
    this.id = crypto.randomBytes(8).toString('hex');
    this.content = content;
    this.author = options.author || 'unknown';
    this.timestamp = new Date().toISOString();
    this.changes = options.changes || '';
    this.status = options.status || 'draft'; // draft, review, published
  }
}

/**
 * Recipe 审批记录
 */
class ApprovalRecord {
  constructor(options = {}) {
    this.id = crypto.randomBytes(8).toString('hex');
    this.reviewer = options.reviewer || 'unknown';
    this.status = options.status || 'pending'; // pending, approved, rejected
    this.comment = options.comment || '';
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Recipe 主体类
 */
class Recipe {
  constructor(options = {}) {
    this.id = options.id || crypto.randomBytes(12).toString('hex');
    this.title = options.title || 'Untitled Recipe';
    this.description = options.description || '';
    this.category = options.category || 'general';
    this.tags = options.tags || [];
    this.author = options.author || 'unknown';
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
    
    // 内容版本管理
    this.versions = [];
    this.currentVersion = null;
    
    // 审批流程
    this.approvals = [];
    this.status = 'draft'; // draft, review, approved, published
    
    // 元数据
    this.views = 0;
    this.likes = 0;
    this.rating = 0;
    this.usageCount = 0;
    
    // 初始化第一个版本
    if (options.content) {
      this._addVersion(options.content, { author: this.author });
    }
  }

  /**
   * 内部方法：添加版本
   */
  _addVersion(content, options = {}) {
    const version = new RecipeVersion(content, {
      ...options,
      status: this.status
    });
    this.versions.push(version);
    this.currentVersion = version;
    this.updatedAt = new Date().toISOString();
    return version;
  }

  /**
   * 更新 Recipe 内容
   */
  update(content, options = {}) {
    const version = this._addVersion(content, {
      author: options.author || this.author,
      changes: options.changes || 'Updated'
    });
    return version;
  }

  /**
   * 提交审批
   */
  submitForReview(reviewer, options = {}) {
    if (this.status !== 'draft') {
      throw new Error(`Cannot submit from status: ${this.status}`);
    }

    const approval = new ApprovalRecord({
      reviewer,
      status: 'pending',
      comment: options.comment || ''
    });

    this.approvals.push(approval);
    this.status = 'review';
    this.updatedAt = new Date().toISOString();

    return approval;
  }

  /**
   * 审批（通过）
   */
  approve(reviewer, options = {}) {
    const pendingApproval = this.approvals.find(a => a.status === 'pending');
    
    if (!pendingApproval) {
      throw new Error('No pending approval found');
    }

    pendingApproval.status = 'approved';
    pendingApproval.comment = options.comment || 'Approved';
    pendingApproval.timestamp = new Date().toISOString();
    
    this.status = 'approved';
    this.updatedAt = new Date().toISOString();

    return pendingApproval;
  }

  /**
   * 拒绝审批
   */
  reject(reviewer, options = {}) {
    const pendingApproval = this.approvals.find(a => a.status === 'pending');
    
    if (!pendingApproval) {
      throw new Error('No pending approval found');
    }

    pendingApproval.status = 'rejected';
    pendingApproval.comment = options.comment || 'Rejected';
    pendingApproval.timestamp = new Date().toISOString();
    
    this.status = 'draft';
    this.updatedAt = new Date().toISOString();

    return pendingApproval;
  }

  /**
   * 发布
   */
  publish() {
    if (this.status !== 'approved') {
      throw new Error(`Cannot publish from status: ${this.status}`);
    }

    this.status = 'published';
    this.updatedAt = new Date().toISOString();

    return this;
  }

  /**
   * 记录浏览
   */
  view() {
    this.views++;
    return this;
  }

  /**
   * 点赞
   */
  like() {
    this.likes++;
    return this;
  }

  /**
   * 记录使用次数
   */
  recordUsage(count = 1) {
    this.usageCount += count;
    return this;
  }

  /**
   * 更新评分
   */
  setRating(rating) {
    if (rating < 0 || rating > 5) {
      throw new Error('Rating must be between 0 and 5');
    }
    this.rating = rating;
    return this;
  }

  /**
   * 获取历史版本
   */
  getVersionHistory() {
    return this.versions.map((v, idx) => ({
      index: idx,
      id: v.id,
      author: v.author,
      timestamp: v.timestamp,
      changes: v.changes,
      isCurrent: v.id === this.currentVersion.id
    }));
  }

  /**
   * 获取指定版本内容
   */
  getVersionContent(versionId) {
    const version = this.versions.find(v => v.id === versionId);
    return version ? version.content : null;
  }

  /**
   * 转换为 JSON
   */
  toJSON() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      category: this.category,
      tags: this.tags,
      author: this.author,
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      versionCount: this.versions.length,
      approvalCount: this.approvals.length,
      stats: {
        views: this.views,
        likes: this.likes,
        rating: this.rating,
        usageCount: this.usageCount
      }
    };
  }
}

class RecipeHub {
  constructor(options = {}) {
    this.recipes = new Map(); // id -> Recipe
    this.stats = {
      total: 0,
      byStatus: {},
      byCategory: {},
      totalViews: 0,
      totalUsage: 0
    };
    this.categories = options.categories || [
      'general',
      'architecture',
      'patterns',
      'performance',
      'security',
      'testing'
    ];
  }

  /**
   * 创建 Recipe
   */
  create(options = {}) {
    const recipe = new Recipe(options);
    this.recipes.set(recipe.id, recipe);
    this._updateStats();
    return recipe;
  }

  /**
   * 获取 Recipe
   */
  get(recipeId) {
    return this.recipes.get(recipeId) || null;
  }

  /**
   * 删除 Recipe
   */
  delete(recipeId) {
    const deleted = this.recipes.delete(recipeId);
    if (deleted) {
      this._updateStats();
    }
    return deleted;
  }

  /**
   * 按分类查询
   */
  findByCategory(category) {
    return Array.from(this.recipes.values()).filter(
      r => r.category === category
    );
  }

  /**
   * 按标签查询
   */
  findByTag(tag) {
    return Array.from(this.recipes.values()).filter(
      r => r.tags.includes(tag)
    );
  }

  /**
   * 按状态查询
   */
  findByStatus(status) {
    return Array.from(this.recipes.values()).filter(
      r => r.status === status
    );
  }

  /**
   * 获取热门 Recipe（按点赞排序）
   */
  getPopular(limit = 10) {
    return Array.from(this.recipes.values())
      .filter(r => r.status === 'published')
      .sort((a, b) => b.likes - a.likes)
      .slice(0, limit);
  }

  /**
   * 获取最常用的 Recipe
   */
  getMostUsed(limit = 10) {
    return Array.from(this.recipes.values())
      .filter(r => r.status === 'published')
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit);
  }

  /**
   * 获取待审批的 Recipe
   */
  getPendingApproval() {
    return Array.from(this.recipes.values()).filter(r => r.status === 'review');
  }

  /**
   * 搜索（简单字符串匹配）
   */
  search(query) {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.recipes.values()).filter(
      r =>
        r.title.toLowerCase().includes(lowerQuery) ||
        r.description.toLowerCase().includes(lowerQuery) ||
        r.tags.some(t => t.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * 获取统计信息
   */
  getStats() {
    this._updateStats();
    return { ...this.stats };
  }

  /**
   * 更新统计信息
   */
  _updateStats() {
    this.stats = {
      total: this.recipes.size,
      byStatus: {},
      byCategory: {},
      totalViews: 0,
      totalUsage: 0
    };

    for (const recipe of this.recipes.values()) {
      // 按状态统计
      this.stats.byStatus[recipe.status] =
        (this.stats.byStatus[recipe.status] || 0) + 1;

      // 按分类统计
      this.stats.byCategory[recipe.category] =
        (this.stats.byCategory[recipe.category] || 0) + 1;

      // 总计
      this.stats.totalViews += recipe.views;
      this.stats.totalUsage += recipe.usageCount;
    }

    return this.stats;
  }

  /**
   * 获取所有 Recipe 摘要
   */
  getAllSummary() {
    return Array.from(this.recipes.values()).map(r => r.toJSON());
  }

  /**
   * 导出为 JSON
   */
  exportAsJSON() {
    return {
      timestamp: new Date().toISOString(),
      stats: this.getStats(),
      recipes: this.getAllSummary()
    };
  }

  /**
   * 清空所有 Recipe
   */
  clear() {
    this.recipes.clear();
    this._updateStats();
    return this;
  }

  /**
   * 获取分类列表
   */
  getCategories() {
    return this.categories;
  }

  /**
   * 添加分类
   */
  addCategory(category) {
    if (!this.categories.includes(category)) {
      this.categories.push(category);
    }
    return this;
  }
}

module.exports = {
  RecipeHub,
  Recipe,
  RecipeVersion,
  ApprovalRecord
};
