/**
 * AdvancedCacheLayer - 高级多层缓存系统
 * 
 * 职责：
 * - L1 缓存：内存缓存（热数据）
 * - L2 缓存：磁盘缓存（冷数据）
 * - 缓存预热
 * - 智能失效
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class AdvancedCacheLayer {
  constructor(options = {}) {
    this.name = 'AdvancedCacheLayer';
    this.version = '1.0.0';

    this.config = {
      // L1 缓存配置
      l1Capacity: options.l1Capacity || 1000,
      l1TtlMs: options.l1TtlMs || 3600000, // 1 小时

      // L2 缓存配置
      l2Directory: options.l2Directory || './cache/disk',
      l2TtlMs: options.l2TtlMs || 86400000, // 24 小时

      // 热点数据配置
      hotDataThreshold: options.hotDataThreshold || 100, // 访问次数阈值

      // 预热配置
      enablePreWarming: options.enablePreWarming !== false,
      preWarmingInterval: options.preWarmingInterval || 300000, // 5 分钟

      ...options
    };

    this.logger = options.logger || console;

    // L1 缓存（内存）- LRU with TTL
    this.l1Cache = new Map();
    this.l1Metadata = new Map();

    // L2 缓存（磁盘）
    this.l2Directory = this.config.l2Directory;

    // 访问计数
    this.accessCount = new Map();

    // 热点数据集合
    this.hotData = new Set();

    // 统计
    this.stats = {
      l1Hits: 0,
      l1Misses: 0,
      l2Hits: 0,
      l2Misses: 0,
      writes: 0,
      evictions: 0,
      totalSize: 0
    };

    // 初始化
    this._initL2();

    // 启动预热
    if (this.config.enablePreWarming) {
      this.preWarmingInterval = setInterval(() => this._preWarm(), this.config.preWarmingInterval);
    }
  }

  /**
   * 初始化 L2 缓存目录
   * @private
   */
  _initL2() {
    try {
      if (!fs.existsSync(this.l2Directory)) {
        fs.mkdirSync(this.l2Directory, { recursive: true });
      }
    } catch (error) {
      this.logger.error('[AdvancedCacheLayer] 初始化 L2 缓存失败:', error.message);
    }
  }

  /**
   * 生成缓存键哈希
   * @private
   */
  _generateHash(key) {
    return crypto
      .createHash('md5')
      .update(String(key))
      .digest('hex')
      .substring(0, 8);
  }

  /**
   * 从缓存获取数据
   * @param {string} key - 缓存键
   * @returns {any} 缓存值，未找到返回 null
   */
  get(key) {
    // L1 查询
    const l1Value = this.l1Cache.get(key);
    if (l1Value !== undefined) {
      const metadata = this.l1Metadata.get(key);

      // 检查 TTL
      if (metadata && metadata.expireAt > Date.now()) {
        this._updateAccessCount(key);
        this.stats.l1Hits++;
        return l1Value;
      } else {
        // TTL 过期，删除
        this.l1Cache.delete(key);
        this.l1Metadata.delete(key);
      }
    }

    // L2 查询
    const l2Value = this._getFromL2(key);
    if (l2Value !== null) {
      this.stats.l2Hits++;

      // 促升到 L1
      this._promoteToL1(key, l2Value);
      this._updateAccessCount(key);

      return l2Value;
    }

    this.stats.l1Misses++;
    return null;
  }

  /**
   * 设置缓存数据
   * @param {string} key - 缓存键
   * @param {any} value - 缓存值
   * @param {Object} options - 选项
   */
  set(key, value, options = {}) {
    const ttlMs = options.ttlMs || this.config.l1TtlMs;
    const toL2 = options.toL2 !== false; // 默认也存到 L2

    const metadata = {
      createdAt: Date.now(),
      expireAt: Date.now() + ttlMs,
      size: JSON.stringify(value).length,
      accessCount: 0,
      lastAccessed: Date.now()
    };

    // 写入 L1
    this.l1Cache.set(key, value);
    this.l1Metadata.set(key, metadata);

    // 检查 L1 容量
    this._checkL1Capacity();

    // 写入 L2
    if (toL2) {
      this._writeToL2(key, value, metadata);
    }

    this.stats.writes++;
    this._updateStats();
  }

  /**
   * 删除缓存
   * @param {string} key - 缓存键
   */
  delete(key) {
    this.l1Cache.delete(key);
    this.l1Metadata.delete(key);
    this.accessCount.delete(key);
    this._deleteFromL2(key);
  }

  /**
   * 清空所有缓存
   */
  clear() {
    this.l1Cache.clear();
    this.l1Metadata.clear();
    this.accessCount.clear();
    this.hotData.clear();

    // 清空 L2
    try {
      const files = fs.readdirSync(this.l2Directory);
      for (const file of files) {
        fs.unlinkSync(path.join(this.l2Directory, file));
      }
    } catch (error) {
      this.logger.warn('[AdvancedCacheLayer] 清空 L2 缓存失败:', error.message);
    }

    this.stats = {
      l1Hits: 0,
      l1Misses: 0,
      l2Hits: 0,
      l2Misses: 0,
      writes: 0,
      evictions: 0,
      totalSize: 0
    };
  }

  /**
   * 检查 L1 容量并进行驱逐
   * @private
   */
  _checkL1Capacity() {
    if (this.l1Cache.size > this.config.l1Capacity) {
      // LRU 驱逐
      let lruKey = null;
      let lruTime = Infinity;

      for (const [key, metadata] of this.l1Metadata.entries()) {
        if (metadata.lastAccessed < lruTime) {
          lruTime = metadata.lastAccessed;
          lruKey = key;
        }
      }

      if (lruKey) {
        this.l1Cache.delete(lruKey);
        this.l1Metadata.delete(lruKey);
        this.stats.evictions++;
      }
    }
  }

  /**
   * 更新访问计数
   * @private
   */
  _updateAccessCount(key) {
    const count = (this.accessCount.get(key) || 0) + 1;
    this.accessCount.set(key, count);

    // 更新热数据集合
    if (count >= this.config.hotDataThreshold) {
      this.hotData.add(key);
    }

    // 更新元数据中的最后访问时间
    const metadata = this.l1Metadata.get(key);
    if (metadata) {
      metadata.lastAccessed = Date.now();
      metadata.accessCount = count;
    }
  }

  /**
   * 从 L2 获取数据
   * @private
   */
  _getFromL2(key) {
    try {
      const hash = this._generateHash(key);
      const l2Path = path.join(this.l2Directory, `${hash}.json`);

      if (!fs.existsSync(l2Path)) {
        this.stats.l2Misses++;
        return null;
      }

      const data = JSON.parse(fs.readFileSync(l2Path, 'utf8'));

      // 检查 L2 TTL
      if (data.metadata.expireAt > Date.now()) {
        return data.value;
      } else {
        // TTL 过期，删除
        fs.unlinkSync(l2Path);
        this.stats.l2Misses++;
        return null;
      }
    } catch (error) {
      this.logger.warn('[AdvancedCacheLayer] L2 读取失败:', error.message);
      return null;
    }
  }

  /**
   * 写入 L2
   * @private
   */
  _writeToL2(key, value, metadata) {
    try {
      const hash = this._generateHash(key);
      const l2Path = path.join(this.l2Directory, `${hash}.json`);

      const data = {
        key,
        value,
        metadata: {
          ...metadata,
          expireAt: Date.now() + this.config.l2TtlMs
        }
      };

      fs.writeFileSync(l2Path, JSON.stringify(data, null, 2));
    } catch (error) {
      this.logger.warn('[AdvancedCacheLayer] L2 写入失败:', error.message);
    }
  }

  /**
   * 从 L2 删除
   * @private
   */
  _deleteFromL2(key) {
    try {
      const hash = this._generateHash(key);
      const l2Path = path.join(this.l2Directory, `${hash}.json`);

      if (fs.existsSync(l2Path)) {
        fs.unlinkSync(l2Path);
      }
    } catch (error) {
      this.logger.warn('[AdvancedCacheLayer] L2 删除失败:', error.message);
    }
  }

  /**
   * 促升数据到 L1
   * @private
   */
  _promoteToL1(key, value) {
    const metadata = {
      createdAt: Date.now(),
      expireAt: Date.now() + this.config.l1TtlMs,
      size: JSON.stringify(value).length,
      accessCount: 0,
      lastAccessed: Date.now()
    };

    this.l1Cache.set(key, value);
    this.l1Metadata.set(key, metadata);
    this._checkL1Capacity();
  }

  /**
   * 缓存预热 - 将热数据加载到 L1
   * @private
   */
  _preWarm() {
    try {
      const files = fs.readdirSync(this.l2Directory);

      // 预热最热的前 50 个数据
      const topHotKeys = Array.from(this.accessCount.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([key]) => key);

      for (const key of topHotKeys) {
        const value = this._getFromL2(key);
        if (value !== null && !this.l1Cache.has(key)) {
          this._promoteToL1(key, value);
        }
      }
    } catch (error) {
      this.logger.warn('[AdvancedCacheLayer] 缓存预热失败:', error.message);
    }
  }

  /**
   * 智能失效策略
   * @param {string} pattern - 失效模式（支持通配符）
   */
  invalidate(pattern) {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    const keysToDelete = [];

    for (const key of this.l1Cache.keys()) {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.delete(key);
    }

    return keysToDelete.length;
  }

  /**
   * 更新统计
   * @private
   */
  _updateStats() {
    this.stats.totalSize = 0;

    for (const metadata of this.l1Metadata.values()) {
      this.stats.totalSize += metadata.size || 0;
    }
  }

  /**
   * 获取缓存统计
   */
  getStatistics() {
    const hitRate = this.stats.l1Hits + this.stats.l1Misses > 0
      ? ((this.stats.l1Hits / (this.stats.l1Hits + this.stats.l1Misses)) * 100).toFixed(2) + '%'
      : '0%';

    return {
      ...this.stats,
      l1Size: this.l1Cache.size,
      l1Capacity: this.config.l1Capacity,
      hotDataCount: this.hotData.size,
      hitRate,
      estimatedSizeKb: (this.stats.totalSize / 1024).toFixed(2)
    };
  }

  /**
   * 获取热数据列表
   */
  getHotData() {
    return Array.from(this.hotData).map(key => ({
      key,
      accessCount: this.accessCount.get(key) || 0,
      inL1: this.l1Cache.has(key)
    }));
  }

  /**
   * 重置统计
   */
  resetStatistics() {
    this.stats = {
      l1Hits: 0,
      l1Misses: 0,
      l2Hits: 0,
      l2Misses: 0,
      writes: 0,
      evictions: 0,
      totalSize: 0
    };
  }

  /**
   * 清理资源
   */
  cleanup() {
    if (this.preWarmingInterval) {
      clearInterval(this.preWarmingInterval);
    }
  }
}

module.exports = AdvancedCacheLayer;
