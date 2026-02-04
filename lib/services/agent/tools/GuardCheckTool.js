/**
 * GuardCheckTool - Guard 检查工具
 */

const path = require('path');
const { ToolCategory } = require('../ITool');

class GuardCheckTool {
	static category = ToolCategory.GUARD_CHECK;

	getInfo() {
		return {
			name: 'guard-check',
			description: 'Run guard rules for quality checks',
			version: '1.0.0',
			category: ToolCategory.GUARD_CHECK,
			parameters: {
				type: 'object',
				properties: {
					code: {
						type: 'string',
						description: 'Code to check'
					},
					language: {
						type: 'string',
						description: 'Programming language (objc, swift, etc.)'
					},
					scope: {
						type: 'string',
						enum: ['file', 'target', 'project'],
						description: 'Check scope'
					}
				},
				required: ['code', 'language']
			}
		};
	}

	validate(params) {
		if (!params.code || typeof params.code !== 'string') {
			return { valid: false, errors: ['code must be a non-empty string'] };
		}
		if (!params.language) {
			return { valid: false, errors: ['language is required'] };
		}
		return { valid: true };
	}

	async execute(params) {
		const { code, language, scope = 'file' } = params;

		// 模拟 Guard 检查
		const violations = [];

		// 检查常见问题
		if (language === 'objc' || language === 'swift') {
			if (/\bretain\b/i.test(code) && /\bself\b/i.test(code)) {
				violations.push({
					id: 'potential-retain-cycle',
					message: 'Potential retain cycle detected',
					severity: 'warning'
				});
			}
		}

		if (/console\.log|print\(/i.test(code)) {
			violations.push({
				id: 'debug-statement',
				message: 'Debug statement found in code',
				severity: 'info'
			});
		}

		if (code.length > 1000) {
			violations.push({
				id: 'large-code-block',
				message: 'Code block is very large, consider breaking it down',
				severity: 'warning'
			});
		}

		return {
			success: true,
			result: {
				violations,
				count: violations.length,
				language,
				scope
			}
		};
	}

	getStatus() {
		return { ready: true, status: 'operational' };
	}
}

module.exports = GuardCheckTool;
