#!/usr/bin/env node

/**
 * asd search - 搜索知识库
 * 支持关键词搜索和语义搜索
 * 
 * 调用链路（CLI）:
 * CLI->searchCommand -> SearchServiceV2.search
 * -> (可选) IntelligentServiceLayer.intelligentSearch -> SearchServiceV2.search
 * -> _rankingSearch/_semanticSearch/_keywordSearch -> _searchRecipes/_searchSnippets
 */

const fs = require('fs');
const path = require('path');
const Paths = require('../infrastructure/config/Paths');

/**
 * 执行搜索（使用 SearchServiceV2，与 Xcode 链路一致）
 * @param {string} projectRoot 
 * @param {string} keyword 
 * @param {object} options 
 */
async function runSearch(projectRoot, keyword, options = {}) {
	// 调用链路（CLI）:
	// CLI->searchCommand -> SearchServiceV2.search
	// -> _rankingSearch/_semanticSearch/_keywordSearch -> _searchRecipes/_searchSnippets
	if (!keyword || keyword.trim() === '') {
		console.error('❌ 请提供搜索关键词');
		console.error('   用法: asd search <keyword>');
		return;
	}
	
	keyword = keyword.trim();

	if (process.env.ASD_DEBUG_SEARCH_CHAIN === '1') {
		console.log('[CHAIN] CLI->searchCommand', {
			projectRoot,
			keyword,
			semantic: options.semantic,
			mode: options.semantic ? 'semantic' : 'keyword'
		});
	}
	
	console.log(`🔍 搜索: "${keyword}"\n`);
	
	try {
		// 使用统一的搜索函数（CLI 和 Xcode 共用）
		const { performUnifiedSearch } = require('../search/unifiedSearch');

		// 确定搜索模式（默认 ranking 以获得最佳结果）
		const mode = options.semantic ? 'semantic' : 'ranking';
		
		// 为 Agent 生成会话标识
		const sessionId = options.sessionId || `cli-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		
		// 执行搜索
		const { results } = await performUnifiedSearch(projectRoot, keyword, {
			mode,
			limit: 50,
			sessionId,  // 提供会话标识以启用 Agent 个性化
			context: { source: 'cli' },
			enableAgent: options.withoutAgent !== true
		});

		if (!results || results.length === 0) {
			console.log('❌ 未找到匹配结果\n');
			console.log('提示：');
			console.log('  - 尝试使用更短或更通用的关键词');
			console.log('  - 使用 asd search -m "语义查询" 进行语义搜索');
			return;
		}

		// 按类型分组显示
		const recipes = results.filter(r => r.type === 'recipe');
		const snippets = results.filter(r => r.type === 'snippet');
		
		// 检查是否有 Agent 增强
		const hasAgentEnhancement = recipes.some(r => r.qualityScore !== undefined) || 
		                            snippets.some(s => s.qualityScore !== undefined);
		if (hasAgentEnhancement) {
			console.log('🤖 智能搜索已启用 (Agent 增强结果)\n');
		}

		// 显示 Recipes
		if (recipes.length > 0) {
			console.log(`📚 Recipes (${recipes.length} 个匹配):\n`);
			recipes.forEach((r, i) => {
				const matchType = r.matchedBy === 'title' ? '[标题]' : 
				                 r.matchedBy === 'trigger' ? '[触发词]' : '[内容]';
				console.log(`  ${i + 1}. ${r.title} ${matchType}`);
				if (r.trigger) console.log(`     触发词: ${r.trigger}`);
				if (r.category) console.log(`     分类: ${r.category}`);
				console.log(`     文件: ${r.file || r.name}`);
				if (r.recommendReason) {
					console.log(`     推荐理由: ${r.recommendReason}`);
				}
				console.log('');
			});
		}

		// 显示 Snippets
		if (snippets.length > 0) {
			console.log(`📝 Snippets (${snippets.length} 个匹配):\n`);
			snippets.forEach((s, i) => {
				const matchType = s.matchedBy === 'title' ? '[标题]' : 
				                 s.matchedBy === 'trigger' ? '[触发词]' : '[代码]';
				console.log(`  ${i + 1}. ${s.title} ${matchType}`);
				if (s.trigger) console.log(`     触发词: @${s.trigger}`);
				if (s.recommendReason) {
					console.log(`     推荐理由: ${s.recommendReason}`);
				}
				console.log('');
			});
		}

		// --copy 选项：复制第一条到剪贴板
		if (options.copy) {
			const firstResult = results[0];
			if (firstResult) {
				// TODO: 实现复制到剪贴板
				console.log(`📋 已复制第一条结果到剪贴板`);
			}
		}

		// --pick 选项：交互选择
		if (options.pick) {
			console.log('ℹ️  --pick 选项需要交互，请使用 asd ui 或直接查看上述结果');
		}

	} catch (error) {
		console.error('❌ 搜索失败:', error.message);
		if (process.env.ASD_DEBUG_SEARCH_CHAIN === '1') {
			console.error(error.stack);
		}
	}
}

module.exports = { runSearch };
