/**
 * CacheHub - 三层缓存系统
 * 
 * L1: 内存缓存（速度最快，容量有限）
 * L2: 磁盘缓存（速度中等，容量大）
 * L3: 重建（最慢，按需计算）
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class CacheHub {
  constructor(options = {}) {
  this.l1 = new Map(); // 内存缓存
  this.l2Dir = options.l2Dir || path.join(process.cwd(), '.cache');
  this.defaultTtl = options.defaultTtl || 3600; // 1 小时
  this.stats = {
    l1Hit: 0,
    l2Hit: 0,
    l3Hit: 0,
    miss: 0
  };

  // 确保 L2 目录存在
  if (!fs.existsSync(this.l2Dir)) {
    fs.mkdirSync(this.l2Dir, { recursive: true });
  }
  }

  /**
   * 生成缓存 key 的哈希值（用于文件名）
   */
  _hashKey(key) {
  return crypto.createHash('md5').update(key).digest('hex');
  }

  /**
   * 获取 L2 缓存文件路径
   */
  _getCachePath(key) {
  return path.join(this.l2Dir, this._hashKey(key) + '.json');
  }

  /**
   * 获取缓存数据
   * 
   * 使用方式：
   * const data = await cache.get('key', async () => {
   *   // 如果缓存未命中，执行这个函数
   *   return await computeExpensiveValue();
   * }, { ttl: 7200 });
   */
  async get(key, fallback, options = {}) {
  const ttl = options.ttl || this.defaultTtl;
  const levels = options.level || ['memory', 'disk', 'rebuild'];

  // L1: 检查内存缓存
  if (levels.includes('memory')) {
    const cached = this.l1.get(key);
    if (cached && Date.now() < cached.expireAt) {
    this.stats.l1Hit++;
    return cached.data;
    } else if (cached) {
    // 过期，删除
    this.l1.delete(key);
    }
  }

  // L2: 检查磁盘缓存
  if (levels.includes('disk')) {
    try {
    const cachePath = this._getCachePath(key);
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      if (Date.now() < cached.expireAt) {
      // 缓存命中，放回 L1
      this.l1.set(key, cached);
      this.stats.l2Hit++;
      return cached.data;
      } else {
      // 过期，删除
      fs.unlinkSync(cachePath);
      }
    }
    } catch (err) {
    // 读取失败，继续到 L3
    }
  }

  // L3: 重建（调用 fallback 函数）
  if (levels.includes('rebuild') && fallback) {
    try {
    const data = await fallback();
    const cached = {
      data,
      expireAt: Date.now() + ttl * 1000,
      createdAt: new Date().toISOString()
    };

    // 存入 L1
    this.l1.set(key, cached);

    // 存入 L2（如果支持）
    if (levels.includes('disk')) {
      try {
      const cachePath = this._getCachePath(key);
      fs.writeFileSync(cachePath, JSON.stringify(cached));
      } catch (err) {
      // L2 写入失败，不中断流程
      }
    }

    this.stats.l3Hit++;
    return data;
    } catch (err) {
    throw err;
    }
  }

  this.stats.miss++;
  return null;
  }

  /**
   * 设置缓存（不走 fallback，直接存储）
   */
  set(key, data, options = {}) {
  const ttl = options.ttl || this.defaultTtl;
  const levels = options.level || ['memory', 'disk'];

  const cached = {
    data,
    expireAt: Date.now() + ttl * 1000,
    createdAt: new Date().toISOString()
  };

  // L1: 存入内存
  if (levels.includes('memory')) {
    this.l1.set(key, cached);
  }

  // L2: 存入磁盘
  if (levels.includes('disk')) {
    try {
    const cachePath = this._getCachePath(key);
    fs.writeFileSync(cachePath, JSON.stringify(cached));
    } catch (err) {
    // 磁盘写入失败，不中断流程
    }
  }

  return this;
  }

  /**
   * 删除缓存
   */
  delete(key) {
  // 删除 L1
  this.l1.delete(key);

  // 删除 L2
  try {
    const cachePath = this._getCachePath(key);
    if (fs.existsSync(cachePath)) {
    fs.unlinkSync(cachePath);
    }
  } catch (err) {
    // 忽略删除失败
  }

  return this;
  }

  /**
   * 清空所有缓存
   */
  clear() {
  this.l1.clear();
  try {
    const files = fs.readdirSync(this.l2Dir);
    for (const file of files) {
    fs.unlinkSync(path.join(this.l2Dir, file));
    }
  } catch (err) {
    // 忽略清空失败
  }
  return this;
  }

  /**
   * 获取缓存统计
   */
  getStats() {
  const total = this.stats.l1Hit + this.stats.l2Hit + this.stats.l3Hit + this.stats.miss;
  const hitCount = this.stats.l1Hit + this.stats.l2Hit + this.stats.l3Hit;
  const hitRate = total > 0 ? (hitCount / total * 100).toFixed(2) : 0;

  return {
    ...this.stats,
    total,
    hitCount,
    hitRate: parseFloat(hitRate),
    l1Size: this.l1.size,
    avgTime: {
    l1: '< 1ms',
    l2: '10-50ms',
    l3: '100-500ms'
    }
  };
  }

  /**
   * 重置统计
   */
  resetStats() {
  this.stats = {
    l1Hit: 0,
    l2Hit: 0,
    l3Hit: 0,
    miss: 0
  };
  return this;
  }

  /**
   * 获取 L1 内存使用情况
   */
  getMemoryUsage() {
  let size = 0;
  for (const cached of this.l1.values()) {
    size += JSON.stringify(cached.data).length;
  }
  return {
    l1Items: this.l1.size,
    l1SizeBytes: size,
    l1SizeMB: (size / 1024 / 1024).toFixed(2)
  };
  }
}

module.exports = { CacheHub };
