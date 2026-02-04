/**
 * AgentPool - Agent 代理池
 * 管理 Agent 的生命周期，提供动态分配、负载均衡、资源回收
 * 
 * 设计特点：
 * 1. 连接池模式（初始化、可用、忙碌、已关闭状态）
 * 2. 负载均衡（最少连接、轮询）
 * 3. 自动扩缩容
 * 4. 空闲回收
 * 5. 监控和指标
 */

class AgentPool {
  constructor(agentManager, logger, options = {}) {
    this.agentManager = agentManager;
    this.logger = logger;

    // 配置参数
    this.config = {
      minSize: options.minSize || 2,
      maxSize: options.maxSize || 10,
      idleTimeout: options.idleTimeout || 30000, // 30秒
      acquireTimeout: options.acquireTimeout || 5000,
      balancingStrategy: options.balancingStrategy || 'least-connections', // least-connections, round-robin
    };

    // 池状态
    this.pools = new Map(); // agentId -> { available: [], busy: [], metadata: {} }
    this.stats = {
      totalCreated: 0,
      totalDestroyed: 0,
      totalAcquired: 0,
      totalReleased: 0,
      peakPoolSize: 0,
      totalWaitTime: 0,
      totalWaits: 0,
    };
    this.roundRobinIndex = new Map();
    this.cleanupInterval = null;
  }

