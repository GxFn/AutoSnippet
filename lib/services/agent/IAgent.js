/**
 * IAgent - Agent 接口定义
 * 
 * Agent 是具有特定能力的智能体，可以执行任务、使用工具、维护对话历史
 * Phase 5: Agent System
 */

/**
 * Agent 接口
 * 所有 Agent 必须实现此接口
 */
class IAgent {
  /**
   * 获取 Agent 信息
   * @returns {Object} Agent 信息
   * @returns {string} return.name - Agent 名称
   * @returns {string} return.description - Agent 描述
   * @returns {string} return.version - Agent 版本
   * @returns {Array<string>} return.capabilities - Agent 能力列表
   * @returns {Array<string>} return.tools - 支持的工具列表
   */
  getInfo() {
  throw new Error('Method getInfo() must be implemented');
  }

  /**
   * 初始化 Agent
   * @param {Object} [options] - 初始化选项
   * @returns {Promise<void>}
   */
  async initialize(options = {}) {
  throw new Error('Method initialize() must be implemented');
  }

  /**
   * 执行任务
   * @param {Object} task - 任务对象
   * @param {string} task.id - 任务 ID
   * @param {string} task.type - 任务类型
   * @param {string} task.instruction - 任务指令
   * @param {Object} [task.context] - 任务上下文
   * @param {Object} [options] - 执行选项
   * @returns {Promise<Object>} 执行结果
   * @returns {boolean} return.success - 是否成功
   * @returns {any} return.result - 执行结果
   * @returns {string} [return.error] - 错误信息
   * @returns {Array<Object>} [return.steps] - 执行步骤
   */
  async execute(task, options = {}) {
  throw new Error('Method execute() must be implemented');
  }

  /**
   * 处理用户消息（对话模式）
   * @param {string} message - 用户消息
   * @param {Object} [context] - 对话上下文
   * @param {string} [context.conversationId] - 对话 ID
   * @param {Array<Object>} [context.history] - 历史消息
   * @param {Object} [context.metadata] - 元数据
   * @returns {Promise<Object>} 响应
   * @returns {string} return.reply - 回复内容
   * @returns {Array<Object>} [return.toolCalls] - 工具调用记录
   * @returns {Object} [return.metadata] - 响应元数据
   */
  async chat(message, context = {}) {
  throw new Error('Method chat() must be implemented');
  }

  /**
   * 使用工具
   * @param {string} toolName - 工具名称
   * @param {Object} params - 工具参数
   * @returns {Promise<Object>} 工具执行结果
   */
  async useTool(toolName, params) {
  throw new Error('Method useTool() must be implemented');
  }

  /**
   * 获取可用工具列表
   * @returns {Array<string>} 工具名称列表
   */
  getAvailableTools() {
  throw new Error('Method getAvailableTools() must be implemented');
  }

  /**
   * 注册工具
   * @param {string} name - 工具名称
   * @param {ITool} tool - 工具实例
   * @returns {void}
   */
  registerTool(name, tool) {
  throw new Error('Method registerTool() must be implemented');
  }

  /**
   * 注销工具
   * @param {string} name - 工具名称
   * @returns {void}
   */
  unregisterTool(name) {
  throw new Error('Method unregisterTool() must be implemented');
  }

  /**
   * 获取 Agent 状态
   * @returns {Object} 状态信息
   * @returns {boolean} return.ready - 是否就绪
   * @returns {string} return.status - 状态描述
   * @returns {Object} return.stats - 统计信息
   */
  getStatus() {
  throw new Error('Method getStatus() must be implemented');
  }

  /**
   * 重置 Agent 状态
   * @returns {Promise<void>}
   */
  async reset() {
  throw new Error('Method reset() must be implemented');
  }

  /**
   * 关闭 Agent
   * @returns {Promise<void>}
   */
  async close() {
  throw new Error('Method close() must be implemented');
  }
}

/**
 * Agent 任务类型
 */
const AgentTaskType = {
  // 代码分析
  CODE_ANALYSIS: 'code-analysis',
  CODE_REVIEW: 'code-review',
  CODE_GENERATION: 'code-generation',
  
  // 质量守卫
  GUARD_CHECK: 'guard-check',
  GUARD_FIX: 'guard-fix',
  
  // Recipe 相关
  RECIPE_SEARCH: 'recipe-search',
  RECIPE_RECOMMEND: 'recipe-recommend',
  RECIPE_CREATE: 'recipe-create',
  
  // 搜索相关
  SEARCH_CONTEXT: 'search-context',
  SEARCH_SNIPPET: 'search-snippet',
  
  // 通用任务
  CHAT: 'chat',
  CUSTOM: 'custom'
};

/**
 * Agent 能力
 */
const AgentCapability = {
  // 代码能力
  CODE_UNDERSTANDING: 'code-understanding',
  CODE_GENERATION: 'code-generation',
  CODE_REFACTORING: 'code-refactoring',
  
  // 分析能力
  STATIC_ANALYSIS: 'static-analysis',
  QUALITY_CHECK: 'quality-check',
  SECURITY_SCAN: 'security-scan',
  
  // 搜索能力
  SEMANTIC_SEARCH: 'semantic-search',
  VECTOR_SEARCH: 'vector-search',
  KEYWORD_SEARCH: 'keyword-search',
  
  // 推荐能力
  RECIPE_RECOMMENDATION: 'recipe-recommendation',
  SNIPPET_RECOMMENDATION: 'snippet-recommendation',
  
  // 对话能力
  CONVERSATION: 'conversation',
  MULTI_TURN: 'multi-turn',
  CONTEXT_AWARE: 'context-aware',
  
  // 工具使用
  TOOL_USAGE: 'tool-usage',
  TOOL_CHAINING: 'tool-chaining'
};

module.exports = {
  IAgent,
  AgentTaskType,
  AgentCapability
};
