const AiProvider = require('../AiProvider');

/**
 * Anthropic Claude AI Provider
 */
class ClaudeProvider extends AiProvider {
	constructor(config) {
		super(config);
		this.apiKey = config.apiKey;
		this.modelName = config.model || 'claude-3-5-sonnet-20240620';
		this.baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';
		
		// 处理代理逻辑
		const proxyUrl = process.env.https_proxy || process.env.http_proxy;
		if (proxyUrl) {
			try {
				const { ProxyAgent, setGlobalDispatcher } = require('undici');
				const proxyAgent = new ProxyAgent(proxyUrl);
				setGlobalDispatcher(proxyAgent);
				console.log(`[AI] 已启用代理: ${proxyUrl}`);
			} catch (e) {
				console.warn('[AI] 尝试启用代理失败');
			}
		}
	}

	async _fetch(path, body) {
		const url = `${this.baseUrl}${path}`;
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': this.apiKey,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify(body)
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new Error(`AI Request failed (${response.status}): ${errorData.error?.message || response.statusText}`);
		}

		return response.json();
	}

	async chat(prompt, history = [], systemInstruction = '') {
		const messages = history.map(msg => ({
			role: msg.role === 'assistant' ? 'assistant' : 'user',
			content: msg.content
		}));

		messages.push({ role: 'user', content: prompt });

		const body = {
			model: this.modelName,
			messages: messages,
			max_tokens: 4096,
			temperature: 0.3
		};

		if (systemInstruction) {
			body.system = systemInstruction;
		}

		const result = await this._fetch('/messages', body);
		return result.content[0].text;
	}

	async summarize(code, language = 'auto') {
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
			- trigger: Short shortcut (starts with #).
			- category: One of the above.
			- language: "swift" or "objectivec".
			- tags: Array of tags.
			- usageGuide_cn: Markdown guide (Chinese).
			- usageGuide_en: Markdown guide (English).
			- code: Reusable usage example (with placeholders).

			Code/Context to Analyze:
			${code}
		`;

		const result = await this.chat(prompt);
		
		try {
			const jsonMatch = result.match(/\{[\s\S]*\}/);
			return jsonMatch ? JSON.parse(jsonMatch[0]) : { error: 'Failed to parse AI response', raw: result };
		} catch (e) {
			return { error: 'JSON parse error', raw: result };
		}
	}

	async extractRecipes(targetName, filesContent) {
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
			- trigger: Shortcut (starts with #).
			- category: [View, Service, Tool, Model, Network, Storage, UI, Utility].
			- language: "swift" or "objectivec".
			- code: Reusable usage example (with placeholders).
			- headers: Array of full import lines.
			- usageGuide_cn: Markdown guide in Chinese.
			- usageGuide_en: Markdown guide in English.

			Files Content:
			${filesContent.map(f => `--- FILE: ${f.name} ---\n${f.content}`).join('\n\n')}
		`;

		const result = await this.chat(prompt);
		try {
			const jsonMatch = result.match(/\[[\s\S]*\]/);
			return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
		} catch (e) {
			return [];
		}
	}

	async embed(text) {
		// Claude does not have an embeddings API, fallback to a warning or use another provider
		console.warn('[Claude] Embeddings are not supported by Claude. Using random vectors for now.');
		const isArray = Array.isArray(text);
		const input = isArray ? text : [text];
		
		const mockEmbeddings = input.map(() => new Array(1536).fill(0).map(() => Math.random()));
		return isArray ? mockEmbeddings : mockEmbeddings[0];
	}
}

module.exports = ClaudeProvider;
