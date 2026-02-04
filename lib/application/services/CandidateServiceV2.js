/**
 * CandidateService V2 - 升级版本
 * 
 * 整合搜索服务和质量评分，提供完整的候选项查询和排序
 * 
 * 职责：
 * - 执行搜索查询
 * - 对结果进行质量评分
 * - 按质量排序
 * - 提供高级过滤和聚合
 */

const SearchServiceV2 = require('./SearchServiceV2');
const QualityScorer = require('../../quality/QualityScorer');

/**
 * CandidateService V2 - 候选项服务
 * 
 * 融合搜索和质量评分，提供：
 * - 候选项搜索
 * - 候选项评分
 * - 候选项聚合和排序
 * 
 * 使用示例：
 * ```javascript
 * const service = new CandidateServiceV2(projectRoot);
 * 
 * // 搜索并评分
 * const candidates = await service.searchAndScore('keyword', {
 *   semantic: true,
 *   minQuality: 0.5,
 *   limit: 5
 * });
 * 
 * // 对单个候选项评分
 * const score = await service.scoreCandidate(item, { context: {} });
 * ```
 */
class CandidateServiceV2 {
  constructor(projectRoot, config = {}) {
    this._validateProjectRoot(projectRoot);
    
    this.projectRoot = projectRoot;
    this.config = this._parseConfig(config);
    this.searchService = new SearchServiceV2(projectRoot, config.searchConfig);
    this.qualityScorer = new QualityScorer(config.scorerConfig || {});
    this.logger = this._createLogger();
  }

  // ============ Public API ============

  /**
   * 搜索并评分
   * 
   * @param {string} keyword - 搜索关键词
   * @param {Object} options - 选项
   *   @param {boolean} options.semantic - 是否使用语义搜索
   *   @param {number} options.limit - 返回上限
   *   @param {number} options.minQuality - 最小质量分数 (0-1)
   *   @param {Object} options.context - 评分上下文
   *   @param {string[]} options.types - 过滤的类型 (snippet, recipe)
   *   @param {boolean} options.ranking - 是否启用排名
   * 
   * @returns {Promise<Object[]>} 候选项列表，按质量排序
   */
  async searchAndScore(keyword, options = {}) {
    try {
      const config = this._mergeOptions(options);

      // 执行搜索
      const candidates = await this.searchService.search(keyword, {
        semantic: config.semantic,
        limit: config.rawLimit, // 获取更多原始结果以便评分过滤
        ranking: config.ranking,
        weights: config.weights,
        context: config.context
      });

      // 过滤类型
      let filtered = candidates;
      if (config.types && config.types.length > 0) {
        filtered = candidates.filter(c => config.types.includes(c.type));
      }

      // 评分和过滤
      const scored = await Promise.all(
        filtered.map(async (candidate) => {
          const score = await this.scoreCandidate(candidate, { context: config.context });
          return { ...candidate, _qualityScore: score };
        })
      );

      // 按质量过滤
      let result = scored;
      if (config.minQuality > 0) {
        result = scored.filter(c => c._qualityScore >= config.minQuality);
      }

      // 按质量排序
      result.sort((a, b) => b._qualityScore - a._qualityScore);

      // 截取限制
      return result.slice(0, config.limit);
    } catch (e) {
      this.logger.error('搜索并评分失败', { keyword, error: e.message });
      return [];
    }
  }

  /**
   * 只搜索（不评分）
   * 
   * @param {string} keyword - 搜索关键词
   * @param {Object} options - 搜索选项
   * @returns {Promise<Object[]>} 候选项列表
   */
  async search(keyword, options = {}) {
    return this.searchService.search(keyword, options);
  }

  /**
   * 对候选项进行质量评分
   * 
   * @param {Object} candidate - 候选项对象
   *   @param {string} candidate.title - 标题
   *   @param {string} candidate.content - 内容
   *   @param {string} candidate.code - 代码块
   *   @param {string} candidate.type - 类型 (snippet/recipe)
   * @param {Object} options - 选项
   *   @param {Object} options.context - 评分上下文
   *   @param {Object} options.weights - 维度权重配置
   * 
   * @returns {Promise<number>} 质量分数 (0-1)
   */
  async scoreCandidate(candidate, options = {}) {
    try {
      const result = await this.qualityScorer.score(candidate, {
        context: options.context || {},
        weights: options.weights || {}
      });

      return result.overall || 0;
    } catch (e) {
      this.logger.warn('候选项评分失败', { title: candidate.title, error: e.message });
      return 0;
    }
  }

