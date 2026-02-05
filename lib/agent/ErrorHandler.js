/**
 * ErrorHandler - 生产级错误处理和恢复系统
 * 
 * 职责：
 * - 错误分类和诊断
 * - 降级策略管理
 * - 错误恢复和重试
 * - 详细的错误日志和追踪
 */

const EventEmitter = require('events');

class ErrorHandler extends EventEmitter {
  constructor(options = {}) {
  super();
  this.name = 'ErrorHandler';
  this.version = '1.0.0';

  // 配置
  this.config = {
    maxRetries: options.maxRetries || 3,
    retryDelay: options.retryDelay || 100,
    fallbackAgent: options.fallbackAgent || 'search',
    enableLogging: options.enableLogging !== false,
    trackingEnabled: options.trackingEnabled !== false,
    ...options
  };

  this.logger = options.logger || console;

  // 错误分类定义
  this.errorTypes = {
    TIMEOUT: { code: 'TIMEOUT', severity: 'medium', retryable: true },
    NOT_FOUND: { code: 'NOT_FOUND', severity: 'low', retryable: false },
    INVALID_INPUT: { code: 'INVALID_INPUT', severity: 'low', retryable: false },
    AGENT_ERROR: { code: 'AGENT_ERROR', severity: 'medium', retryable: true },
    SYSTEM_ERROR: { code: 'SYSTEM_ERROR', severity: 'high', retryable: true },
    DEPENDENCY_MISSING: { code: 'DEPENDENCY_MISSING', severity: 'high', retryable: false }
  };

  // 错误统计
  this.stats = {
    totalErrors: 0,
    errorsByType: {},
    errorsByAgent: {},
    recoveredCount: 0,
    fallbackCount: 0,
    avgRecoveryTime: 0
  };

  // 错误历史记录
  this.errorHistory = [];
  this.maxHistory = 100;
  }

  /**
   * 处理 Agent 执行的错误
   * @param {Error} error - 捕获的错误
   * @param {Object} context - 执行上下文
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object>} 恢复结果或降级结果
   */
  async handle(error, context, agentId) {
  const startTime = Date.now();
  const errorId = this._generateErrorId();

  try {
    // 1. 分类错误
    const errorInfo = this._classifyError(error, agentId);
    this._recordError(errorInfo);

    if (this.config.enableLogging) {
    this.logger.warn(`[ErrorHandler] Error #${errorId} in ${agentId}:`, {
      type: errorInfo.type,
      severity: errorInfo.severity,
      message: error.message
    });
    }

    // 2. 检查是否可重试
    if (errorInfo.retryable && context.retryCount < this.config.maxRetries) {
    const retryResult = await this._retryExecution(error, context, agentId);
    if (retryResult.success) {
      this.stats.recoveredCount++;
      this.emit('error_recovered', { errorId, agentId, retryCount: context.retryCount });
      return { success: true, result: retryResult.result, recovered: true };
    }
    }

    // 3. 使用降级策略
    const fallbackResult = await this._executeFallback(error, context, agentId);
    this.stats.fallbackCount++;
    
    const recoveryTime = Date.now() - startTime;
    const avgTime = this.stats.avgRecoveryTime * 
           (this.stats.totalErrors - 1) / this.stats.totalErrors + 
           recoveryTime / this.stats.totalErrors;
    this.stats.avgRecoveryTime = avgTime;

    this.emit('fallback_executed', { 
    errorId, 
    agent: agentId, 
    fallback: fallbackResult.agent,
    recoveryTime 
    });

    return {
    success: fallbackResult.success,
    result: fallbackResult.result,
    recovered: false,
    fallbackAgent: fallbackResult.agent,
    originalError: errorInfo
    };

  } catch (recoveryError) {
    if (this.config.enableLogging) {
    this.logger.error(`[ErrorHandler] Recovery failed for #${errorId}:`, recoveryError.message);
    }

    this.emit('recovery_failed', {
    errorId,
    agentId,
    originalError: error,
    recoveryError
    });

    return {
    success: false,
    result: null,
    recovered: false,
    error: recoveryError,
    originalError: error
    };
  }
  }

  /**
   * 分类错误
   * @private
   */
  _classifyError(error, agentId) {
  const message = error.message || '';
  const type = error.code || error.constructor.name;

  let errorType = this.errorTypes.SYSTEM_ERROR;
  let reason = '';

  // 基于消息内容分类
  if (message.includes('timeout') || message.includes('Timeout')) {
    errorType = this.errorTypes.TIMEOUT;
    reason = 'Agent execution exceeded timeout';
  } else if (message.includes('not found') || message.includes('undefined')) {
    errorType = this.errorTypes.NOT_FOUND;
    reason = 'Required data or dependency not found';
  } else if (message.includes('invalid') || message.includes('required')) {
    errorType = this.errorTypes.INVALID_INPUT;
    reason = 'Input validation failed';
  } else if (message.includes('Missing required')) {
    errorType = this.errorTypes.INVALID_INPUT;
    reason = 'Missing required parameter';
  } else if (message.includes('dependency') || message.includes('connect')) {
    errorType = this.errorTypes.DEPENDENCY_MISSING;
    reason = 'External dependency not available';
  } else if (message.includes('Error') || message.includes('error')) {
    errorType = this.errorTypes.AGENT_ERROR;
    reason = 'Agent execution error';
  }

  return {
    id: this._generateErrorId(),
    type: errorType.code,
    code: type,
    severity: errorType.severity,
    retryable: errorType.retryable,
    agentId,
    message: error.message,
    reason,
    stack: error.stack,
    timestamp: new Date().toISOString()
  };
  }

