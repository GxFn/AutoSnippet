#!/usr/bin/env node

/**
 * 评分系统（recipeStats）单元测试
 * 验证：使用热度公式、综合权威分公式、双写、setAuthority、recordRecipeUsage
 */

const fs = require('fs');
const path = require('path');
const recipeStats = require('../../lib/recipe/recipeStats');

function assert(cond, msg) {
	if (!cond) throw new Error(msg || 'Assertion failed');
}

function testGetUsageHeat() {
	const entry = { guardUsageCount: 2, humanUsageCount: 5, aiUsageCount: 3, authority: 4 };
	const heat = recipeStats.getUsageHeat(entry, {});
	// 默认权重 w_guard=1, w_human=2, w_ai=1 => 2*1 + 5*2 + 3*1 = 15
	assert(heat === 15, `getUsageHeat 默认权重应为 15，得到 ${heat}`);
	const heatCustom = recipeStats.getUsageHeat(entry, { w_guard: 2, w_human: 1, w_ai: 1 });
	assert(heatCustom === 2 * 2 + 5 * 1 + 3 * 1, `getUsageHeat 自定义权重`);
}

function testGetAuthorityScore() {
	const entry = { guardUsageCount: 2, humanUsageCount: 5, aiUsageCount: 3, authority: 4 };
	const all = [
		entry,
		{ guardUsageCount: 0, humanUsageCount: 0, aiUsageCount: 0, authority: 0 }
	];
	const score = recipeStats.getAuthorityScore(entry, all, { usageWeight: 0.5 });
	// usageHeat(entry)=15, maxHeat=15 => normHeat=1; authNorm=4/5=0.8
	// authorityScore = 0.5*1 + 0.5*0.8 = 0.9
	assert(score >= 0.89 && score <= 0.91, `getAuthorityScore 应为约 0.9，得到 ${score}`);
	const onlyOne = recipeStats.getAuthorityScore(entry, [entry], { usageWeight: 0.5 });
	assert(onlyOne >= 0.89 && onlyOne <= 0.91, `单条时综合分`);
	const zeroHeat = recipeStats.getAuthorityScore(
		{ guardUsageCount: 0, humanUsageCount: 0, aiUsageCount: 0, authority: 5 },
		[{ guardUsageCount: 0, humanUsageCount: 0, aiUsageCount: 0, authority: 5 }],
		{ usageWeight: 0.5 }
	);
	// normHeat = 0/1 = 0, authNorm = 1 => 0.5*0 + 0.5*1 = 0.5
	assert(zeroHeat >= 0.49 && zeroHeat <= 0.51, `零热度、权威 5 时应为 0.5，得到 ${zeroHeat}`);
}

function testGetRecipeStatsEmpty() {
	const projectRoot = path.resolve(__dirname, '../..');
	const noFileDir = path.join(projectRoot, 'test', 'no-stats-dir-' + Date.now());
	fs.mkdirSync(noFileDir, { recursive: true });
	try {
		const stats = recipeStats.getRecipeStats(noFileDir);
		assert(stats.schemaVersion === 1);
		assert(typeof stats.byTrigger === 'object' && Object.keys(stats.byTrigger).length === 0);
		assert(typeof stats.byFile === 'object' && Object.keys(stats.byFile).length === 0);
	} finally {
		try { fs.rmSync(noFileDir, { recursive: true, force: true }); } catch (_) {}
	}
}

function testRecordAndSetAuthority() {
	const projectRoot = path.resolve(__dirname, '../..');
	const tmpDir = path.join(projectRoot, 'test', 'tmp-recipestats-' + Date.now());
	fs.mkdirSync(tmpDir, { recursive: true });
	try {
		recipeStats.recordRecipeUsage(tmpDir, { trigger: '@Test', recipeFilePath: 'Knowledge/recipes/Test.md', source: 'human' });
		recipeStats.recordRecipeUsage(tmpDir, { trigger: '@Test', recipeFilePath: 'Knowledge/recipes/Test.md', source: 'human' });
		recipeStats.recordRecipeUsage(tmpDir, { trigger: '@Test', recipeFilePath: 'Knowledge/recipes/Test.md', source: 'guard' });
		const stats = recipeStats.getRecipeStats(tmpDir);
		assert(stats.byTrigger['@Test'], 'byTrigger 应有 @Test');
		assert(stats.byTrigger['@Test'].humanUsageCount === 2 && stats.byTrigger['@Test'].guardUsageCount === 1, 'human 2 guard 1');
		assert(stats.byFile['Test.md'], 'byFile 应有 Test.md');
		assert(stats.byFile['Test.md'].humanUsageCount === 2 && stats.byFile['Test.md'].guardUsageCount === 1, 'byFile human 2 guard 1');

		recipeStats.setAuthority(tmpDir, { trigger: '@Test', recipeFilePath: 'Knowledge/recipes/Test.md' }, 4);
		const stats2 = recipeStats.getRecipeStats(tmpDir);
		assert(stats2.byTrigger['@Test'].authority === 4, 'setAuthority 后 byTrigger authority 应为 4');
		assert(stats2.byFile['Test.md'].authority === 4, 'setAuthority 后 byFile authority 应为 4');
	} finally {
		try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
	}
}

function main() {
	testGetUsageHeat();
	testGetAuthorityScore();
	testGetRecipeStatsEmpty();
	testRecordAndSetAuthority();
	console.log('recipeStats 单元测试通过');
}

main();
