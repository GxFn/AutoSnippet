#!/usr/bin/env node

/**
 * 候选与已有 Recipe 的相似度分析
 * 基于 ContextService 语义检索，返回相似 Recipe 列表供审核参考
 */

const path = require('path');

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
	const threshold = options.threshold ?? DEFAULT_THRESHOLD;
	const topK = options.topK ?? DEFAULT_TOP_K;

	if (!candidate || !projectRoot) return [];

	const queryText = [
		candidate.title || '',
		candidate.summary || '',
		candidate.code || '',
		candidate.usageGuide || ''
	].filter(Boolean).join('\n\n').slice(0, 8000);

	if (!queryText.trim()) return [];

	try {
		const { getInstance } = require('../context');
		const service = getInstance(projectRoot);
		const items = await service.search(queryText, {
			limit: topK,
			filter: { type: 'recipe' },
			includeContent: false
		});

		const results = [];
		for (const it of items) {
			const sim = Number(it.similarity) || 0;
			if (sim < threshold) continue;
			const sourcePath = it.metadata?.sourcePath || it.metadata?.name || it.id || '';
			const recipeName = sourcePath ? path.basename(sourcePath) : (it.id || '').replace(/^recipe_/, '');
			if (recipeName && !results.some(r => r.recipeName === recipeName)) {
				results.push({ recipeName, similarity: Math.round(sim * 100) / 100 });
			}
		}
		return results;
	} catch (e) {
		return [];
	}
}

module.exports = {
	findSimilarRecipes
};
