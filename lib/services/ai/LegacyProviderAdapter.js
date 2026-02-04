/**
 * 旧 Provider 适配器 - 兼容现有的 AiProvider 实现
 * 将旧架构的 Provider 适配到新的 IAiProvider 接口
 */
const BaseAiProvider = require('./BaseAiProvider');

class LegacyProviderAdapter extends BaseAiProvider {
	/**
	 * @param {AiProvider} legacyProvider 旧的 Provider 实例
	 * @param {string} name Provider 名称
	 */
	constructor(legacyProvider, name = 'legacy') {
		super({
			name,
			model: legacyProvider.config?.model,
			apiKey: legacyProvider.config?.apiKey
		});
		this.legacyProvider = legacyProvider;
	}

	/**
	 * 获取 Provider 信息
	 * @returns {Object}
	 */
	getInfo() {
		return {
			name: this.name,
			version: '1.0.0',
			adapted: true,
			baseModel: this.model
		};
	}

	/**
	 * 聊天（如果旧 Provider 支持）
	 * @param {string} prompt
	 * @param {Object} context
	 * @returns {Promise<string>}
	 */
	async chat(prompt, context = {}) {
		if (typeof this.legacyProvider.chat === 'function') {
			return await this.legacyProvider.chat(prompt, context);
		}
		throw new Error(`${this.name} does not support chat`);
	}

	/**
	 * 总结（如果旧 Provider 支持）
	 * @param {string} code
	 * @param {Object} options
	 * @returns {Promise<Object>}
	 */
	async summarize(code, options = {}) {
		if (typeof this.legacyProvider.summarize === 'function') {
			return await this.legacyProvider.summarize(code, options);
		}
		throw new Error(`${this.name} does not support summarize`);
	}

	/**
	 * 嵌入（如果旧 Provider 支持）
	 * @param {string|string[]} text
	 * @param {Object} options
	 * @returns {Promise<Array<number>|Array<Array<number>>>}
	 */
	async embed(text, options = {}) {
		if (typeof this.legacyProvider.embed === 'function') {
			return await this.legacyProvider.embed(text, options);
		}
		throw new Error(`${this.name} does not support embed`);
	}

	/**
	 * 生成
	 * @param {string} prompt
	 * @param {Object} options
	 */
	async generate(prompt, options = {}) {
		// 尝试使用 chat 来实现 generate
		if (typeof this.legacyProvider.chat === 'function') {
			return await this.legacyProvider.chat(prompt, options);
		}
		throw new Error(`${this.name} does not support generate`);
	}

	/**
	 * 排名
	 * @param {string} query
	 * @param {Array<string>} candidates
	 * @param {Object} options
	 */
	async rank(query, candidates, options = {}) {
		// 默认排名实现：为每个候选项分配评分
		if (typeof this.legacyProvider.chat === 'function') {
			const prompt = `以下是候选项，请根据与查询 "${query}" 的相关性排名：\n${candidates.map((c, i) => `${i+1}. ${c}`).join('\n')}`;
			await this.legacyProvider.chat(prompt);
			
			// 返回原始顺序但带有评分
			return candidates.map((item, index) => ({
				item,
				score: 1.0 - (index * 0.1) // 简单评分逻辑
			}));
		}
		throw new Error(`${this.name} does not support rank`);
	}

	/**
	 * 健康检查
	 */
	async healthCheck() {
		try {
			// 检查旧 Provider 是否可用
			if (typeof this.legacyProvider.healthCheck === 'function') {
				return await this.legacyProvider.healthCheck();
			}
			
			// 默认检查：尝试获取模型信息
			return {
				healthy: Boolean(this.legacyProvider.config),
				message: `${this.name} provider is ${this.legacyProvider.config ? 'available' : 'not configured'}`
			};
		} catch (error) {
			return {
				healthy: false,
				message: error.message
			};
		}
	}

	/**
	 * 获取模型
	 */
	getModel() {
		return this.legacyProvider.config?.model || this.model;
	}

	/**
	 * 设置模型
	 */
	setModel(model) {
		if (this.legacyProvider.config) {
			this.legacyProvider.config.model = model;
		}
		this.model = model;
	}
}

module.exports = LegacyProviderAdapter;
