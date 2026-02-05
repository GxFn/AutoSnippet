/**
 * AI Service - 统一的 AI 服务入口
 * 封装 Provider 管理和请求处理
 */
const fs = require('fs');
const path = require('path');
const ProviderManager = require('./ProviderManager');
const IAiProvider = require('./IAiProvider');
const Paths = require('../../infrastructure/config/Paths');

/**
 * Provider 别名到标准名称的映射
 * 用于 initialize() 中的别名规范化和 env var 读取时的反向映射
 */
const PROVIDER_ALIAS_MAP = {
  // Google 别名
  google: 'GOOGLE',
  gemini: 'GOOGLE',
  googlegemini: 'GOOGLE',
  // OpenAI 别名
  openai: 'OPENAI',
  gpt: 'OPENAI',
  chatgpt: 'OPENAI',
  // Claude 别名
  claude: 'CLAUDE',
  anthropic: 'CLAUDE',
  // 其他服务
  deepseek: 'DEEPSEEK',
  ollama: 'OLLAMA',
  mock: 'MOCK'
};

class AiService {
  /**
   * @param {Object} options 选项
   * @param {ServiceContainer} options.container DI 容器
   * @param {Logger} options.logger 日志记录器
   * @param {ConfigManager} options.config 配置管理器
   * @param {string} options.providersPath 默认 Provider 路径
   */
  constructor(options = {}) {
  this.container = options.container;
  this.logger = options.logger;
  this.config = options.config;
  this.providersPath = options.providersPath;

  // 初始化 Provider Manager
  this.providerManager = new ProviderManager(this.container, this.logger);

  this.logger.info('AI Service initialized');
  }

  /**
   * 初始化服务（加载 Provider）
   * @param {Object} options 选项
   * @param {string} options.autoLoad 是否自动加载内置 Provider
   * @param {string} options.defaultProvider 默认 Provider 名称
   * @returns {Promise<void>}
   */
  async initialize(options = {}) {
  const autoLoad = options.autoLoad !== false; // 默认 true
  const envProvider = process.env.ASD_AI_PROVIDER;
  let specProvider = null;
  const projectRoot = this.config?.projectRoot || process.cwd();
  try {
    const specPath = Paths.getProjectSpecPath(projectRoot);
    if (specPath && fs.existsSync(specPath)) {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    specProvider = spec?.ai?.provider || null;
    }
  } catch (_) {
    // ignore spec read failures
  }
  let defaultProvider = options.defaultProvider || 
    specProvider ||
    envProvider ||
    this.config.get('ai.provider') || 
    'google';

  if (autoLoad) {
    const providersPath = this.providersPath || 
    `${__dirname}/../../ai/providers`;
    
    this.logger.info(`Loading providers from ${providersPath}`);
    this.providerManager.loadFromDirectory(providersPath);
  }

  // 注册配置中的自定义 Provider
  const customProviders = this.config.get('ai.customProviders');
  if (customProviders && typeof customProviders === 'object') {
    for (const [name, ProviderClass] of Object.entries(customProviders)) {
    this.providerManager.register(name, ProviderClass);
    }
  }

  // 统一别名映射（用户可能用 provider 的常见别名）
  const providerAliases = {
    google: 'googlegemini',
    gemini: 'googlegemini',
    googlegemini: 'googlegemini',
    openai: 'openai',
    gpt: 'openai',
    chatgpt: 'openai',
    claude: 'claude',
    anthropic: 'claude',
    deepseek: 'deepseek',
    ollama: 'ollama',
    mock: 'mock'
  };
  const normalizedProvider = providerAliases[String(defaultProvider || '').toLowerCase()] || defaultProvider;
  defaultProvider = normalizedProvider;

  // 激活默认 Provider
  if (defaultProvider === 'auto') {
    // 根据可用的 API Key 自动选择 Provider
    if (process.env.ASD_OPENAI_API_KEY && this.providerManager.has('openai')) defaultProvider = 'openai';
    else if (process.env.ASD_GOOGLE_API_KEY && this.providerManager.has('google')) defaultProvider = 'google';
    else if (process.env.ASD_CLAUDE_API_KEY && this.providerManager.has('claude')) defaultProvider = 'claude';
    else if (process.env.ASD_DEEPSEEK_API_KEY && this.providerManager.has('deepseek')) defaultProvider = 'deepseek';
    else if (this.providerManager.has('ollama')) defaultProvider = 'ollama';
    else if (this.providerManager.has('mock')) defaultProvider = 'mock';
    else defaultProvider = this.providerManager.list()[0];
  }

  if (this.providerManager.has(defaultProvider)) {
    const config = this.config.get(`ai.${defaultProvider}`) || {};
    // 从 process.env 补充 API key（支持 ASD_*_API_KEY）
    config.apiKey = config.apiKey || this._getApiKeyFromEnv(defaultProvider);
    config.model = config.model || this._getModelFromEnv();
    config.baseUrl = config.baseUrl || this._getBaseUrlFromEnv(defaultProvider);
    this.providerManager.setCurrent(defaultProvider, config);
  } else if (defaultProvider !== 'mock') {
    this.logger.warn(`Default provider '${defaultProvider}' not found`);
    if (this.providerManager.has('mock')) {
    this.providerManager.setCurrent('mock', {});
    }
  }

  this.logger.info(`AI Service initialized with ${this.providerManager.list().length} providers`);
  }

