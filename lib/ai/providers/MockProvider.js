const AiProvider = require('../AiProvider');

/**
 * Mock AI Provider
 * 用于测试和开发环境，模拟 AI 的返回结果
 */
class MockProvider extends AiProvider {
	constructor(config) {
		super(config);
		this.modelName = config.model || 'mock-model';
	}

	async chat(prompt, history = [], systemInstruction = '') {
		console.log(`[Mock AI - ${this.modelName}] Received prompt: ${prompt.slice(0, 50)}...`);
		return `这是来自 Mock 模型 (${this.modelName}) 的模拟回复。当前输入长度: ${prompt.length}`;
	}

	async summarize(code, language = 'objectivec') {
		return {
			title: 'Mock Snippet Title',
			title_cn: '模拟代码片段标题',
			summary_cn: '这是一个模拟的代码片段摘要。',
			summary_en: 'This is a mock code snippet summary.',
			trigger: '@mock',
			category: 'Utility',
			language: language,
			tags: ['mock', 'test'],
			usageGuide_cn: '### 使用指南\n1. 这是一个模拟的指南。',
			usageGuide_en: '### Usage Guide\n1. This is a mock guide.',
			code: code // 原样返回
		};
	}

	async extractRecipes(targetName, filesContent) {
		return [{
			title: 'Mock Extracted Recipe',
			summary_cn: '从文件中提取的模拟配方',
			summary_en: 'Mock recipe extracted from files',
			trigger: '@mock_skill',
			category: 'Tool',
			language: 'swift',
			code: '// Mock code',
			headers: ['import Foundation'],
			usageGuide_cn: '模拟提取的使用说明',
			usageGuide_en: 'Mock extracted usage guide'
		}];
	}

	async embed(text) {
		if (Array.isArray(text)) {
			return text.map(() => new Array(1536).fill(0).map(() => Math.random()));
		}
		return new Array(1536).fill(0).map(() => Math.random());
	}
}

module.exports = MockProvider;
