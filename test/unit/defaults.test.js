#!/usr/bin/env node

/**
 * defaults.js 单元测试
 * 覆盖：inferCategory、常量一致性
 */

const path = require('path');
const defaults = require('../../lib/infrastructure/config/Defaults');

function assert(cond, msg) {
	if (!cond) throw new Error(msg || 'Assertion failed');
}

function testInferCategory() {
	// frontmatter 优先
	assert(defaults.inferCategory('any.md', '---\ncategory: network\n---\nbody') === 'network');
	assert(defaults.inferCategory('x.md', '---\ncategory: "video"\n---') === 'video');
	assert(defaults.inferCategory('x.md', '---\ncategory: \'foundation\'\n---') === 'foundation');

	// 路径匹配
	assert(defaults.inferCategory('BDNetworkControl-Recipe.md', '') === 'network');
	assert(defaults.inferCategory('Net-Request.md', '') === 'network');
	assert(defaults.inferCategory('VideoPlayer.md', '') === 'video');
	assert(defaults.inferCategory('Scheme-Dispatch.md', '') === 'navigation');
	assert(defaults.inferCategory('BDPyramid-Service.md', '') === 'foundation');
	assert(defaults.inferCategory('TableViewCell.md', '') === 'ui');

	// 默认
	assert(defaults.inferCategory('Other.md', '') === 'general');
	assert(defaults.inferCategory('', '') === 'general');
}

function testConstants() {
	assert(defaults.RECIPES_DIR === 'AutoSnippet/recipes', `Expected 'AutoSnippet/recipes', got '${defaults.RECIPES_DIR}'`);
	assert(defaults.RECIPES_INDEX === 'AutoSnippet/recipes/index.json', `Expected 'AutoSnippet/recipes/index.json', got '${defaults.RECIPES_INDEX}'`);
	assert(defaults.SPMMAP_PATH.includes('AutoSnippet.spmmap.json'));
	assert(defaults.SPEC_FILENAME === 'AutoSnippet.boxspec.json');
	assert(defaults.DEFAULT_STORAGE_ADAPTER === 'json');
	assert(defaults.STORAGE_ADAPTERS.includes('json') && defaults.STORAGE_ADAPTERS.includes('milvus'));
	assert(defaults.SOURCE_TYPE_RECIPE === 'recipe');
	assert(defaults.SOURCE_TYPE_TARGET_README === 'target-readme');
	assert(defaults.DEFAULT_SOURCES.length === 1 && defaults.DEFAULT_SOURCES[0].path === defaults.RECIPES_DIR, `Expected DEFAULT_SOURCES path to be '${defaults.RECIPES_DIR}'`);
	assert(defaults.DEFAULT_CHUNKING.strategy === 'whole');
	assert(defaults.README_NAMES.includes('README.md') && defaults.README_NAMES.includes('readme.md'));
	assert(typeof defaults.GUARD_CONTEXT_EXCERPT_LIMIT === 'number' && defaults.GUARD_CONTEXT_EXCERPT_LIMIT > 0);
}

function main() {
	testInferCategory();
	testConstants();
	console.log('✅ defaults.test.js 通过');
}

main();
