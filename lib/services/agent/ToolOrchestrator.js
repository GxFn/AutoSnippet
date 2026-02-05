/**
 * ToolOrchestrator - 工具编排引擎
 * 管理复杂的工具链式调用、参数映射、依赖关系、错误恢复
 * 
 * 设计特点：
 * 1. 工具管道定义（DAG 有向无环图）
 * 2. 自动参数映射与类型转换
 * 3. 依赖关系管理
 * 4. 并行执行优化
 * 5. 错误恢复和重试
 * 6. 审计日志
 */

class ToolOrchestrator {
  constructor(toolRegistry, logger) {
  this.toolRegistry = toolRegistry;
  this.logger = logger;

  this.pipelines = new Map(); // pipelineId -> { definition, graph, stats }
  this.executionHistory = [];
  this.maxHistorySize = 1000;

  this.stats = {
    totalPipelines: 0,
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    totalExecutionTime: 0,
    averageExecutionTime: 0,
  };
  }

  /**
   * 定义一个工具管道
   * @param {string} pipelineId 管道 ID
   * @param {Array} toolSequence 工具序列
   * @example
   * definePipeline('analyze-code', [
   *   {
   *     toolId: 'code-analysis',
   *     name: 'analyze',
   *     params: { code: 'input:code' },
   *     errorStrategy: 'continue' // or 'fail'
   *   },
   *   {
   *     toolId: 'code-analysis',
   *     name: 'check-quality',
   *     params: { result: 'analyze:result' }, // 引用前面的输出
   *     dependsOn: ['analyze'],
   *     retries: 3,
   *     retryDelay: 1000
   *   }
   * ])
   */
  definePipeline(pipelineId, toolSequence) {
  if (!pipelineId || !Array.isArray(toolSequence) || toolSequence.length === 0) {
    throw new Error('Pipeline ID and non-empty tool sequence required');
  }

  // 验证工具序列
  const toolIds = new Set();
  toolSequence.forEach((tool, index) => {
    if (!tool.toolId) {
    throw new Error(`Tool at index ${index}: toolId required`);
    }
    if (!tool.name) {
    throw new Error(`Tool at index ${index}: name required`);
    }
    toolIds.add(tool.name);
  });

  // 构建依赖图
  const graph = this._buildDependencyGraph(toolSequence);

  this.pipelines.set(pipelineId, {
    id: pipelineId,
    toolSequence,
    graph,
    createdAt: new Date(),
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    totalExecutionTime: 0,
  });

  this.stats.totalPipelines += 1;
  this.logger.info(`Pipeline defined: ${pipelineId} with ${toolSequence.length} tools`);
  return this;
  }

  /**
   * 执行管道
   * @param {string} pipelineId 管道 ID
   * @param {Object} inputs 输入参数
   * @param {Object} options 执行选项
   */
  async execute(pipelineId, inputs = {}, options = {}) {
  const pipeline = this.pipelines.get(pipelineId);
  if (!pipeline) {
    throw new Error(`Pipeline not found: ${pipelineId}`);
  }

  const startTime = Date.now();
  const context = {
    _pipelineId: pipelineId,
    _executionPath: [],
    _results: {},
    _inputs: inputs,
    ...inputs, // 展开输入参数
  };

  try {
    // 根据依赖图进行执行（支持并行）
    const executionOrder = this._getExecutionOrder(pipeline.graph);

    for (const phase of executionOrder) {
    // 同一阶段的工具可以并行执行
    const phasePromises = phase.map(toolName =>
      this._executeTool(pipeline, toolName, context, options)
    );

    const phaseResults = await Promise.all(phasePromises);

    // 将结果合并到上下文
    phaseResults.forEach(result => {
      if (result.success) {
      context._results[result.toolName] = result.output;
      context[result.toolName] = result.output;
      } else {
      context._results[result.toolName] = { error: result.error };
      }
    });
    }

    // 管道执行成功
    const executionTime = Date.now() - startTime;
    pipeline.executionCount += 1;
    pipeline.successCount += 1;
    pipeline.totalExecutionTime += executionTime;

    this.stats.totalExecutions += 1;
    this.stats.successfulExecutions += 1;
    this.stats.totalExecutionTime += executionTime;
    this.stats.averageExecutionTime = 
    this.stats.totalExecutionTime / this.stats.totalExecutions;

    const result = {
    success: true,
    pipelineId,
    outputs: context._results,
    context,
    executionPath: context._executionPath,
    executionTime,
    timestamp: new Date(),
    };

    this._recordExecution(result);
    this.logger.info(`Pipeline executed successfully: ${pipelineId} (${executionTime}ms)`);

    return result;
  } catch (error) {
    // 管道执行失败
    const executionTime = Date.now() - startTime;
    pipeline.executionCount += 1;
    pipeline.failureCount += 1;
    pipeline.totalExecutionTime += executionTime;

    this.stats.totalExecutions += 1;
    this.stats.failedExecutions += 1;
    this.stats.totalExecutionTime += executionTime;
    this.stats.averageExecutionTime =
    this.stats.totalExecutionTime / this.stats.totalExecutions;

    const result = {
    success: false,
    pipelineId,
    error: error.message,
    context,
    executionPath: context._executionPath,
    executionTime,
    timestamp: new Date(),
    };

    this._recordExecution(result);
    this.logger.error(`Pipeline execution failed: ${pipelineId} - ${error.message}`);

    if (!options.continueOnError) {
    throw error;
    }
    return result;
  }
  }

