#!/usr/bin/env node

/**
 * 候选与已有 Recipe 的相似度分析
 * 基于 ContextService 语义检索，返回相似 Recipe 列表供审核参考
 */

const DEFAULT_THRESHOLD = 0.5;
const DEFAULT_TOP_K = 5;

/**
 * 查找与候选相似的已有 Recipe
 * @param {string} projectRoot
 * @param {object} candidate { title, summary, code, usageGuide }
 * @param {{ threshold?: number, topK?: number }} options
 * @returns {Promise<Array<{ recipeName: string, similarity: number }>>}
 */
async function findSimilarRecipes(projectRoot, candidate, options = {}) {
	try {
		const threshold = options.threshold ?? DEFAULT_THRESHOLD;
		const topK = options.topK ?? DEFAULT_TOP_K;

		if (!candidate || typeof candidate !== 'object') {
			return [];
		}

		// 构建候选的文本表示（用于语义搜索）
		const text = [
			candidate.title || '',
			candidate.summary || '',
			candidate.usageGuide || '',
			candidate.code || ''
		].filter(Boolean).join('\n');

		if (!text.trim()) {
			return [];
		}

		// 使用 ContextService 进行语义搜索
		const ContextServiceV2 = require('../application/services/ContextServiceV2');
		const contextService = new ContextServiceV2(projectRoot);

		// 执行语义搜索（ContextServiceV2 使用 limit 参数；JsonAdapter 返回 score，MilvusAdapter 返回 similarity）
		let results = await contextService.search(text, { limit: topK + 5 });

		if (!Array.isArray(results)) {
			results = [];
		}

		// 统一使用 similarity 字段
		const getSim = r => r.similarity ?? 0;

		// 关键词回退时对所有匹配项返回 similarity:1，需按关键词命中率重算相似度
		const queryWords = text.toLowerCase().split(/\s+/).filter(w => w.length > 1);
		const isKeywordFallback = queryWords.length > 0 && results.every(r => getSim(r) === 1);

		const computeDisplaySim = (r) => {
			const raw = getSim(r);
			if (!isKeywordFallback || raw < 1) return raw;
			const target = [(r.content || ''), ...(r.metadata ? Object.values(r.metadata).filter(v => typeof v === 'string') : [])].join(' ').toLowerCase();
			let matches = 0;
			for (const w of queryWords) {
				if (target.includes(w)) matches++;
			}
			return Math.round((matches / queryWords.length) * 100) / 100;
		};

		let recipes = results
			.map(r => ({ r, sim: computeDisplaySim(r) }))
			.filter(({ sim }) => sim >= threshold)
			.sort((a, b) => b.sim - a.sim)
			.slice(0, topK)
			.map(({ r, sim }) => {
				const sourcePath = r.metadata?.sourcePath || '';
				const recipeName = sourcePath.split('/').pop() || 'Unknown Recipe';
				return { recipeName, similarity: sim };
			});

		return recipes;
	} catch (_) {
		return [];
	}
}

module.exports = {
	findSimilarRecipes
};
