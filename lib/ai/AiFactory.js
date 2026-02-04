const fs = require('fs');
const path = require('path');
// 尝试加载 .env 文件
try {
	const dotenv = require('dotenv');
	const findPath = require('../infrastructure/paths/PathFinder');
	const projectRoot = findPath.findProjectRootSync ? findPath.findProjectRootSync(process.cwd()) : process.cwd();
	const envPath = path.join(projectRoot, '.env');
	if (fs.existsSync(envPath)) {
		const result = dotenv.config({ path: envPath, override: true });
		if (result.error) {
			console.warn(`[AiFactory] Dotenv error: ${result.error.message}`);
		} else {
			console.log(`[AiFactory] Loaded .env from: ${envPath}`);
		}
	}
} catch (e) {
	// ignore
}

const Paths = require('../infrastructure/config/Paths.js');
const GoogleGeminiProvider = require('./providers/GoogleGeminiProvider');
const OpenAiProvider = require('./providers/OpenAiProvider');
const ClaudeProvider = require('./providers/ClaudeProvider');
const MockProvider = require('./providers/MockProvider');

// 针对本地 AI 可能出现的超长响应时间，调整全局 fetch 行为
try {
	const { setGlobalDispatcher, Agent } = require('undici');
	setGlobalDispatcher(new Agent({
		headersTimeout: 300000,   // 5 分钟
		bodyTimeout: 300000       // 5 分钟
	}));
} catch (e) {}

class AiFactory {
	/**
	 * 创建 AI Provider 实例
	 * @param {Object} options 
	 * @returns {AiProvider}
	 */
	static create(options = {}) {
		const provider = options.provider || process.env.ASD_AI_PROVIDER || 'google';
		
		// 如果是 mock 模式，不需要 API Key
		if (provider.toLowerCase() === 'mock') {
			return new MockProvider({
				model: options.model || process.env.ASD_AI_MODEL || 'mock-l3'
			});
		}

		let apiKey = options.apiKey;
		if (!apiKey) {
			if (provider === 'google') apiKey = process.env.ASD_GOOGLE_API_KEY;
			else if (provider === 'openai') apiKey = process.env.ASD_OPENAI_API_KEY;
			else if (provider === 'deepseek') apiKey = process.env.ASD_DEEPSEEK_API_KEY;
			else if (provider === 'claude') apiKey = process.env.ASD_CLAUDE_API_KEY;
			else if (provider === 'ollama') apiKey = 'ollama'; // Ollama normally doesn't need a key
		}
		
		if (!apiKey && provider !== 'ollama') {
			const envKey = provider === 'google' ? 'ASD_GOOGLE_API_KEY' : `ASD_${provider.toUpperCase()}_API_KEY`;
			throw new Error(`当前使用 provider: ${provider}，但未配置 API Key。请在项目根 .env 中设置 ${envKey}=你的Key（或在 boxspec 的 ai 中配置），并确保在项目根执行 asd ui。也可使用 provider: 'mock' 做本地测试。`);
		}

		switch (provider.toLowerCase()) {
			case 'google':
				return new GoogleGeminiProvider({
					apiKey,
					model: options.model || process.env.ASD_AI_MODEL || 'gemini-2.0-flash'
				});
			case 'openai':
				return new OpenAiProvider({
					apiKey,
					model: options.model || process.env.ASD_AI_MODEL || 'gpt-4o',
					baseUrl: options.baseUrl || process.env.ASD_OPENAI_BASE_URL || 'https://api.openai.com/v1'
				});
			case 'deepseek':
				return new OpenAiProvider({
					apiKey,
					model: options.model || process.env.ASD_AI_MODEL || 'deepseek-chat',
					baseUrl: options.baseUrl || process.env.ASD_DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1'
				});
			case 'claude':
				return new ClaudeProvider({
					apiKey,
					model: options.model || process.env.ASD_AI_MODEL || 'claude-3-5-sonnet-20240620',
					baseUrl: options.baseUrl || process.env.ASD_CLAUDE_BASE_URL || 'https://api.anthropic.com/v1'
				});
			case 'ollama':
				return new OpenAiProvider({
					apiKey: 'ollama',
					model: options.model || process.env.ASD_AI_MODEL || 'llama3',
					baseUrl: options.baseUrl || process.env.ASD_OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1'
				});
			default:
				throw new Error(`Unsupported AI provider: ${provider}`);
		}
	}

