/**
 * Base AI Provider - 所有 Provider 的基类
 * 提供通用功能和标准接口实现
 */
const IAiProvider = require('./IAiProvider');

class BaseAiProvider extends IAiProvider {
  /**
   * @param {Object} config 提供商配置
   * @param {string} config.name Provider 名称
   * @param {string} config.model 模型名称
   * @param {string} config.apiKey API 密钥
   * @param {number} config.timeout 超时时间（毫秒）
   */
  constructor(config = {}) {
  super();
  this.name = config.name || 'unknown';
  this.model = config.model;
  this.apiKey = config.apiKey;
  this.timeout = config.timeout || 300000; // 默认 5 分钟
  this.config = config;
  }

  /**
   * 获取 Provider 信息
   * @returns {Object}
   */
  getInfo() {
  return {
    name: this.name,
    model: this.model,
    timeout: this.timeout,
    version: '1.0.0'
  };
  }

  /**
   * 获取当前模型
   * @returns {string}
   */
  getModel() {
  return this.model;
  }

  /**
   * 设置模型
   * @param {string} model 模型名称
   */
  setModel(model) {
  this.model = model;
  }

  /**
   * 带超时的 fetch 请求
   * @protected
   * @param {string} url 请求 URL
   * @param {Object} options fetch 选项
   * @returns {Promise<Response>}
   * @throws {Error} 超时错误
   */
  async fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), this.timeout);

  try {
    const response = await fetch(url, {
    ...options,
    signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
    throw new Error(`Request timeout after ${this.timeout}ms`);
    }
    throw error;
  }
  }

  /**
   * 发送 JSON 请求并获取响应
   * @protected
   * @param {string} url 请求 URL
   * @param {Object} body 请求体
   * @param {Object} headers 请求头
   * @returns {Promise<Object>} 响应数据
   */
  async sendJsonRequest(url, body, headers = {}) {
  const response = await this.fetchWithTimeout(url, {
    method: 'POST',
    headers: {
    'Content-Type': 'application/json',
    ...headers
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Request failed (${response.status}): ${errorData.error?.message || response.statusText}`);
  }

  return await response.json();
  }

  /**
   * 检查 API 密钥是否有效
   * @protected
   * @returns {boolean}
   */
  hasValidApiKey() {
  return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  /**
   * 验证配置
   * @protected
   * @throws {Error}
   */
  validateConfig() {
  if (!this.hasValidApiKey()) {
    throw new Error(`${this.name} provider requires a valid API key`);
  }
  }

  /**
   * 默认的健康检查实现
   * @returns {Promise<Object>}
   */
  async healthCheck() {
  try {
    this.validateConfig();
    return {
    healthy: true,
    message: `${this.name} provider is healthy`,
    model: this.model
    };
  } catch (error) {
    return {
    healthy: false,
    message: error.message
    };
  }
  }

  /**
   * 默认实现：生成模型不一定支持
   * @param {string} prompt
   * @param {Object} options
   */
  async generate(prompt, options = {}) {
  throw new Error(`${this.name} provider does not support code generation`);
  }

  /**
   * 默认实现：排名模型不一定支持
   * @param {string} query
   * @param {Array<string>} candidates
   * @param {Object} options
   */
  async rank(query, candidates, options = {}) {
  throw new Error(`${this.name} provider does not support ranking`);
  }

  /**
   * 字符串表示
   * @returns {string}
   */
  toString() {
  return `${this.name}Provider(model=${this.model})`;
  }
}

module.exports = BaseAiProvider;
