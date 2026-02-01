const { GoogleGenerativeAI } = require('@google/generative-ai');
const AiProvider = require('../AiProvider');
const { parseJsonArray, parseJsonObject } = require('../jsonParse');

class GoogleGeminiProvider extends AiProvider {
	constructor(config) {
		super(config);
		
		// 处理代理逻辑
		const proxyUrl = process.env.https_proxy || process.env.http_proxy;
		let requestOptions = {};
		
		if (proxyUrl) {
			try {
				const { ProxyAgent, setGlobalDispatcher } = require('undici');
				const proxyAgent = new ProxyAgent(proxyUrl);
				setGlobalDispatcher(proxyAgent);
				console.log(`[AI] 已启用代理: ${proxyUrl}`);
			} catch (e) {
				console.warn('[AI] 尝试启用代理失败，请检查是否安装了 undici 模块');
			}
		}

		this.genAI = new GoogleGenerativeAI(config.apiKey);
		this.modelName = config.model || 'gemini-2.0-flash'; // 默认为 2.0 Flash
	}

	/** 是否为 429 / 配额/限流类错误（SDK 可能不暴露 status，用 message 判断） */
	_isRateLimitError(err) {
		if (!err) return false;
		if (err.status === 429 || err.response?.status === 429) return true;
		const msg = (err.message || err.toString() || '').toLowerCase();
		return /429|resource_exhausted|exhausted|quota|rate limit|too many requests/i.test(msg);
	}

	async _withRetry(fn, retries = 5, delay = 5000) {
		for (let i = 0; i < retries; i++) {
			try {
				return await fn();
			} catch (err) {
				const is429 = this._isRateLimitError(err);
				if (is429 && i < retries - 1) {
					const waitTime = delay * Math.pow(2, i); // 指数退避，首轮 5s
					console.warn(`[AI] 触发频率限制 (429)，${Math.round(waitTime / 1000)}s 后进行第 ${i + 1} 次重试...`);
					await new Promise(resolve => setTimeout(resolve, waitTime));
					continue;
				}
				throw err;
			}
		}
	}

	async chat(prompt, history = [], systemInstruction = '') {
		return this._withRetry(async () => {
			const model = this.genAI.getGenerativeModel({ 
				model: this.modelName,
				systemInstruction: systemInstruction 
			});

			const chat = model.startChat({
				history: history.map(msg => ({
					role: msg.role === 'assistant' ? 'model' : 'user',
					parts: [{ text: msg.content }],
				})),
			});

			const result = await chat.sendMessage(prompt);
			const response = await result.response;
			return response.text();
		});
	}

	async summarize(code, language = 'auto') {
		return this._withRetry(async () => {
			const model = this.genAI.getGenerativeModel({ model: this.modelName });
			
		const prompt = `
			# Role
			You are an expert iOS architect and senior developer.
			Analyze the following code and generate a structured summary for a knowledge base.
			
			# Goals
			1. Detect the language correctly (objectivec or swift).
			2. Prioritize README or Header files to understand the **public API**.
			3. The \`code\` field MUST be a **standardized usage example** (how to call the API), NOT the implementation.
			4. Use \`<#placeholder#>\` in code for Xcode compatibility.
			
			# Requirements
			- Provide title, summary, and usageGuide in BOTH Chinese (Simplified) and English.
			- Category: [View, Service, Tool, Model, Network, Storage, UI, Utility].
			
			Provide the result in JSON format:
			- title: Concise name (English).
			- title_cn: Concise name (Chinese).
			- summary_cn: Description (Chinese).
			- summary_en: Description (English).
			- trigger: Short shortcut (starts with @).
			- category: One of the above.
			- language: "swift" or "objectivec".
			- tags: Array of tags.
			- usageGuide_cn: Markdown guide (Chinese).
			- usageGuide_en: Markdown guide (English).
			- code: Reusable usage example (with placeholders).

			Code/Context to Analyze:
			${code}
		`;

			const result = await model.generateContent(prompt);
			const response = await result.response;
			const text = response.text();
			const parsed = parseJsonObject(text);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
			return { error: 'Failed to parse AI response', raw: text };
		});
	}

	async extractRecipes(targetName, filesContent) {
		return this._withRetry(async () => {
			const model = this.genAI.getGenerativeModel({ model: this.modelName });
			const prompt = `
				# Role
				You are a Senior iOS Architect and technical documentation expert.

				# Goal
				Extract high-quality reusable patterns (Snippets) and usage guides (Recipes) from the SPM target: "${targetName}".

				# Guidelines
				1. **Prioritize README.md and Header (.h) files** to identify the public API and standard usage.
				2. The \`code\` field MUST be a **usage example** (how a developer calls the API), NOT internal implementation.
				3. Use \`<#placeholder#>\` in code blocks for Xcode Snippet compatibility.
				4. Provide all textual descriptions in both Chinese (Simplified) and English.

				# Output Schema (JSON Array)
				- title: Concise name (English).
				- summary_cn: Description in Chinese.
				- summary_en: Description in English.
				- trigger: Shortcut (starts with @).
				- category: [View, Service, Tool, Model, Network, Storage, UI, Utility].
				- language: "swift" or "objectivec".
				- code: Reusable usage example (with placeholders).
				- headers: Array of full import lines.
				- usageGuide_cn: Markdown guide in Chinese.
				- usageGuide_en: Markdown guide in English.

				Files Content:
				${filesContent.map(f => `--- FILE: ${f.name} ---\n${f.content}`).join('\n\n')}
			`;

			const result = await model.generateContent(prompt);
			const text = result.response.text();
			const parsed = parseJsonArray(text);
			if (Array.isArray(parsed)) return parsed;
			console.error('[AI] extractRecipes JSON 解析失败，返回空数组。原始文本前 500 字符:', text.slice(0, 500));
			return [];
		});
	}

	/**
	 * 生成文本向量
	 * @param {string|string[]} text 
	 */
	async embed(text) {
		return this._withRetry(async () => {
			const model = this.genAI.getGenerativeModel({ model: 'text-embedding-004' });
			if (Array.isArray(text)) {
				const result = await model.batchEmbedContents({
					requests: text.map(t => ({
						content: { role: 'user', parts: [{ text: t }] }
					}))
				});
				return result.embeddings.map(e => e.values);
			} else {
				const result = await model.embedContent(text);
				return result.embedding.values;
			}
		});
	}
}

module.exports = GoogleGeminiProvider;
