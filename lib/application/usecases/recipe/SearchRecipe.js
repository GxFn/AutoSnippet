/**
 * SearchRecipe Use Case
 * 搜索 Recipe 的业务用例
 */

const { ValidationError } = require('../../../infrastructure/errors');

class SearchRecipe {
  constructor(searchService, logger) {
    this.searchService = searchService;
    this.logger = logger;
  }

  /**
   * 执行搜索
   * @param {Object} params - 搜索参数
   * @param {string} params.keyword - 搜索关键词
   * @param {boolean} [params.semantic] - 是否使用语义搜索
   * @param {number} [params.limit] - 结果数量限制
   * @param {Object} [params.filter] - 过滤条件
   * @returns {Promise<Array>} 搜索结果
   */
  async execute(params) {
    this._validate(params);

    try {
      const results = await this.searchService.search(params.keyword || '', {
        semantic: params.semantic || false,
        limit: params.limit || 10,
        filter: params.filter || {}
      });

      if (this.logger) {
        this.logger.info('Search completed', {
          keyword: params.keyword,
          resultCount: results.length
        });
      }

      return results;
    } catch (error) {
      if (this.logger) {
        this.logger.error('Search failed', { error: error.message, params });
      }
      throw error;
    }
  }

  /**
   * 验证参数
   * @private
   */
  _validate(params) {
    if (params.limit && (params.limit < 1 || params.limit > 100)) {
      throw new ValidationError('Limit must be between 1 and 100', {
        field: 'limit',
        value: params.limit
      });
    }
  }
}

module.exports = SearchRecipe;