  /**
   * 重试执行
   * @private
   */
  async _retryExecution(error, context, agentId) {
  const delayMs = this.config.retryDelay * Math.pow(2, context.retryCount);
  
  // 等待指数退避延迟
  await new Promise(resolve => setTimeout(resolve, delayMs));

  try {
    // 获取 Agent 并重新执行
    const agent = context.agentCoordinator?.agents?.get(agentId);
    if (!agent) {
    throw new Error(`Agent ${agentId} not found for retry`);
    }

    // 增加重试计数
    context.retryCount = (context.retryCount || 0) + 1;

    const result = await agent.execute(context);
    return { success: true, result };

  } catch (retryError) {
    return { success: false, result: null, error: retryError };
  }
  }

  /**
   * 执行降级策略
   * @private
   */
  async _executeFallback(error, context, agentId) {
  // 对于不同的 Agent，使用不同的降级策略
  const fallbackStrategies = {
    lint: ['search', 'learn'],
    generate: ['search', 'learn'],
    search: ['learn', 'lint'],
    learn: ['search']
  };

  const candidates = fallbackStrategies[agentId] || [this.config.fallbackAgent];

  for (const fallbackAgentId of candidates) {
    try {
    const fallbackAgent = context.agentCoordinator?.agents?.get(fallbackAgentId);
    if (!fallbackAgent) continue;

    // 映射上下文到降级Agent
    const fallbackContext = this._mapContextForFallback(context, agentId, fallbackAgentId);
    const result = await fallbackAgent.execute(fallbackContext);

    if (result && result.success !== false) {
      return {
      success: true,
      result,
      agent: fallbackAgentId
      };
    }
    } catch (fallbackError) {
    // 继续尝试下一个降级 Agent
    continue;
    }
  }

  // 所有降级都失败
  return {
    success: false,
    result: null,
    agent: null
  };
  }

  /**
   * 为降级 Agent 映射上下文
   * @private
   */
  _mapContextForFallback(context, originalAgent, fallbackAgent) {
  const mapped = { ...context };

  // 根据原始 Agent 和目标 Agent 进行映射
  if (originalAgent === 'lint' && fallbackAgent === 'search') {
    // lint → search: 转换为搜索查询
    mapped.query = `fix ${context.userInput}`;
    mapped.type = 'general';
  } else if (originalAgent === 'generate' && fallbackAgent === 'search') {
    // generate → search: 搜索类似代码
    mapped.query = context.requirement || context.userInput;
    mapped.type = 'snippet';
  } else if (originalAgent === 'generate' && fallbackAgent === 'learn') {
    // generate → learn: 学习相关概念
    const topic = this._extractTopicFromRequirement(context.requirement);
    mapped.topic = topic;
    mapped.type = 'explain';
  }

  return mapped;
  }

  /**
   * 从需求中提取主题
   * @private
   */
  _extractTopicFromRequirement(requirement) {
  if (!requirement) return 'programming';

  const topics = ['async', 'promise', 'error', 'function', 'class', 'array', 'object'];
  for (const topic of topics) {
    if (requirement.toLowerCase().includes(topic)) {
    return topic;
    }
  }

  return 'programming';
  }

  /**
   * 记录错误
   * @private
   */
  _recordError(errorInfo) {
  this.stats.totalErrors++;

  // 按类型统计 - 使用错误类型代码（TIMEOUT 等）
  const errorTypeCode = errorInfo.type;
  if (!this.stats.errorsByType[errorTypeCode]) {
    this.stats.errorsByType[errorTypeCode] = 0;
  }
  this.stats.errorsByType[errorTypeCode]++;

  // 按 Agent 统计
  if (!this.stats.errorsByAgent[errorInfo.agentId]) {
    this.stats.errorsByAgent[errorInfo.agentId] = 0;
  }
  this.stats.errorsByAgent[errorInfo.agentId]++;

  // 保存到历史记录
  this.errorHistory.push(errorInfo);
  if (this.errorHistory.length > this.maxHistory) {
    this.errorHistory.shift();
  }
  }

  /**
   * 生成错误 ID
   * @private
   */
  _generateErrorId() {
  return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取错误统计
   */
  getStatistics() {
  const successRate = this.stats.totalErrors > 0
    ? ((this.stats.recoveredCount + this.stats.fallbackCount) / this.stats.totalErrors * 100).toFixed(1)
    : 0;

  return {
    totalErrors: this.stats.totalErrors,
    errorsByType: this.stats.errorsByType,
    errorsByAgent: this.stats.errorsByAgent,
    recoveredCount: this.stats.recoveredCount,
    fallbackCount: this.stats.fallbackCount,
    successRate: `${successRate}%`,
    avgRecoveryTime: this.stats.avgRecoveryTime.toFixed(2),
    recentErrors: this.errorHistory.slice(-10)
  };
  }

  /**
   * 获取错误历史
   */
  getErrorHistory(limit = 20) {
  return this.errorHistory.slice(-limit).reverse();
  }

  /**
   * 重置统计
   */
  resetStatistics() {
  this.stats = {
    totalErrors: 0,
    errorsByType: {},
    errorsByAgent: {},
    recoveredCount: 0,
    fallbackCount: 0,
    avgRecoveryTime: 0
  };
  this.errorHistory = [];
  }
}

module.exports = ErrorHandler;
