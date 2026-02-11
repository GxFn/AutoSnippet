/**
 * 统一缓存适配器
 * 支持内存缓存和 Redis 缓存的无缝切换
 */

import { cacheService as memoryCacheService } from './CacheService.js';
import { getRedisService } from './RedisService.js';
import Logger from '../logging/Logger.js';

export class UnifiedCacheAdapter {
  constructor(options = {}) {
    this.mode = options.mode || process.env.CACHE_MODE || 'memory'; // 'memory' | 'redis'
    this.fallbackToMemory = options.fallbackToMemory !== false;
    this.redisService = null;
    this.memoryService = memoryCacheService;

    Logger.info(`缓存模式: ${this.mode}${this.fallbackToMemory ? ' (支持降级到内存)' : ''}`);
  }

  /**
   * 初始化缓存服务
   */
  async initialize() {
    if (this.mode === 'redis') {
      try {
        this.redisService = getRedisService();
        const health = await this.redisService.healthCheck();
        if (!health.healthy) {
          throw new Error(health.message);
        }
        Logger.info('✅ Redis 缓存已启用');
      } catch (error) {
        Logger.error('Redis 初始化失败:', { error: error.message });
        if (this.fallbackToMemory) {
          Logger.warn('⚠️  降级为内存缓存模式');
          this.mode = 'memory';
        } else {
          throw error;
        }
      }
    } else {
      Logger.info('✅ 内存缓存已启用');
    }
  }

  /**
   * 获取当前活动的缓存服务
   */
  _getActiveService() {
    if (this.mode === 'redis' && this.redisService && this.redisService.isConnected) {
      return this.redisService;
    }

    // memory 模式下直接返回内存服务，或 redis 回退到内存
    if (this.mode === 'memory' || this.fallbackToMemory) {
      return this.memoryService;
    }

    return null;
  }

  /**
   * 获取缓存值
   */
  async get(key) {
    const service = this._getActiveService();
    if (!service) return null;

    try {
      if (this.mode === 'redis') {
        return await service.get(key);
      } else {
        return service.get(key);
      }
    } catch (error) {
      Logger.error(`缓存获取失败 (${key}):`, { error: error.message });
      return null;
    }
  }

  /**
   * 设置缓存值
   */
  async set(key, value, ttlSeconds = 300) {
    const service = this._getActiveService();
    if (!service) return false;

    try {
      if (this.mode === 'redis') {
        return await service.set(key, value, ttlSeconds);
      } else {
        service.set(key, value, ttlSeconds);
        return true;
      }
    } catch (error) {
      Logger.error(`缓存设置失败 (${key}):`, { error: error.message });
      return false;
    }
  }

  /**
   * 删除缓存
   */
  async delete(key) {
    const service = this._getActiveService();
    if (!service) return false;

    try {
      if (this.mode === 'redis') {
        return await service.delete(key);
      } else {
        return service.delete(key);
      }
    } catch (error) {
      Logger.error(`缓存删除失败 (${key}):`, { error: error.message });
      return false;
    }
  }

  /**
   * 清空所有缓存
   */
  async clear() {
    const service = this._getActiveService();
    if (!service) return false;

    try {
      if (this.mode === 'redis') {
        return await service.clear();
      } else {
        service.clear();
        return true;
      }
    } catch (error) {
      Logger.error('缓存清空失败:', { error: error.message });
      return false;
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const service = this._getActiveService();
    if (!service) {
      return { mode: this.mode, available: false };
    }

    const stats = service.getStats();
    return { mode: this.mode, available: true, ...stats };
  }

  /**
   * 健康检查
   */
  async healthCheck() {
    const service = this._getActiveService();
    if (!service) {
      return { healthy: false, mode: this.mode, message: '缓存服务不可用' };
    }

    try {
      if (this.mode === 'redis') {
        const health = await service.healthCheck();
        return { ...health, mode: 'redis' };
      } else {
        return { healthy: true, mode: 'memory', message: '内存缓存运行正常' };
      }
    } catch (error) {
      return { healthy: false, mode: this.mode, message: error.message };
    }
  }
}

// 单例实例
let cacheAdapterInstance = null;

/**
 * 初始化统一缓存适配器
 */
export async function initCacheAdapter(options) {
  if (cacheAdapterInstance) {
    Logger.warn('缓存适配器已初始化');
    return cacheAdapterInstance;
  }

  cacheAdapterInstance = new UnifiedCacheAdapter(options);
  await cacheAdapterInstance.initialize();
  return cacheAdapterInstance;
}

/**
 * 获取缓存适配器实例
 */
export function getCacheAdapter() {
  if (!cacheAdapterInstance) {
    throw new Error('缓存适配器未初始化，请先调用 initCacheAdapter()');
  }
  return cacheAdapterInstance;
}

export default UnifiedCacheAdapter;
