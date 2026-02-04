/**
 * OpenAI 兼容 Provider（现代实现）
 * 支持 OpenAI、DeepSeek、Ollama 等兼容接口的服务
 */
const BaseAiProvider = require('./BaseAiProvider');

class OpenAiCompatibleProvider extends BaseAiProvider {
	/**
	 * @param {Object} config 配置
	 * @param {string} config.apiKey API 密钥
	 * @param {string} config.model 模型名称
	 * @param {string} config.baseUrl API 基础 URL
	 * @param {string} config.name Provider 名称（默认 'openai'）
	 * @param {number} config.timeout 超时（毫秒）
	 */
	constructor(config = {}) {
		super({
			name: config.name || 'openai',
			model: config.model || 'gpt-4o',
			apiKey: config.apiKey,
			timeout: config.timeout
		});

		this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
		this.organizationId = config.organizationId;
	}

	/**
	 * 获取请求头
	 * @private
	 */
	_getHeaders() {
		const headers = {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${this.apiKey}`
		};

		if (this.organizationId) {
			headers['OpenAI-Organization'] = this.organizationId;
		}

		return headers;
	}

	/**
	 * 聊天请求
	 * @param {string} prompt 用户问题
	 * @param {Object} context 上下文
	 * @returns {Promise<string>}
	 */
	async chat(prompt, context = {}) {
		this.validateConfig();

		const messages = context.messages || [
			{ role: 'user', content: prompt }
		];

		const url = `${this.baseUrl}/chat/completions`;
		const body = {
			model: this.model,
			messages,
			temperature: context.temperature !== undefined ? context.temperature : 0.7,
			max_tokens: context.maxTokens || 2048,
			stream: false
		};

		try {
			const response = await this.sendJsonRequest(url, body, this._getHeaders());
			return response.choices?.[0]?.message?.content || '';
		} catch (error) {
			throw new Error(`OpenAI chat request failed: ${error.message}`);
		}
	}

	/**
	 * 生成代码摘要
	 * @param {string} code 源代码
	 * @param {Object} options 选项
	 * @returns {Promise<Object>}
	 */
	async summarize(code, options = {}) {
		this.validateConfig();

		const prompt = `请分析以下代码，生成简洁摘要和元数据：
\`\`\`${options.language || 'javascript'}
${code}
\`\`\`

请以 JSON 格式返回：{
  "summary": "代码摘要",
  "keywords": ["关键词1", "关键词2"],
  "category": "代码分类",
  "quality": 0.5-1.0
}`;

		const response = await this.chat(prompt, {
			maxTokens: options.maxLength || 1024,
			temperature: 0.3
		});

		try {
			// 尝试解析 JSON 响应
			const jsonMatch = response.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				return JSON.parse(jsonMatch[0]);
			}

			// 降级处理
			return {
				summary: response,
				keywords: [],
				category: 'code',
				quality: 0.7
			};
		} catch (error) {
			throw new Error(`Failed to parse summarize response: ${error.message}`);
		}
	}

	/**
	 * 生成向量嵌入
	 * @param {string|string[]} text 文本
	 * @param {Object} options 选项
	 * @returns {Promise<Array<number>|Array<Array<number>>>}
	 */
	async embed(text, options = {}) {
		this.validateConfig();

		// 检查是否是数组
		const isArray = Array.isArray(text);
		const texts = isArray ? text : [text];

		const url = `${this.baseUrl}/embeddings`;
		const body = {
			model: options.model || 'text-embedding-3-small',
			input: texts
		};

		try {
			const response = await this.sendJsonRequest(url, body, this._getHeaders());
			const embeddings = response.data?.map(item => item.embedding) || [];

			return isArray ? embeddings : embeddings[0];
		} catch (error) {
			throw new Error(`OpenAI embed request failed: ${error.message}`);
		}
	}

	/**
	 * 生成代码
	 * @param {string} prompt 生成提示
	 * @param {Object} options 选项
	 * @returns {Promise<string>}
	 */
	async generate(prompt, options = {}) {
		this.validateConfig();

		const systemPrompt = `你是一个专业的代码生成助手。
使用语言：${options.language || 'javascript'}
要求：${options.requirements || '生成高质量的代码'}`;

		const response = await this.chat(prompt, {
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: prompt }
			],
			maxTokens: options.maxTokens || 4096,
			temperature: options.temperature !== undefined ? options.temperature : 0.5
		});

		return response;
	}

	/**
	 * 搜索和排名
	 * @param {string} query 查询
	 * @param {Array<string>} candidates 候选项
	 * @param {Object} options 选项
	 * @returns {Promise<Array>}
	 */
	async rank(query, candidates, options = {}) {
		this.validateConfig();

		const topK = options.topK || candidates.length;
		const prompt = `请评估以下候选项与查询 "${query}" 的相关性，并按相关性从高到低排序。

候选项：
${candidates.map((c, i) => `${i + 1}. ${c}`).join('\n')}

请返回 JSON 数组，格式为：[{"index": 0, "score": 0.95}, ...]
其中 score 为 0-1 之间的相关性分数。`;

		const response = await this.chat(prompt, {
			temperature: 0.1,
			maxTokens: 1024
		});

		try {
			const jsonMatch = response.match(/\[[\s\S]*\]/);
			if (jsonMatch) {
				const rankings = JSON.parse(jsonMatch[0]);
				return rankings
					.slice(0, topK)
					.map(r => ({
						item: candidates[r.index],
						score: r.score,
						index: r.index
					}))
					.sort((a, b) => b.score - a.score);
			}

			// 降级：返回原始顺序
			return candidates.slice(0, topK).map((item, i) => ({
				item,
				score: 1.0 - (i * 0.05),
				index: i
			}));
		} catch (error) {
			throw new Error(`Failed to parse rank response: ${error.message}`);
		}
	}

	/**
	 * 健康检查
	 */
	async healthCheck() {
		try {
			this.validateConfig();

			const url = `${this.baseUrl}/models`;
			const response = await this.fetchWithTimeout(url, {
				headers: this._getHeaders()
			});

			if (!response.ok) {
				throw new Error(`API health check failed: ${response.statusText}`);
			}

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
	 * 获取 Provider 信息
	 */
	getInfo() {
		return {
			name: this.name,
			model: this.model,
			baseUrl: this.baseUrl,
			timeout: this.timeout,
			version: '1.0.0'
		};
	}
}

module.exports = OpenAiCompatibleProvider;
