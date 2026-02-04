/**
 * CodeAnalysisTool - 代码分析工具
 */

const { ToolCategory } = require('../ITool');

class CodeAnalysisTool {
	static category = ToolCategory.CODE_ANALYSIS;

	getInfo() {
		return {
			name: 'code-analysis',
			description: 'Analyze code structure and quality',
			version: '1.0.0',
			category: ToolCategory.CODE_ANALYSIS,
			parameters: {
				type: 'object',
				properties: {
					code: {
						type: 'string',
						description: 'Code to analyze'
					},
					language: {
						type: 'string',
						description: 'Programming language (js, ts, py, etc.)'
					},
					aspects: {
						type: 'array',
						items: { type: 'string' },
						description: 'What to analyze: complexity, readability, performance, etc.'
					}
				},
				required: ['code']
			}
		};
	}

	validate(params) {
		if (!params.code || typeof params.code !== 'string') {
			return { valid: false, errors: ['code must be a non-empty string'] };
		}
		return { valid: true };
	}

	async execute(params) {
		const { code, language = 'unknown', aspects = ['complexity', 'readability'] } = params;

		// 基础分析
		const lines = code.split('\n').length;
		const hasComments = /\/\/|\/\*/.test(code);
		const functions = (code.match(/function\s+\w+|const\s+\w+\s*=\s*\(/g) || []).length;

		const analysis = {
			lines,
			functions,
			hasComments,
			language,
			aspects: {}
		};

		if (aspects.includes('complexity')) {
			analysis.aspects.complexity = functions > 10 ? 'high' : functions > 3 ? 'medium' : 'low';
		}

		if (aspects.includes('readability')) {
			analysis.aspects.readability = hasComments ? 'good' : 'fair';
		}

		return {
			success: true,
			result: analysis
		};
	}

	getStatus() {
		return { ready: true, status: 'operational' };
	}
}

module.exports = CodeAnalysisTool;
