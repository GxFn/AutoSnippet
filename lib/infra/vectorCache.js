/**
 * 向量缓存层
 * 本地缓存 Recipe 的向量嵌入，减少 API 调用，提高性能
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const kbConfig = require('../../config/knowledge-base.config');

class VectorCache {
  constructor(cachePath = null) {
    this.cachePath = cachePath || kbConfig.indexing.cachePath;
    this.cache = new Map();  // 内存缓存
    this.stats = {
      hits: 0,
      misses: 0,
      stores: 0,
      expires: 0
    };
    
    // 初始化缓存目录
    this.ensureCacheDir();
    
    // 加载持久化缓存
    this.loadPersistentCache();
  }
  
  ensureCacheDir() {
    if (!fs.existsSync(this.cachePath)) {
      fs.mkdirSync(this.cachePath, { recursive: true });
    }
  }
  
  /**
   * 获取缓存中的向量
   * @param {string} recipeId - Recipe ID
   * @param {string} contentHash - 内容哈希（用于版本控制）
   * @returns {array|null} 向量或 null
   */
  get(recipeId, contentHash = null) {
    const key = this.getCacheKey(recipeId, contentHash);
    
    // 检查内存缓存
    if (this.cache.has(key)) {
      const entry = this.cache.get(key);
      
      // 检查过期时间
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        this.cache.delete(key);
        this.stats.expires++;
        return null;
      }
      
      this.stats.hits++;
      return entry.embedding;
    }
    
    // 检查文件缓存
    const filePath = this.getFilePath(key);
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        
        // 检查过期
        if (data.expiresAt && Date.now() > data.expiresAt) {
          fs.unlinkSync(filePath);
          this.stats.expires++;
          return null;
        }
        
        // 加载到内存缓存
        this.cache.set(key, data);
        this.stats.hits++;
        return data.embedding;
      } catch (err) {
        console.error(`读取缓存失败: ${filePath}`, err);
        return null;
      }
    }
    
    this.stats.misses++;
    return null;
  }
  
  /**
   * 存储向量到缓存
   * @param {string} recipeId - Recipe ID
   * @param {array} embedding - 向量
   * @param {object} metadata - 元数据
   * @param {string} contentHash - 内容哈希
   * @returns {boolean} 是否成功
   */
  set(recipeId, embedding, metadata = {}, contentHash = null) {
    if (!Array.isArray(embedding) || embedding.length !== kbConfig.indexing.embeddingDimension) {
      throw new Error(`向量维度不正确，期望 ${kbConfig.indexing.embeddingDimension}，收到 ${embedding.length}`);
    }
    
    const key = this.getCacheKey(recipeId, contentHash);
    const expiresAt = Date.now() + (kbConfig.indexing.cacheExpiry * 1000);
    
    const entry = {
      recipeId,
      embedding,
      contentHash,
      metadata,
      createdAt: Date.now(),
      expiresAt
    };
    
    // 保存到内存缓存
    this.cache.set(key, entry);
    
    // 保存到文件缓存（如果启用）
    if (kbConfig.indexing.enableCaching) {
      try {
        const filePath = this.getFilePath(key);
        fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
      } catch (err) {
        console.error(`写入缓存失败: ${key}`, err);
      }
    }
    
    // 检查缓存大小限制
    if (this.cache.size > kbConfig.indexing.maxCacheSize) {
      this.evictOldest();
    }
    
    this.stats.stores++;
    return true;
  }
  
  /**
   * 批量存储向量
   * @param {object} embeddings - { recipeId: embedding } 映射
   * @param {object} metadata - 元数据映射
   * @returns {number} 成功存储的数量
   */
  setMultiple(embeddings, metadata = {}) {
    let count = 0;
    
    for (const [recipeId, embedding] of Object.entries(embeddings)) {
      try {
        this.set(recipeId, embedding, metadata[recipeId] || {});
        count++;
      } catch (err) {
        console.error(`批量存储失败: ${recipeId}`, err);
      }
    }
    
    return count;
  }
  
  /**
   * 批量获取向量
   * @param {array} recipeIds - Recipe ID 列表
   * @returns {object} { recipeId: embedding } 映射
   */
  getMultiple(recipeIds) {
    const result = {};
    
    for (const recipeId of recipeIds) {
      const embedding = this.get(recipeId);
      if (embedding) {
        result[recipeId] = embedding;
      }
    }
    
    return result;
  }
  
  /**
   * 清除单个缓存条目
   * @param {string} recipeId - Recipe ID
   * @param {string} contentHash - 内容哈希
   * @returns {boolean} 是否找到并删除
   */
  delete(recipeId, contentHash = null) {
    const key = this.getCacheKey(recipeId, contentHash);
    
    // 删除内存缓存
    this.cache.delete(key);
    
    // 删除文件缓存
    const filePath = this.getFilePath(key);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        return true;
      } catch (err) {
        console.error(`删除缓存文件失败: ${filePath}`, err);
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * 清空所有缓存
   * @returns {number} 清空的条目数
   */
  clear() {
    const count = this.cache.size;
    this.cache.clear();
    
    // 清空文件缓存
    try {
      const files = fs.readdirSync(this.cachePath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(this.cachePath, file));
        }
      }
    } catch (err) {
      console.error('清空文件缓存失败', err);
    }
    
    return count;
  }
  
  /**
   * 获取缓存统计信息
   * @returns {object} 统计数据
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0;
    
    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      cacheSize: this.cache.size,
      maxCacheSize: kbConfig.indexing.maxCacheSize,
      cacheUtilization: `${((this.cache.size / kbConfig.indexing.maxCacheSize) * 100).toFixed(2)}%`
    };
  }
  
  /**
   * 清除过期缓存
   * @returns {number} 清除的条目数
   */
  cleanup() {
    let count = 0;
    const now = Date.now();
    
    // 清理内存缓存
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.cache.delete(key);
        count++;
      }
    }
    
    // 清理文件缓存
    try {
      const files = fs.readdirSync(this.cachePath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.cachePath, file);
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          if (data.expiresAt && now > data.expiresAt) {
            fs.unlinkSync(filePath);
            count++;
          }
        }
      }
    } catch (err) {
      console.error('清理文件缓存失败', err);
    }
    
    return count;
  }
  
  /**
   * 私有方法：生成缓存键
   */
  getCacheKey(recipeId, contentHash = null) {
    if (contentHash) {
      return `${recipeId}_${contentHash}`;
    }
    return recipeId;
  }
  
  /**
   * 私有方法：获取文件路径
   */
  getFilePath(key) {
    const hash = crypto.createHash('md5').update(key).digest('hex');
    return path.join(this.cachePath, `${hash}.json`);
  }
  
  /**
   * 私有方法：加载持久化缓存
   */
  loadPersistentCache() {
    if (!kbConfig.indexing.enableCaching) {
      return;
    }
    
    try {
      if (!fs.existsSync(this.cachePath)) {
        return;
      }
      
      const files = fs.readdirSync(this.cachePath);
      const now = Date.now();
      let loaded = 0;
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const filePath = path.join(this.cachePath, file);
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          
          // 跳过过期条目
          if (data.expiresAt && now > data.expiresAt) {
            fs.unlinkSync(filePath);
            continue;
          }
          
          const key = this.getCacheKey(data.recipeId, data.contentHash);
          this.cache.set(key, data);
          loaded++;
        } catch (err) {
          // 忽略损坏的缓存文件
        }
      }
      
      console.log(`向量缓存加载完成: ${loaded} 条条目`);
    } catch (err) {
      console.error('加载持久化缓存失败', err);
    }
  }
  
  /**
   * 私有方法：驱逐最旧的条目
   */
  evictOldest() {
    let oldest = null;
    let oldestTime = Infinity;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldest = key;
      }
    }
    
    if (oldest) {
      const entry = this.cache.get(oldest);
      this.cache.delete(oldest);
      
      // 也删除文件缓存
      const filePath = this.getFilePath(oldest);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }
}

module.exports = VectorCache;