	/**
	 * 从项目配置中获取 AI Provider
	 * @param {string} projectRoot 
	 * @returns {Promise<AiProvider|null>}
	 */
	static async getProvider(projectRoot) {
		if (projectRoot) {
			const envPath = path.join(projectRoot, '.env');
			try {
				const dotenv = require('dotenv');
				const result = dotenv.config({ path: envPath, override: true });
				if (result.error && fs.existsSync(envPath)) {
					console.warn(`[AiFactory] .env 解析失败: ${result.error.message}`);
				}
			} catch (e) {
				if (e.code === 'MODULE_NOT_FOUND' && (e.message || '').includes('dotenv')) {
					console.warn('[AiFactory] 未安装 dotenv，.env 未加载。请在 AutoSnippet 目录执行: npm install');
				}
			}
		}
		
		if (!projectRoot) return this.create();

		try {
			const specPath = Paths.getProjectSpecPath(projectRoot);
			if (fs.existsSync(specPath)) {
				const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
				if (spec.ai) {
					return this.create(spec.ai);
				}
			}
		} catch (e) {
			console.warn(`[AiFactory] Failed to read AI config from spec: ${e.message}`);
		}

		// 回退到环境变量
		return this.create();
	}

	/** 各 provider 的默认模型（仅用于展示） */
	static _defaultModel(provider) {
		const p = (provider || '').toLowerCase();
		if (p === 'mock') return 'mock-l3';
		if (p === 'google') return 'gemini-2.0-flash';
		if (p === 'openai') return 'gpt-4o';
		if (p === 'deepseek') return 'deepseek-chat';
		if (p === 'claude') return 'claude-3-5-sonnet-20240620';
		if (p === 'ollama') return 'llama3';
		return process.env.ASD_AI_MODEL || 'gemini-2.0-flash';
	}

	/**
	 * 仅解析当前使用的 AI 配置（provider / model / hasKey），不创建实例，供 UI 展示
	 * @param {string} projectRoot
	 * @returns {{ provider: string, model: string, hasKey: boolean }}
	 */
	static getConfigSync(projectRoot) {
		if (projectRoot) {
			try {
				const dotenv = require('dotenv');
				dotenv.config({ path: path.join(projectRoot, '.env'), override: true });
			} catch (e) {
				if (e.code === 'MODULE_NOT_FOUND' && (e.message || '').includes('dotenv')) {
					console.warn('[AiFactory] 未安装 dotenv，.env 未加载。请在 AutoSnippet 目录执行: npm install');
				}
			}
		}
		let provider = (process.env.ASD_AI_PROVIDER || 'google').toLowerCase();
		let model = process.env.ASD_AI_MODEL || this._defaultModel(provider);
		let apiKey = null;
		try {
			const specPath = projectRoot ? Paths.getProjectSpecPath(projectRoot) : '';
			if (projectRoot && specPath && fs.existsSync(specPath)) {
				const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
				if (spec.ai) {
					provider = (spec.ai.provider || provider).toLowerCase();
					model = spec.ai.model || process.env.ASD_AI_MODEL || this._defaultModel(provider);
					apiKey = spec.ai.apiKey || null;
				}
			}
		} catch (e) {
			// ignore
		}
		if (!apiKey) {
			if (provider === 'google') apiKey = process.env.ASD_GOOGLE_API_KEY;
			else if (provider === 'openai') apiKey = process.env.ASD_OPENAI_API_KEY;
			else if (provider === 'deepseek') apiKey = process.env.ASD_DEEPSEEK_API_KEY;
			else if (provider === 'claude') apiKey = process.env.ASD_CLAUDE_API_KEY;
			else if (provider === 'ollama') apiKey = 'ollama';
		}
		return { provider, model, hasKey: !!(apiKey && (provider === 'ollama' || apiKey.length > 0)) };
	}
}

module.exports = AiFactory;
