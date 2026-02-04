/**
 * ChainManager - Agent 链式调用管理器
 * 负责协调多个 Agent 的顺序执行和上下文传递
 * 
 * 设计特点:
 * 1. 线性链式执行（顺序 Agent）
 * 2. 动态上下文继承和传递
 * 3. 条件跳转和错误恢复
 * 4. 执行历史和统计
 */

class ChainManager {
  constructor(agentManager, logger) {
    this.agentManager = agentManager;
    this.logger = logger;
    this.chains = new Map();
    this.stats = {
      totalChains: 0,
      successfulChains: 0,
      failedChains: 0,
      averageExecutionTime: 0,
      totalExecutionTime: 0,
    };
  }

  /**
   * 定义一个执行链
   * @param {string} chainId 链 ID
   * @param {Array} pipeline 执行管道数组
   * @example
   * defineChain('analyze-and-guard', [
   *   { agentId: 'code-agent', task: 'CODE_ANALYSIS', params: {} },
   *   { agentId: 'guard-agent', task: 'GUARD_CHECK', 
   *     params: (context) => ({ code: context.analysis.result }) },
   *   { agentId: 'recipe-agent', task: 'RECIPE_RECOMMEND',
   *     params: (context) => ({ issues: context.guard.violations }) }
   * ])
   */
  defineChain(chainId, pipeline) {
    if (!chainId || !Array.isArray(pipeline) || pipeline.length === 0) {
      throw new Error('Chain ID and non-empty pipeline required');
    }

    // 验证管道中的每一步
    pipeline.forEach((step, index) => {
      if (!step.agentId || !step.task) {
        throw new Error(`Pipeline step ${index}: agentId and task required`);
      }
    });

    this.chains.set(chainId, {
      id: chainId,
      pipeline,
      createdAt: new Date(),
      executionCount: 0,
      successCount: 0,
      failureCount: 0,
      lastExecutionTime: null,
    });

    this.logger.info(`Chain defined: ${chainId} with ${pipeline.length} steps`);
    return this;
  }

