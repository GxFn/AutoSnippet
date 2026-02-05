/**
 * ITool - 工具接口定义
 * 
 * Tool 是 Agent 可以调用的功能单元
 * Phase 5: Agent System
 */

/**
 * 工具接口
 * 所有 Tool 必须实现此接口
 */
class ITool {
  /**
   * 获取工具信息
   * @returns {Object} 工具信息
   * @returns {string} return.name - 工具名称
   * @returns {string} return.description - 工具描述
   * @returns {string} return.version - 工具版本
   * @returns {Object} return.parameters - 参数定义（JSON Schema）
   * @returns {Array<string>} [return.examples] - 使用示例
   */
  getInfo() {
  throw new Error('Method getInfo() must be implemented');
  }

  /**
   * 验证参数
   * @param {Object} params - 参数对象
   * @returns {Object} 验证结果
   * @returns {boolean} return.valid - 是否有效
   * @returns {Array<string>} [return.errors] - 错误列表
   */
  validate(params) {
  throw new Error('Method validate() must be implemented');
  }

  /**
   * 执行工具
   * @param {Object} params - 参数对象
   * @param {Object} [context] - 执行上下文
   * @returns {Promise<Object>} 执行结果
   * @returns {boolean} return.success - 是否成功
   * @returns {any} return.data - 结果数据
   * @returns {string} [return.error] - 错误信息
   * @returns {Object} [return.metadata] - 元数据
   */
  async execute(params, context = {}) {
  throw new Error('Method execute() must be implemented');
  }

  /**
   * 获取工具状态
   * @returns {Object} 状态信息
   * @returns {boolean} return.available - 是否可用
   * @returns {string} return.status - 状态描述
   * @returns {Object} [return.stats] - 统计信息
   */
  getStatus() {
  throw new Error('Method getStatus() must be implemented');
  }
}

/**
 * 工具分类
 */
const ToolCategory = {
  // 代码工具
  CODE_ANALYSIS: 'code-analysis',
  CODE_SEARCH: 'code-search',
  CODE_GENERATION: 'code-generation',
  
  // 搜索工具
  SEMANTIC_SEARCH: 'semantic-search',
  CONTEXT_SEARCH: 'context-search',
  SNIPPET_SEARCH: 'snippet-search',
  
  // Recipe 工具
  RECIPE_QUERY: 'recipe-query',
  RECIPE_RECOMMEND: 'recipe-recommend',
  
  // 质量工具
  GUARD_CHECK: 'guard-check',
  LINT: 'lint',
  
  // 文件工具
  FILE_READ: 'file-read',
  FILE_WRITE: 'file-write',
  FILE_SEARCH: 'file-search',
  
  // AI 工具
  AI_CHAT: 'ai-chat',
  AI_EMBED: 'ai-embed',
  AI_SUMMARIZE: 'ai-summarize',
  
  // 通用工具
  UTILITY: 'utility',
  CUSTOM: 'custom'
};

/**
 * 参数类型定义
 */
const ParameterType = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  OBJECT: 'object',
  ARRAY: 'array',
  FILE_PATH: 'file-path',
  CODE: 'code',
  VECTOR: 'vector'
};

module.exports = {
  ITool,
  ToolCategory,
  ParameterType
};
