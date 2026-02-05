/**
 * AI Provider 接口
 * 定义所有 AI Provider 必须实现的方法
 */
class IAiProvider {
  /**
   * 获取 Provider 信息
   * @returns {Object} { name, version, supportedModels }
   */
  getInfo() {
  throw new Error('Method getInfo() must be implemented');
  }

  /**
   * 发送聊天请求
   * @param {string} prompt 用户问题
   * @param {Object} context 上下文信息
   * @param {string} context.language 代码语言
   * @param {string} context.filePath 文件路径
   * @param {Array<Object>} context.messages 对话历史
   * @returns {Promise<string>} AI 响应内容
   * @throws {AiError}
   */
  async chat(prompt, context = {}) {
  throw new Error('Method chat() must be implemented');
  }

  /**
   * 生成代码总结和元数据
   * @param {string} code 源代码
   * @param {Object} options 选项
   * @param {string} options.language 语言
   * @param {number} options.maxLength 最大长度
   * @returns {Promise<Object>} { summary, keywords, category, quality }
   * @throws {AiError}
   */
  async summarize(code, options = {}) {
  throw new Error('Method summarize() must be implemented');
  }

  /**
   * 生成文本向量/嵌入
   * @param {string|string[]} text 文本或文本数组
   * @param {Object} options 选项
   * @param {string} options.model 使用的模型
   * @returns {Promise<Array<number>|Array<Array<number>>>} 单个向量或向量数组
   * @throws {AiError}
   */
  async embed(text, options = {}) {
  throw new Error('Method embed() must be implemented');
  }

  /**
   * 生成代码
   * @param {string} prompt 生成提示
   * @param {Object} options 选项
   * @param {string} options.language 编程语言
   * @param {number} options.maxTokens 最大 token 数
   * @returns {Promise<string>} 生成的代码
   * @throws {AiError}
   */
  async generate(prompt, options = {}) {
  throw new Error('Method generate() must be implemented');
  }

  /**
   * 搜索和排名内容
   * @param {string} query 搜索查询
   * @param {Array<string>} candidates 候选项列表
   * @param {Object} options 选项
   * @param {number} options.topK 返回前 K 项
   * @returns {Promise<Array<{item: string, score: number}>>} 排名结果
   * @throws {AiError}
   */
  async rank(query, candidates, options = {}) {
  throw new Error('Method rank() must be implemented');
  }

  /**
   * 检查健康状态
   * @returns {Promise<{healthy: boolean, message: string}>}
   */
  async healthCheck() {
  throw new Error('Method healthCheck() must be implemented');
  }

  /**
   * 获取当前配置的模型
   * @returns {string} 模型名称
   */
  getModel() {
  throw new Error('Method getModel() must be implemented');
  }

  /**
   * 设置模型
   * @param {string} model 新模型名称
   */
  setModel(model) {
  throw new Error('Method setModel() must be implemented');
  }
}

module.exports = IAiProvider;