  /**
   * 执行链
   * @param {string} chainId 链 ID
   * @param {Object} initialContext 初始上下文
   * @param {Object} options 执行选项
   * @returns {Promise<Object>} 执行结果
   */
  async execute(chainId, initialContext = {}, options = {}) {
    const chain = this.chains.get(chainId);
    if (!chain) {
      throw new Error(`Chain not found: ${chainId}`);
    }

    const startTime = Date.now();
    const context = {
      ...initialContext,
      _chainId: chainId,
      _executionPath: [],
      _results: {},
    };

    try {
      // 执行管道中的每一步
      for (let i = 0; i < chain.pipeline.length; i++) {
        const step = chain.pipeline[i];
        const stepId = `${chainId}_step_${i}`;

        this.logger.debug(`Executing step ${i}: ${step.agentId}`);

        try {
          // 构建该步的参数
          const params = typeof step.params === 'function'
            ? step.params(context)
            : (step.params || {});

          // 获取 Agent 并执行任务
          const agent = await this.agentManager.getInstance(step.agentId);
          if (!agent) {
            throw new Error(`Agent not found: ${step.agentId}`);
          }

          const result = await agent.execute(step.task, params);

          // 记录执行路径和结果
          context._executionPath.push({
            stepIndex: i,
            agentId: step.agentId,
            task: step.task,
            status: 'success',
            timestamp: new Date(),
          });

          // 存储结果（用于后续步骤访问）
          context._results[step.agentId] = result;

          // 将结果添加到上下文
          const contextKey = step.contextKey || step.agentId.replace(/-/g, '_');
          context[contextKey] = result;

          this.logger.debug(
            `Step ${i} completed: ${step.agentId} -> ${result?.status || 'success'}`
          );

          // 检查是否需要终止链（可选的条件）
          if (step.shouldStop && step.shouldStop(result, context)) {
            this.logger.info(`Chain ${chainId} stopped at step ${i}`);
            break;
          }
        } catch (stepError) {
          // 记录失败的步骤
          context._executionPath.push({
            stepIndex: i,
            agentId: step.agentId,
            task: step.task,
            status: 'failed',
            error: stepError.message,
            timestamp: new Date(),
          });

          // 如果设置了 continueOnError，继续执行；否则抛出错误
          if (options.continueOnError) {
            this.logger.warn(`Step ${i} failed, continuing: ${stepError.message}`);
          } else {
            throw new Error(`Chain execution failed at step ${i}: ${stepError.message}`);
          }
        }
      }

      // 链执行成功
      const executionTime = Date.now() - startTime;
      chain.executionCount += 1;
      chain.successCount += 1;
      chain.lastExecutionTime = executionTime;

      this.stats.successfulChains += 1;
      this.stats.totalExecutionTime += executionTime;
      this.stats.averageExecutionTime = 
        this.stats.totalExecutionTime / (this.stats.successfulChains + this.stats.failedChains);

      this.logger.info(`Chain executed successfully: ${chainId} (${executionTime}ms)`);

      return {
        success: true,
        chainId,
        context,
        executionPath: context._executionPath,
        results: context._results,
        executionTime,
        timestamp: new Date(),
      };
    } catch (error) {
      // 链执行失败
      const executionTime = Date.now() - startTime;
      chain.executionCount += 1;
      chain.failureCount += 1;
      chain.lastExecutionTime = executionTime;

      this.stats.failedChains += 1;
      this.stats.totalExecutionTime += executionTime;
      this.stats.averageExecutionTime =
        this.stats.totalExecutionTime / (this.stats.successfulChains + this.stats.failedChains);

      this.logger.error(`Chain execution failed: ${chainId} - ${error.message}`);

      return {
        success: false,
        chainId,
        error: error.message,
        context,
        executionPath: context._executionPath,
        results: context._results,
        executionTime,
        timestamp: new Date(),
      };
    }
  }

  /**
   * 列出所有已定义的链
   */
  listChains() {
    return Array.from(this.chains.values()).map(chain => ({
      id: chain.id,
      steps: chain.pipeline.length,
      executionCount: chain.executionCount,
      successCount: chain.successCount,
      failureCount: chain.failureCount,
      successRate: chain.executionCount > 0 
        ? (chain.successCount / chain.executionCount * 100).toFixed(2) + '%'
        : 'N/A',
      createdAt: chain.createdAt,
      lastExecutionTime: chain.lastExecutionTime,
    }));
  }

  /**
   * 获取链信息
   */
  getChainInfo(chainId) {
    const chain = this.chains.get(chainId);
    if (!chain) {
      return null;
    }

    return {
      id: chain.id,
      pipeline: chain.pipeline.map((step, index) => ({
        index: index,
        agentId: step.agentId,
        task: step.task,
        hasParams: !!step.params,
        contextKey: step.contextKey || step.agentId.replace(/-/g, '_'),
      })),
      stats: {
        executionCount: chain.executionCount,
        successCount: chain.successCount,
        failureCount: chain.failureCount,
        successRate: chain.executionCount > 0 
          ? (chain.successCount / chain.executionCount * 100).toFixed(2)
          : null,
        lastExecutionTime: chain.lastExecutionTime,
      },
    };
  }

  /**
   * 删除链
   */
  deleteChain(chainId) {
    const result = this.chains.delete(chainId);
    if (result) {
      this.logger.info(`Chain deleted: ${chainId}`);
    }
    return result;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      totalChains: this.chains.size,
      chains: this.listChains(),
    };
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalChains: 0,
      successfulChains: 0,
      failedChains: 0,
      averageExecutionTime: 0,
      totalExecutionTime: 0,
    };
  }

  /**
   * 清理所有链
   */
  clear() {
    this.chains.clear();
    this.logger.info('All chains cleared');
  }
}

module.exports = ChainManager;
