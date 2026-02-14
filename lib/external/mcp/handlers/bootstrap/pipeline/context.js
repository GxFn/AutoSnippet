/**
 * PipelineContext — 管线状态容器
 *
 * 在单次 bootstrap 管线运行中，为所有维度提取器提供：
 *   - 共享计算结果缓存（避免重复计算）
 *   - 维度间数据传递（上游维度结果供下游复用）
 *   - 公共参数统一管理
 *
 * @module pipeline/context
 */

export class PipelineContext {
  /**
   * @param {object} opts
   * @param {string} opts.lang — 主语言
   * @param {string} [opts.projectPrefix] — 项目前缀
   * @param {object} [opts.ast] — AST 分析结果
   */
  constructor(opts = {}) {
    this.lang = opts.lang || 'swift';
    this.projectPrefix = opts.projectPrefix || '';
    this.ast = opts.ast || null;

    /** 维度间共享的提取结果缓存 */
    this._extractorCache = new Map();

    /** 通用计算结果缓存 */
    this._computeCache = new Map();
  }

  // ─── 提取器结果缓存 ─────────────────────────────

  /**
   * 缓存维度提取器的中间结果
   * @param {string} dimensionId — 维度标识 (如 'objc-deep-scan')
   * @param {string} subTopic — 子主题 (如 'defines', 'swizzle')
   * @param {*} data — 缓存数据
   */
  cacheResult(dimensionId, subTopic, data) {
    const key = `${dimensionId}/${subTopic}`;
    this._extractorCache.set(key, data);
  }

  /**
   * 获取上游维度的中间结果
   * @param {string} dimensionId
   * @param {string} subTopic
   * @returns {*} 缓存数据，不存在时返回 undefined
   */
  getCachedResult(dimensionId, subTopic) {
    return this._extractorCache.get(`${dimensionId}/${subTopic}`);
  }

  /**
   * 检查是否有缓存结果
   * @param {string} dimensionId
   * @param {string} subTopic
   * @returns {boolean}
   */
  hasCachedResult(dimensionId, subTopic) {
    return this._extractorCache.has(`${dimensionId}/${subTopic}`);
  }

  // ─── 通用计算缓存 ─────────────────────────────

  /**
   * 缓存计算结果（如 topPrefix、langStats 等）
   * @param {string} key
   * @param {*} value
   */
  setComputed(key, value) {
    this._computeCache.set(key, value);
  }

  /**
   * 获取缓存的计算结果
   * @param {string} key
   * @returns {*}
   */
  getComputed(key) {
    return this._computeCache.get(key);
  }

  /**
   * 获取或计算并缓存
   * @param {string} key
   * @param {function} computeFn — 计算函数（仅在缓存未命中时调用）
   * @returns {*}
   */
  getOrCompute(key, computeFn) {
    if (this._computeCache.has(key)) {
      return this._computeCache.get(key);
    }
    const value = computeFn();
    this._computeCache.set(key, value);
    return value;
  }

  // ─── 调试 ─────────────────────────────────────

  /** 输出缓存统计 */
  debugStats() {
    return {
      extractorCacheKeys: [...this._extractorCache.keys()],
      computeCacheKeys: [...this._computeCache.keys()],
      extractorCacheSize: this._extractorCache.size,
      computeCacheSize: this._computeCache.size,
    };
  }
}