  /**
   * 发送聊天请求
   * @param {string} prompt 用户问题
   * @param {Object} context 上下文
   * @returns {Promise<string>} AI 响应
   * @throws {AiError}
   */
  async chat(prompt, context = {}) {
  const provider = this.providerManager.getCurrent();
  if (!provider) {
    throw new Error('No AI provider is currently active');
  }

  try {
    this.logger.debug(`Chat request with ${this.providerManager.getCurrentName()}`);
    return await provider.chat(prompt, context);
  } catch (error) {
    this.logger.error('Chat request failed:', this._formatErrorForLog(error));
    throw this._wrapError(error);
  }
  }

  /**
   * 总结代码
   * @param {string} code 源代码
   * @param {Object} options 选项
   * @returns {Promise<Object>} { summary, keywords, category, quality }
   * @throws {AiError}
   */
  async summarize(code, options = {}) {
  const provider = this.providerManager.getCurrent();
  if (!provider) {
    throw new Error('No AI provider is currently active');
  }

  try {
    this.logger.debug(`Summarize request with ${this.providerManager.getCurrentName()}`);
    return await provider.summarize(code, options);
  } catch (error) {
    this.logger.error('Summarize request failed:', this._formatErrorForLog(error));
    throw this._wrapError(error);
  }
  }

  /**
   * 生成向量嵌入
   * @param {string|string[]} text 文本或文本数组
   * @param {Object} options 选项
   * @returns {Promise<Array<number>|Array<Array<number>>>} 向量或向量数组
   * @throws {AiError}
   */
  async embed(text, options = {}) {
  const provider = this.providerManager.getCurrent();
  if (!provider) {
    throw new Error('No AI provider is currently active');
  }

  try {
    this.logger.debug(`Embed request with ${this.providerManager.getCurrentName()}`);
    return await provider.embed(text, options);
  } catch (error) {
    this.logger.error('Embed request failed:', this._formatErrorForLog(error));
    throw this._wrapError(error);
  }
  }

  /**
   * 生成代码
   * @param {string} prompt 生成提示
   * @param {Object} options 选项
   * @returns {Promise<string>} 生成的代码
   * @throws {AiError}
   */
  async generate(prompt, options = {}) {
  const provider = this.providerManager.getCurrent();
  if (!provider) {
    throw new Error('No AI provider is currently active');
  }

  try {
    this.logger.debug(`Generate request with ${this.providerManager.getCurrentName()}`);
    return await provider.generate(prompt, options);
  } catch (error) {
    this.logger.error('Generate request failed:', this._formatErrorForLog(error));
    throw this._wrapError(error);
  }
  }

  /**
   * 搜索和排名
   * @param {string} query 查询
   * @param {Array<string>} candidates 候选项
   * @param {Object} options 选项
   * @returns {Promise<Array>} 排名结果
   * @throws {AiError}
   */
  async rank(query, candidates, options = {}) {
  const provider = this.providerManager.getCurrent();
  if (!provider) {
    throw new Error('No AI provider is currently active');
  }

  try {
    this.logger.debug(`Rank request with ${this.providerManager.getCurrentName()}`);
    return await provider.rank(query, candidates, options);
  } catch (error) {
    this.logger.error('Rank request failed:', this._formatErrorForLog(error));
    throw this._wrapError(error);
  }
  }

  /**
   * 检查 AI Provider 健康状态
   * @returns {Promise<Object>} 健康状态
   */
  async healthCheck() {
  const provider = this.providerManager.getCurrent();
  if (!provider) {
    return { healthy: false, message: 'No AI provider is currently active' };
  }

  try {
    return await provider.healthCheck();
  } catch (error) {
    this.logger.error('Health check failed:', this._formatErrorForLog(error));
    return { healthy: false, message: error.message };
  }
  }