  /**
   * 初始化代理池（预热）
   */
  async initialize(agentIds) {
    if (!Array.isArray(agentIds) || agentIds.length === 0) {
      throw new Error('Agent IDs array required');
    }

    this.logger.info(`Initializing agent pool with ${agentIds.length} agent types`);

    try {
      for (const agentId of agentIds) {
        // 初始化最小数量的实例
        const instances = [];
        for (let i = 0; i < this.config.minSize; i++) {
          const instance = await this.agentManager.getInstance(agentId);
          if (!instance) {
            throw new Error(`Failed to create agent instance: ${agentId}`);
          }
          instances.push({
            instance,
            instanceId: `${agentId}_${i}_${Date.now()}`,
            createdAt: new Date(),
            lastUsedAt: new Date(),
            usageCount: 0,
            state: 'available',
          });
          this.stats.totalCreated += 1;
        }

        this.pools.set(agentId, {
          available: instances,
          busy: [],
          metadata: {
            agentId,
            totalInstances: this.config.minSize,
            requestsWaiting: 0,
          },
        });

        this.roundRobinIndex.set(agentId, 0);
        this.logger.debug(`Pool initialized for ${agentId}: ${instances.length} instances`);
      }

      // 启动清理任务
      this._startCleanupTask();
      this.logger.info('Agent pool initialized successfully');
    } catch (error) {
      this.logger.error(`Pool initialization failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取一个可用的 Agent 实例（从池中）
   * @param {string} agentId Agent ID
   * @returns {Promise<Object>} { instance, releaseHandle }
   */
  async acquire(agentId, timeout = null) {
    const deadline = timeout || this.config.acquireTimeout;
    const startTime = Date.now();

    const pool = this.pools.get(agentId);
    if (!pool) {
      throw new Error(`Agent pool not found: ${agentId}`);
    }

    let instance = null;

    // 轮询获取可用实例
    while (!instance && Date.now() - startTime < deadline) {
      const strategy = this.config.balancingStrategy;

      if (pool.available.length > 0) {
        // 使用指定的负载均衡策略获取实例
        if (strategy === 'least-connections') {
          instance = this._getLeastLoadedInstance(pool);
        } else if (strategy === 'round-robin') {
          instance = this._getRoundRobinInstance(pool, agentId);
        } else {
          instance = pool.available.shift();
        }

        if (instance) {
          instance.state = 'busy';
          pool.busy.push(instance);
          instance.usageCount += 1;
          instance.lastUsedAt = new Date();

          this.stats.totalAcquired += 1;
          this.logger.debug(`Agent acquired: ${agentId} (${instance.instanceId})`);

          // 返回实例和释放句柄
          return {
            instance: instance.instance,
            instanceId: instance.instanceId,
            release: () => this.release(agentId, instance.instanceId),
          };
        }
      }

      // 尝试创建新实例（如果未达到最大值）
      if (pool.metadata.totalInstances < this.config.maxSize) {
        try {
          const newInstance = await this.agentManager.getInstance(agentId);
          const wrapper = {
            instance: newInstance,
            instanceId: `${agentId}_${pool.metadata.totalInstances}_${Date.now()}`,
            createdAt: new Date(),
            lastUsedAt: new Date(),
            usageCount: 1,
            state: 'busy',
          };
          pool.busy.push(wrapper);
          pool.metadata.totalInstances += 1;
          this.stats.totalCreated += 1;
          this.stats.peakPoolSize = Math.max(
            this.stats.peakPoolSize,
            pool.metadata.totalInstances
          );

          this.logger.debug(`New agent instance created: ${wrapper.instanceId}`);

          return {
            instance: newInstance,
            instanceId: wrapper.instanceId,
            release: () => this.release(agentId, wrapper.instanceId),
          };
        } catch (error) {
          this.logger.warn(`Failed to create new instance: ${error.message}`);
        }
      }

      // 等待一小段时间后重试
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const waitTime = Date.now() - startTime;
    this.stats.totalWaitTime += waitTime;
    this.stats.totalWaits += 1;

    throw new Error(
      `Failed to acquire agent instance within ${deadline}ms (waited ${waitTime}ms): ${agentId}`
    );
  }

  /**
   * 释放一个 Agent 实例回池中
   */
  release(agentId, instanceId) {
    const pool = this.pools.get(agentId);
    if (!pool) {
      this.logger.warn(`Pool not found for release: ${agentId}`);
      return;
    }

    const busyIndex = pool.busy.findIndex(item => item.instanceId === instanceId);
    if (busyIndex >= 0) {
      const instance = pool.busy.splice(busyIndex, 1)[0];
      instance.state = 'available';
      pool.available.push(instance);
      this.stats.totalReleased += 1;
      this.logger.debug(`Agent released: ${agentId} (${instanceId})`);
    }
  }

  /**
   * 获取最少加载的实例
   */
  _getLeastLoadedInstance(pool) {
    if (pool.available.length === 0) return null;
    // 优先返回最近使用时间最早的实例
    return pool.available.sort((a, b) => 
      a.lastUsedAt - b.lastUsedAt
    ).shift();
  }

  /**
   * 轮询获取实例
   */
  _getRoundRobinInstance(pool, agentId) {
    if (pool.available.length === 0) return null;
    let index = this.roundRobinIndex.get(agentId) || 0;
    const instance = pool.available[index % pool.available.length];
    this.roundRobinIndex.set(agentId, (index + 1) % pool.available.length);
    return pool.available.splice(index % pool.available.length, 1)[0];
  }

  /**
   * 启动清理任务（删除空闲实例）
   */
  _startCleanupTask() {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();

      for (const [agentId, pool] of this.pools.entries()) {
        const toRemove = pool.available.filter(item =>
          now - item.lastUsedAt.getTime() > this.config.idleTimeout &&
          pool.metadata.totalInstances > this.config.minSize
        );

        toRemove.forEach(item => {
          const index = pool.available.indexOf(item);
          if (index >= 0) {
            pool.available.splice(index, 1);
            pool.metadata.totalInstances -= 1;
            this.stats.totalDestroyed += 1;
            this.logger.debug(`Idle instance destroyed: ${item.instanceId}`);
          }
        });
      }
    }, this.config.idleTimeout / 2);
  }

  /**
   * 获取池统计信息
   */
  getStats() {
    const poolStats = {};

    for (const [agentId, pool] of this.pools.entries()) {
      poolStats[agentId] = {
        available: pool.available.length,
        busy: pool.busy.length,
        total: pool.metadata.totalInstances,
        utilization: pool.metadata.totalInstances > 0
          ? (pool.busy.length / pool.metadata.totalInstances * 100).toFixed(2) + '%'
          : '0%',
        requestsWaiting: pool.metadata.requestsWaiting,
        instances: {
          available: pool.available.map(item => ({
            instanceId: item.instanceId,
            usageCount: item.usageCount,
            lastUsedAt: item.lastUsedAt,
          })),
          busy: pool.busy.map(item => ({
            instanceId: item.instanceId,
            usageCount: item.usageCount,
            lastUsedAt: item.lastUsedAt,
          })),
        },
      };
    }

    return {
      config: this.config,
      pools: poolStats,
      globalStats: {
        ...this.stats,
        averageWaitTime: this.stats.totalWaits > 0
          ? (this.stats.totalWaitTime / this.stats.totalWaits).toFixed(2) + 'ms'
          : '0ms',
      },
    };
  }

  /**
   * 清理所有池
   */
  async close() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    for (const [agentId, pool] of this.pools.entries()) {
      for (const instance of pool.available) {
        try {
          if (instance.instance.close) {
            await instance.instance.close();
          }
        } catch (error) {
          this.logger.warn(`Error closing instance: ${error.message}`);
        }
      }

      for (const instance of pool.busy) {
        try {
          if (instance.instance.close) {
            await instance.instance.close();
          }
        } catch (error) {
          this.logger.warn(`Error closing instance: ${error.message}`);
        }
      }
    }

    this.pools.clear();
    this.logger.info('Agent pool closed');
  }
}

module.exports = AgentPool;