  /**
   * 执行单个工具
   */
  async _executeTool(pipeline, toolName, context, options) {
  const toolDef = pipeline.toolSequence.find(t => t.name === toolName);
  if (!toolDef) {
    return {
    success: false,
    toolName,
    error: `Tool definition not found: ${toolName}`,
    };
  }

  let lastError = null;
  const retries = toolDef.retries || 1;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
    // 构建工具参数
    const params = this._resolveParameters(toolDef.params, context);

    // 获取工具并执行
    const tool = await this.toolRegistry.getInstance(toolDef.toolId);
    if (!tool) {
      throw new Error(`Tool not found: ${toolDef.toolId}`);
    }

    // 记录执行步骤
    context._executionPath.push({
      toolName,
      toolId: toolDef.toolId,
      attempt: attempt + 1,
      timestamp: new Date(),
      status: 'executing',
      params: this._sanitizeParams(params),
    });

    const output = await tool.execute(params);

    // 更新执行步骤状态
    const lastStep = context._executionPath[context._executionPath.length - 1];
    lastStep.status = 'success';
    lastStep.output = this._sanitizeOutput(output);

    this.logger.debug(`Tool executed: ${toolName} (${toolDef.toolId})`);

    return {
      success: true,
      toolName,
      output,
    };
    } catch (error) {
    lastError = error;
    
    // 记录失败
    const lastStep = context._executionPath[context._executionPath.length - 1];
    if (lastStep && lastStep.status === 'executing') {
      lastStep.status = 'failed';
      lastStep.error = error.message;
    }

    this.logger.warn(
      `Tool execution failed (attempt ${attempt + 1}/${retries}): ${toolName} - ${error.message}`
    );

    // 等待后重试
    if (attempt < retries - 1 && toolDef.retryDelay) {
      await new Promise(resolve => setTimeout(resolve, toolDef.retryDelay));
    }
    }
  }

  // 所有重试都失败了
  const errorStrategy = toolDef.errorStrategy || 'fail';
  if (errorStrategy === 'fail') {
    throw new Error(`Tool ${toolName} failed after ${retries} attempts: ${lastError.message}`);
  }

  return {
    success: false,
    toolName,
    error: lastError.message,
  };
  }

  /**
   * 解析参数（支持引用）
   * 例如: { code: 'input:code' } 或 { result: 'analyze:result' }
   */
  _resolveParameters(params, context) {
  if (!params) return {};

  const resolved = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.includes(':')) {
    const [source, path] = value.split(':', 2);
    
    if (source === 'input') {
      // 从输入获取
      resolved[key] = this._getNestedValue(context._inputs, path);
    } else {
      // 从前一个工具的结果获取
      const prevResult = context._results[source];
      resolved[key] = this._getNestedValue(prevResult, path);
    }
    } else if (typeof value === 'function') {
    // 支持函数计算
    resolved[key] = value(context);
    } else {
    resolved[key] = value;
    }
  }

  return resolved;
  }

  /**
   * 获取嵌套值
   */
  _getNestedValue(obj, path) {
  if (!obj || !path) return obj;
  return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * 构建依赖图
   */
  _buildDependencyGraph(toolSequence) {
  const graph = new Map();

  toolSequence.forEach((tool, index) => {
    const deps = tool.dependsOn || [];
    graph.set(tool.name, {
    index,
    dependencies: deps,
    tool,
    });
  });

  return graph;
  }

  /**
   * 获取执行顺序（拓扑排序）
   * 返回执行阶段数组，支持同阶段并行
   */
  _getExecutionOrder(graph) {
  const order = [];
  const visited = new Set();
  const visiting = new Set();

  const visit = (nodeName) => {
    if (visited.has(nodeName)) return [];
    if (visiting.has(nodeName)) {
    throw new Error(`Circular dependency detected: ${nodeName}`);
    }

    visiting.add(nodeName);
    const node = graph.get(nodeName);

    // 递归访问依赖
    node.dependencies.forEach(dep => {
    if (!visited.has(dep)) {
      visit(dep);
    }
    });

    visiting.delete(nodeName);
    visited.add(nodeName);

    return [nodeName];
  };

  // 按照源顺序执行拓扑排序
  const toolNames = Array.from(graph.keys());
  const sortedNames = [];

  toolNames.forEach(name => {
    if (!visited.has(name)) {
    sortedNames.push(...visit(name));
    }
  });

  // 将排序结果分组成执行阶段（同一阶段无依赖关系）
  const phases = [];
  const nodeDepth = new Map();

  for (const nodeName of sortedNames) {
    const node = graph.get(nodeName);
    let depth = 0;
    node.dependencies.forEach(dep => {
    depth = Math.max(depth, (nodeDepth.get(dep) || 0) + 1);
    });
    nodeDepth.set(nodeName, depth);

    if (!phases[depth]) {
    phases[depth] = [];
    }
    phases[depth].push(nodeName);
  }

  return phases.filter(Boolean);
  }

  /**
   * 记录执行历史
   */
  _recordExecution(result) {
  this.executionHistory.push({
    ...result,
    _timestamp: Date.now(),
  });

  // 保持历史大小
  if (this.executionHistory.length > this.maxHistorySize) {
    this.executionHistory.shift();
  }
  }

  /**
   * 清理敏感信息
   */
  _sanitizeParams(params) {
  // 移除密钥等敏感信息
  const sanitized = { ...params };
  const sensitiveKeys = ['password', 'token', 'secret', 'key'];
  Object.keys(sanitized).forEach(key => {
    if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
    sanitized[key] = '[REDACTED]';
    }
  });
  return sanitized;
  }

  /**
   * 清理输出
   */
  _sanitizeOutput(output) {
  if (typeof output !== 'object' || !output) return output;
  const sanitized = { ...output };
  const sensitiveKeys = ['password', 'token', 'secret', 'key'];
  Object.keys(sanitized).forEach(key => {
    if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
    sanitized[key] = '[REDACTED]';
    }
  });
  return sanitized;
  }

  /**
   * 列出所有管道
   */
  listPipelines() {
  return Array.from(this.pipelines.values()).map(p => ({
    id: p.id,
    toolCount: p.toolSequence.length,
    executionCount: p.executionCount,
    successCount: p.successCount,
    failureCount: p.failureCount,
    successRate: p.executionCount > 0
    ? (p.successCount / p.executionCount * 100).toFixed(2) + '%'
    : 'N/A',
    averageExecutionTime: p.executionCount > 0
    ? (p.totalExecutionTime / p.executionCount).toFixed(0) + 'ms'
    : 'N/A',
  }));
  }

  /**
   * 获取执行历史
   */
  getExecutionHistory(pipelineId = null, limit = 10) {
  let history = this.executionHistory;

  if (pipelineId) {
    history = history.filter(h => h.pipelineId === pipelineId);
  }

  return history.slice(-limit);
  }

  /**
   * 获取统计信息
   */
  getStats() {
  return {
    ...this.stats,
    successRate: this.stats.totalExecutions > 0
    ? (this.stats.successfulExecutions / this.stats.totalExecutions * 100).toFixed(2) + '%'
    : 'N/A',
    pipelines: this.listPipelines(),
  };
  }

  /**
   * 删除管道
   */
  deletePipeline(pipelineId) {
  return this.pipelines.delete(pipelineId);
  }

  /**
   * 清理
   */
  clear() {
  this.pipelines.clear();
  this.executionHistory = [];
  this.logger.info('ToolOrchestrator cleared');
  }
}

module.exports = ToolOrchestrator;