  /**
   * 切换 AI Provider
   * @param {string} providerName Provider 名称
   * @param {Object} config Provider 配置
   * @returns {IAiProvider} 新激活的 Provider
   */
  switchProvider(providerName, config = {}) {
  try {
    return this.providerManager.setCurrent(providerName, config);
  } catch (error) {
    this.logger.error(`Failed to switch provider to '${providerName}':`, this._formatErrorForLog(error));
    throw error;
  }
  }

  /**
   * 列出所有可用 Provider
   * @returns {Array<string>}
   */
  listProviders() {
  return this.providerManager.list();
  }

  /**
   * 获取当前 Provider 名称
   * @returns {string|null}
   */
  getCurrentProvider() {
  return this.providerManager.getCurrentName();
  }

  /**
   * 注册自定义 Provider
   * @param {string} name Provider 名称
   * @param {class} ProviderClass Provider 类
   * @param {boolean} activate 是否激活
   * @returns {AiService} this
   */
  registerProvider(name, ProviderClass, activate = false) {
  this.providerManager.register(name, ProviderClass, activate);
  return this;
  }

  /**
   * 获取当前 Provider 的模型
   * @returns {string} 模型名称
   */
  getModel() {
  const provider = this.providerManager.getCurrent();
  if (!provider) {
    return null;
  }
  return provider.getModel ? provider.getModel() : null;
  }

  /**
   * 设置当前 Provider 的模型
   * @param {string} model 模型名称
   * @returns {AiService} this
   */
  setModel(model) {
  const provider = this.providerManager.getCurrent();
  if (provider && provider.setModel) {
    provider.setModel(model);
  }
  return this;
  }

  /**
   * 获取服务统计信息
   * @returns {Object}
   */
  getStats() {
  return {
    service: 'ai',
    currentProvider: this.providerManager.getCurrentName(),
    providerStats: this.providerManager.getStats()
  };
  }

  /**
   * 包装错误信息
   * @private
   */
  _wrapError(error) {
  if (error.code === 'AiProviderNotFoundError') {
    return error;
  }

  // 将标准错误转换为 AiError（如果需要）
  if (!error.code) {
    error.code = 'AiError';
    error.timestamp = new Date().toISOString();
  }

  return error;
  }

  _formatErrorForLog(error) {
  if (!error) {
    return { message: 'Unknown error' };
  }
  if (error instanceof Error) {
    return {
    name: error.name,
    message: error.message,
    code: error.code,
    stack: error.stack
    };
  }
  if (typeof error === 'object') {
    return {
    ...error,
    message: error.message || 'Unknown error'
    };
  }
  return { message: String(error) };
  }

  /**
   * 从 process.env 中读取对应 provider 的 API key
   * 支持 ASD_PROVIDER_API_KEY 和 ASD_PROVIDER_KEY 格式
   * @private
   */
  _getApiKeyFromEnv(provider) {
  const upper = String(provider || '').toUpperCase();
  // 先查对应的环境变量（如 ASD_GOOGLEGEMINI_API_KEY）
  let key = process.env[`ASD_${upper}_API_KEY`] || process.env[`ASD_${upper}_KEY`];
  // 如果没找到，用别名查（处理 googlegemini -> google, openai -> openai 等）
  if (!key) {
    const aliasName = PROVIDER_ALIAS_MAP[upper.toLowerCase()] || upper;
    key = process.env[`ASD_${aliasName}_API_KEY`] || process.env[`ASD_${aliasName}_KEY`];
  }
  return key || process.env.ASD_API_KEY;
  }

  /**
   * 从 process.env 中读取模型名称
   * @private
   */
  _getModelFromEnv() {
  return process.env.ASD_AI_MODEL || process.env.AUTOSNIPPET_AI_MODEL;
  }

  /**
   * 从 process.env 中读取 base URL
   * @private
   */
  _getBaseUrlFromEnv(provider) {
  const upper = String(provider || '').toUpperCase();
  // 先查对应的环境变量（如 ASD_GOOGLEGEMINI_BASE_URL）
  let baseUrl = process.env[`ASD_${upper}_BASE_URL`] || 
    process.env[`AUTOSNIPPET_${upper}_BASE_URL`];
  // 如果没找到，用别名查
  if (!baseUrl) {
    const aliasName = PROVIDER_ALIAS_MAP[upper.toLowerCase()] || upper;
    baseUrl = process.env[`ASD_${aliasName}_BASE_URL`] || 
    process.env[`AUTOSNIPPET_${aliasName}_BASE_URL`];
  }
  return baseUrl;
  }

  /**
   * 清空缓存
   */
  clearCache() {
  this.providerManager.clearCache();
  }

  /**
   * 获取 Provider Manager（高级用法）
   * @returns {ProviderManager}
   */
  getProviderManager() {
  return this.providerManager;
  }
}

module.exports = AiService;
