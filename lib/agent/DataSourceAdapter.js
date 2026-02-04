/**
 * DataSourceAdapter - 外部数据源适配和集成
 * 
 * 职责：
 * - 多源数据适配
 * - 缓存策略管理
 * - 数据同步机制
 * - 数据转换和标准化
 */

const EventEmitter = require('events');

class DataSourceAdapter extends EventEmitter {
  constructor(options = {}) {
    super();
    this.name = 'DataSourceAdapter';
    this.version = '1.0.0';

    this.config = {
      maxCacheSize: options.maxCacheSize || 1000,
      cacheTTL: options.cacheTTL || 3600000, // 1 小时
      syncInterval: options.syncInterval || 300000, // 5 分钟
      enablePersistence: options.enablePersistence !== false,
      ...options
    };

    this.logger = options.logger || console;

    // 数据源注册
    this.dataSources = new Map();
    
    // 缓存系统
    this.cache = new Map();
    this.cacheMetadata = new Map();

    // 统计数据
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      syncCount: 0,
      errorCount: 0
    };

    // 同步任务
    this.syncTasks = new Map();
  }

  /**
   * 注册数据源
   * @param {string} sourceId - 数据源 ID
   * @param {Object} source - 数据源实现
   * @returns {boolean} 注册是否成功
   */
  registerSource(sourceId, source) {
    if (!source || typeof source.fetch !== 'function') {
      throw new Error(`Invalid source: must have fetch() method`);
    }

    this.dataSources.set(sourceId, {
      id: sourceId,
      handler: source,
      enabled: true,
      priority: source.priority || 0,
      lastSync: null,
      syncCount: 0
    });

    this.emit('source_registered', { sourceId });
    this.logger.log(`[DataSourceAdapter] 数据源已注册: ${sourceId}`);

    return true;
  }

  /**
   * 禁用数据源
   * @param {string} sourceId - 数据源 ID
   */
  disableSource(sourceId) {
    const source = this.dataSources.get(sourceId);
    if (source) {
      source.enabled = false;
      this.emit('source_disabled', { sourceId });
    }
  }

  /**
   * 启用数据源
   * @param {string} sourceId - 数据源 ID
   */
  enableSource(sourceId) {
    const source = this.dataSources.get(sourceId);
    if (source) {
      source.enabled = true;
      this.emit('source_enabled', { sourceId });
    }
  }

  /**
   * 获取数据
   * @param {string} query - 查询
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 数据结果
   */
  async fetch(query, options = {}) {
    this.stats.totalRequests++;

    // 1. 检查缓存
    const cacheKey = this._generateCacheKey(query, options);
    const cached = this._getFromCache(cacheKey);

    if (cached) {
      this.stats.cacheHits++;
      this.emit('cache_hit', { query, source: cached.source });
      return cached.data;
    }

    this.stats.cacheMisses++;

    try {
      // 2. 从多个数据源获取
      const results = await this._fetchFromSources(query, options);

      // 3. 融合和排序结果
      const merged = this._mergeResults(results);

      // 4. 缓存结果
      this._setCache(cacheKey, merged);

      this.emit('fetch_success', { query, sources: results.length });
      return merged;

    } catch (error) {
      this.stats.errorCount++;
      this.emit('fetch_error', { query, error: error.message });
      throw error;
    }
  }

  /**
   * 从多个数据源获取数据
   * @private
   */
  async _fetchFromSources(query, options) {
    const enabledSources = Array.from(this.dataSources.values())
      .filter(s => s.enabled)
      .sort((a, b) => b.priority - a.priority);

    const results = [];

    for (const source of enabledSources) {
      try {
        const data = await source.handler.fetch(query, options);
        if (data && (Array.isArray(data) && data.length > 0 || Object.keys(data).length > 0)) {
          results.push({
            source: source.id,
            data,
            timestamp: new Date(),
            quality: source.handler.quality || 0.5
          });
        }
      } catch (error) {
        this.logger.warn(`[DataSourceAdapter] 源 ${source.id} 获取失败:`, error.message);
        // 继续尝试其他源
      }
    }

    return results;
  }

  /**
   * 融合多源结果
   * @private
   */
  _mergeResults(results) {
    if (results.length === 0) {
      return { items: [], sources: [] };
    }

    const merged = {
      items: [],
      sources: results.map(r => r.source),
      quality: results.reduce((sum, r) => sum + r.quality, 0) / results.length
    };

    // 基于数据类型融合
    const firstData = results[0].data;

    if (Array.isArray(firstData)) {
      // 数组类型：去重和合并
      const itemMap = new Map();
      for (const result of results) {
        for (const item of result.data) {
          const key = item.id || item.name || JSON.stringify(item);
          if (!itemMap.has(key)) {
            itemMap.set(key, { ...item, sources: [result.source], quality: result.quality });
          } else {
            // 更新多源信息
            const existing = itemMap.get(key);
            existing.sources.push(result.source);
            existing.quality = Math.max(existing.quality, result.quality);
          }
        }
      }
      merged.items = Array.from(itemMap.values());
    } else if (typeof firstData === 'object') {
      // 对象类型：深度合并
      for (const result of results) {
        merged.items.push({
          ...result.data,
          source: result.source,
          quality: result.quality
        });
      }
    }

    return merged;
  }

  /**
   * 缓存管理 - 生成缓存键
   * @private
   */
  _generateCacheKey(query, options) {
    return `${query}:${JSON.stringify(options || {})}`;
  }

  /**
   * 从缓存获取
   * @private
   */
  _getFromCache(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;

    const metadata = this.cacheMetadata.get(key);
    const now = Date.now();

    // 检查 TTL
    if (metadata && (now - metadata.createdAt) > this.config.cacheTTL) {
      this.cache.delete(key);
      this.cacheMetadata.delete(key);
      return null;
    }

    // 更新访问时间
    if (metadata) {
      metadata.lastAccessed = now;
      metadata.accessCount++;
    }

    return cached;
  }

  /**
   * 写入缓存
   * @private
   */
  _setCache(key, data) {
    // 检查缓存大小限制
    if (this.cache.size >= this.config.maxCacheSize) {
      this._evictOldest();
    }

    this.cache.set(key, { data, source: 'adapter' });
    this.cacheMetadata.set(key, {
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 1,
      size: JSON.stringify(data).length
    });
  }

  /**
   * 清除最老的缓存
   * @private
   */
  _evictOldest() {
    let oldest = null;
    let oldestKey = null;

    for (const [key, metadata] of this.cacheMetadata.entries()) {
      if (!oldest || metadata.lastAccessed < oldest.lastAccessed) {
        oldest = metadata;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.cacheMetadata.delete(oldestKey);
    }
  }

  /**
   * 启动定期同步
   * @param {string} sourceId - 数据源 ID
   * @param {Function} syncFn - 同步函数
   * @param {number} interval - 同步间隔（毫秒）
   */
  startSync(sourceId, syncFn, interval = this.config.syncInterval) {
    if (this.syncTasks.has(sourceId)) {
      this.stopSync(sourceId);
    }

    const taskId = setInterval(async () => {
      try {
        this.stats.syncCount++;
        const source = this.dataSources.get(sourceId);
        if (source && source.enabled) {
          const result = await syncFn();
          source.lastSync = new Date();
          source.syncCount++;
          this.emit('sync_success', { sourceId, result });
        }
      } catch (error) {
        this.logger.error(`[DataSourceAdapter] 同步失败 ${sourceId}:`, error.message);
        this.emit('sync_error', { sourceId, error: error.message });
      }
    }, interval);

    this.syncTasks.set(sourceId, taskId);
  }

  /**
   * 停止同步
   * @param {string} sourceId - 数据源 ID
   */
  stopSync(sourceId) {
    const taskId = this.syncTasks.get(sourceId);
    if (taskId) {
      clearInterval(taskId);
      this.syncTasks.delete(sourceId);
    }
  }

  /**
   * 清除所有缓存
   */
  clearCache() {
    this.cache.clear();
    this.cacheMetadata.clear();
    this.emit('cache_cleared');
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      hitRate: this.stats.totalRequests > 0
        ? ((this.stats.cacheHits / this.stats.totalRequests) * 100).toFixed(2) + '%'
        : '0%',
      totalMemory: Array.from(this.cacheMetadata.values())
        .reduce((sum, m) => sum + m.size, 0),
      ...this.stats
    };
  }

  /**
   * 获取数据源状态
   */
  getSourcesStatus() {
    return Array.from(this.dataSources.values()).map(source => ({
      id: source.id,
      enabled: source.enabled,
      priority: source.priority,
      lastSync: source.lastSync,
      syncCount: source.syncCount
    }));
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    const totalMemory = Array.from(this.cacheMetadata.values())
      .reduce((sum, m) => sum + m.size, 0);

    return {
      ...this.stats,
      cacheSize: this.cache.size,
      sourceCount: this.dataSources.size,
      enabledSources: Array.from(this.dataSources.values()).filter(s => s.enabled).length,
      hitRate: this.stats.totalRequests > 0
        ? ((this.stats.cacheHits / this.stats.totalRequests) * 100).toFixed(2)
        : 0,
      totalMemory: (totalMemory / 1024).toFixed(2) + 'KB'
    };
  }

  /**
   * 重置统计
   */
  resetStatistics() {
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      syncCount: 0,
      errorCount: 0
    };
  }
}

module.exports = DataSourceAdapter;