  /**
   * 获取候选项的详细评分
   * 
   * @param {Object} candidate - 候选项对象
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 详细评分结果
   */
  async scoreDetailedCandidate(candidate, options = {}) {
    try {
      return await this.qualityScorer.score(candidate, {
        context: options.context || {},
        weights: options.weights || {}
      });
    } catch (e) {
      this.logger.warn('详细评分失败', { title: candidate.title, error: e.message });
      return {
        overall: 0,
        dimensions: {}
      };
    }
  }

  /**
   * 聚合候选项
   * 
   * 按类型、触发器等进行聚合统计
   * 
   * @param {Object[]} candidates - 候选项列表
   * @returns {Object} 聚合结果
   */
  aggregateCandidates(candidates) {
    const result = {
      total: candidates.length,
      byType: {},
      byScore: {
        excellent: 0,
        good: 0,
        fair: 0,
        poor: 0
      },
      avgScore: 0
    };

    let totalScore = 0;

    for (const c of candidates) {
      // 按类型统计
      if (!result.byType[c.type]) {
        result.byType[c.type] = 0;
      }
      result.byType[c.type]++;

      // 按分数统计
      const score = c._qualityScore || 0;
      totalScore += score;

      if (score >= 0.8) {
        result.byScore.excellent++;
      } else if (score >= 0.6) {
        result.byScore.good++;
      } else if (score >= 0.4) {
        result.byScore.fair++;
      } else {
        result.byScore.poor++;
      }
    }

    result.avgScore = candidates.length > 0 ? (totalScore / candidates.length) : 0;
    return result;
  }

  /**
   * 清空搜索缓存
   * @returns {void}
   */
  clearCache() {
    this.searchService.clearCache();
    this.logger.log('缓存已清空');
  }

  /**
   * 获取服务统计
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      searchCache: this.searchService.getCacheStats(),
      scorerDimensions: this.qualityScorer.getDimensions?.() || []
    };
  }

  // ============ Private Methods ============

  /**
   * 验证项目根目录
   * @private
   */
  _validateProjectRoot(projectRoot) {
    if (!projectRoot || typeof projectRoot !== 'string') {
      throw new Error('projectRoot 必须是非空字符串');
    }
  }

  /**
   * 解析初始配置
   * @private
   */
  _parseConfig(config) {
    return {
      minQuality: config.minQuality !== undefined ? config.minQuality : 0,
      defaultLimit: config.defaultLimit || 10,
      rawLimit: config.rawLimit || (config.defaultLimit || 10) * 3,
      types: config.types || ['snippet', 'recipe'],
      weights: config.weights || {},
      ranking: config.ranking !== false
    };
  }

  /**
   * 合并搜索选项
   * @private
   */
  _mergeOptions(options) {
    return {
      semantic: options.semantic ?? false,
      limit: options.limit ?? this.config.defaultLimit,
      rawLimit: this.config.rawLimit,
      minQuality: options.minQuality !== undefined
        ? options.minQuality
        : this.config.minQuality,
      context: options.context ?? {},
      types: options.types ?? this.config.types,
      weights: options.weights ?? this.config.weights,
      ranking: options.ranking !== undefined ? options.ranking : this.config.ranking
    };
  }

  /**
   * 创建 logger 实例
   * @private
   */
  _createLogger() {
    return {
      log: (msg, data) => {
        if (process.env.DEBUG) {
          console.log(`[CandidateServiceV2] ${msg}`, data ? JSON.stringify(data) : '');
        }
      },
      warn: (msg, data) => {
        console.warn(`[CandidateServiceV2] ⚠️  ${msg}`, data ? JSON.stringify(data) : '');
      },
      error: (msg, data) => {
        console.error(`[CandidateServiceV2] ❌ ${msg}`, data ? JSON.stringify(data) : '');
      }
    };
  }
}

module.exports = CandidateServiceV2;
