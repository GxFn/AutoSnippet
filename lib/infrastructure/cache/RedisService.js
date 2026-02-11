/**
 * Redis 缓存服务
 * 提供 Redis 客户端封装，支持分布式缓存
 */

import { createClient } from 'redis';
import Logger from '../logging/Logger.js';

export class RedisService {
  constructor(config = {}) {
    this.config = {
      host: config.host || process.env.REDIS_HOST || 'localhost',
      port: parseInt(config.port || process.env.REDIS_PORT || 6379, 10),
      password: config.password || process.env.REDIS_PASSWORD,
      db: parseInt(config.db || process.env.REDIS_DB || 0, 10),
      keyPrefix: config.keyPrefix || 'asd:',
      retryStrategy: config.retryStrategy || this.defaultRetryStrategy.bind(this),
      connectTimeout: config.connectTimeout || 10000,
    };

    this.client = null;
    this.isConnected = false;
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
    };
  }

  /**
   * 默认重试策略
   */
  defaultRetryStrategy(retries) {
    if (retries > 10) {
      Logger.error('Redis 重连失败次数过多，停止重试');
      return new Error('Redis 重连失败');
    }
    const delay = Math.min(retries * 100, 3000);
    Logger.info(`Redis 重连中... (第 ${retries} 次，延迟 ${delay}ms)`);
    return delay;
  }

  /**
   * 连接到 Redis
   */
  async connect() {
    if (this.isConnected) {
      return;
    }

    try {
      this.client = createClient({
        socket: {
          host: this.config.host,
          port: this.config.port,
          connectTimeout: this.config.connectTimeout,
          reconnectStrategy: (retries) => this.config.retryStrategy(retries),
        },
        password: this.config.password || undefined,
        database: this.config.db,
      });

      this.client.on('error', (err) => {
        Logger.error('Redis 客户端错误:', { error: err.message });
        this.stats.errors++;
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        Logger.info(`Redis 连接成功: ${this.config.host}:${this.config.port}`);
      });

      this.client.on('ready', () => {
        Logger.info('Redis 客户端准备就绪');
        this.isConnected = true;
      });

      this.client.on('reconnecting', () => {
        Logger.warn('Redis 重新连接中...');
        this.isConnected = false;
      });

      this.client.on('end', () => {
        Logger.warn('Redis 连接已关闭');
        this.isConnected = false;
      });

      await this.client.connect();
      Logger.info('✅ Redis 服务已启动');
    } catch (error) {
      Logger.error('Redis 连接失败:', { error: error.message });
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * 生成完整键名
   */
  _getKey(key) {
    return `${this.config.keyPrefix}${key}`;
  }

  /**
   * 获取缓存值
   */
  async get(key) {
    if (!this.isConnected) {
      this.stats.misses++;
      return null;
    }

    try {
      const fullKey = this._getKey(key);
      const value = await this.client.get(fullKey);

      if (value === null) {
        this.stats.misses++;
        return null;
      }

      this.stats.hits++;
      return JSON.parse(value);
    } catch (error) {
      Logger.error(`Redis GET 失败 (${key}):`, { error: error.message });
      this.stats.errors++;
      this.stats.misses++;
      return null;
    }
  }

  /**
   * 设置缓存值
   */
  async set(key, value, ttlSeconds = 300) {
    if (!this.isConnected) {
      return false;
    }

    try {
      const fullKey = this._getKey(key);
      const serialized = JSON.stringify(value);

      if (ttlSeconds > 0) {
        await this.client.setEx(fullKey, ttlSeconds, serialized);
      } else {
        await this.client.set(fullKey, serialized);
      }

      this.stats.sets++;
      return true;
    } catch (error) {
      Logger.error(`Redis SET 失败 (${key}):`, { error: error.message });
      this.stats.errors++;
      return false;
    }
  }

  /**
   * 删除缓存
   */
  async delete(key) {
    if (!this.isConnected) {
      return false;
    }

    try {
      const fullKey = this._getKey(key);
      await this.client.del(fullKey);
      this.stats.deletes++;
      return true;
    } catch (error) {
      Logger.error(`Redis DEL 失败 (${key}):`, { error: error.message });
      this.stats.errors++;
      return false;
    }
  }

  /**
   * 批量删除（通配符，使用 SCAN）
   */
  async deletePattern(pattern) {
    if (!this.isConnected) {
      return 0;
    }

    try {
      const fullPattern = this._getKey(pattern);
      const keys = [];

      for await (const key of this.client.scanIterator({
        MATCH: fullPattern,
        COUNT: 100,
      })) {
        keys.push(key);
      }

      if (keys.length > 0) {
        await this.client.del(keys);
        this.stats.deletes += keys.length;
      }

      return keys.length;
    } catch (error) {
      Logger.error(`Redis 批量删除失败 (${pattern}):`, { error: error.message });
      this.stats.errors++;
      return 0;
    }
  }

  /**
   * 清空所有缓存
   */
  async clear() {
    if (!this.isConnected) {
      return false;
    }

    try {
      const deletedCount = await this.deletePattern('*');
      Logger.info(`Redis 缓存已清空 (${deletedCount} 个键)`);
      return true;
    } catch (error) {
      Logger.error('Redis 清空缓存失败:', { error: error.message });
      this.stats.errors++;
      return false;
    }
  }

  /**
   * 检查键是否存在
   */
  async exists(key) {
    if (!this.isConnected) {
      return false;
    }

    try {
      const fullKey = this._getKey(key);
      const result = await this.client.exists(fullKey);
      return result === 1;
    } catch (error) {
      Logger.error(`Redis EXISTS 失败 (${key}):`, { error: error.message });
      this.stats.errors++;
      return false;
    }
  }

  /**
   * 获取剩余 TTL
   */
  async ttl(key) {
    if (!this.isConnected) {
      return -1;
    }

    try {
      const fullKey = this._getKey(key);
      return await this.client.ttl(fullKey);
    } catch (error) {
      Logger.error(`Redis TTL 失败 (${key}):`, { error: error.message });
      this.stats.errors++;
      return -1;
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? (this.stats.hits / totalRequests) * 100 : 0;

    return {
      ...this.stats,
      totalRequests,
      hitRate: hitRate.toFixed(2) + '%',
      isConnected: this.isConnected,
      config: {
        host: this.config.host,
        port: this.config.port,
        db: this.config.db,
        keyPrefix: this.config.keyPrefix,
      },
    };
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = { hits: 0, misses: 0, sets: 0, deletes: 0, errors: 0 };
  }

  /**
   * 健康检查
   */
  async healthCheck() {
    if (!this.isConnected) {
      return { healthy: false, message: 'Redis 未连接' };
    }

    try {
      const testKey = this._getKey('health:check');
      await this.client.set(testKey, 'OK');
      const value = await this.client.get(testKey);
      await this.client.del(testKey);

      return {
        healthy: value === 'OK',
        message: 'Redis 健康检查通过',
      };
    } catch (error) {
      Logger.error('Redis 健康检查失败:', { error: error.message });
      return { healthy: false, message: error.message };
    }
  }

  /**
   * 断开连接
   */
  async disconnect() {
    if (this.client && this.isConnected) {
      try {
        await this.client.quit();
        Logger.info('Redis 连接已关闭');
      } catch (error) {
        Logger.error('Redis 断开连接失败:', { error: error.message });
        await this.client.disconnect();
      }
    }
    this.isConnected = false;
  }
}

// 单例实例
let redisServiceInstance = null;

/**
 * 初始化 Redis 服务
 */
export async function initRedisService(config) {
  if (redisServiceInstance) {
    Logger.warn('Redis 服务已初始化');
    return redisServiceInstance;
  }

  redisServiceInstance = new RedisService(config);
  await redisServiceInstance.connect();
  return redisServiceInstance;
}

/**
 * 获取 Redis 服务实例
 */
export function getRedisService() {
  if (!redisServiceInstance) {
    throw new Error('Redis 服务未初始化，请先调用 initRedisService()');
  }
  return redisServiceInstance;
}

export default RedisService;
