/**
 * SemanticSearchTool - 语义搜索工具
 */

const { ToolCategory } = require('../ITool');

class SemanticSearchTool {
	static category = ToolCategory.SEMANTIC_SEARCH;

	getInfo() {
		return {
			name: 'semantic-search',
			description: 'Search snippets and recipes by semantic meaning',
			version: '1.0.0',
			category: ToolCategory.SEMANTIC_SEARCH,
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'Search query'
					},
					limit: {
						type: 'number',
						description: 'Maximum number of results'
					},
					type: {
						type: 'string',
						enum: ['snippet', 'recipe', 'all'],
						description: 'Type of results to return'
					}
				},
				required: ['query']
			}
		};
	}

	validate(params) {
		if (!params.query || typeof params.query !== 'string') {
			return { valid: false, errors: ['query must be a non-empty string'] };
		}
		if (params.limit && typeof params.limit !== 'number') {
			return { valid: false, errors: ['limit must be a number'] };
		}
		return { valid: true };
	}

	async execute(params) {
		const { query, limit = 10, type = 'all' } = params;

		// 模拟语义搜索结果
		const mockResults = [
			{
				title: 'Array filter',
				type: 'snippet',
				relevance: 0.95,
				content: '[1,2,3].filter(x => x > 1)'
			},
			{
				title: 'Array manipulation',
				type: 'recipe',
				relevance: 0.82,
				content: 'Common array operations and patterns'
			},
			{
				title: 'Higher-order functions',
				type: 'recipe',
				relevance: 0.78,
				content: 'Map, filter, reduce patterns'
			}
		];

		let results = mockResults;
		if (type !== 'all') {
			results = results.filter(r => r.type === type);
		}

		results = results.slice(0, limit);

		return {
			success: true,
			result: {
				query,
				results,
				count: results.length
			}
		};
	}

	getStatus() {
		return { ready: true, status: 'operational' };
	}
}

module.exports = SemanticSearchTool;
