/**
 * AI Service - 统一的 AI 服务入口
 * 封装 Provider 管理和请求处理
 */
const ProviderManager = require('./ProviderManager');
const IAiProvider = require('./IAiProvider');

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
		const defaultProvider = options.defaultProvider || 
			this.config.get('ai.provider') || 
			process.env.ASD_AI_PROVIDER ||
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

		// 激活默认 Provider
		if (this.providerManager.has(defaultProvider)) {
			const config = this.config.get(`ai.${defaultProvider}`) || {};
			this.providerManager.setCurrent(defaultProvider, config);
		} else if (defaultProvider !== 'mock') {
			this.logger.warn(`Default provider '${defaultProvider}' not found`);
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
			this.logger.error('Chat request failed:', error);
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
			this.logger.error('Summarize request failed:', error);
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
			this.logger.error('Embed request failed:', error);
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
			this.logger.error('Generate request failed:', error);
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
			this.logger.error('Rank request failed:', error);
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
			this.logger.error('Health check failed:', error);
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
			this.logger.error(`Failed to switch provider to '${providerName}':`, error);
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
