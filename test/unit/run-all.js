#!/usr/bin/env node

/**
 * 运行所有单元测试
 * node test/unit/run-all.js
 */

const path = require('path');
const { execSync } = require('child_process');

const tests = [
	'test/unit/defaults.test.js',
	'test/unit/chunker.test.js',
	'test/unit/context.test.js',
	'test/unit/recipeStats.test.js',
	'test/unit/checksums-verify.test.js',
	'test/unit/services/ContextService.test.js',
	'test/unit/search/rankingEngine.test.js',
	'test/unit/quality/QualityScorer.test.js',
	'test/unit/guard/EnhancedGuardChecker.test.js'
];

const projectRoot = path.resolve(__dirname, '../../');
let failed = 0;

for (const t of tests) {
	try {
		execSync(`node ${t}`, { cwd: projectRoot, stdio: 'inherit' });
	} catch (e) {
		failed++;
	}
}

if (failed > 0) {
	console.error(`\n❌ ${failed} 个测试失败`);
	process.exit(1);
}
console.log('\n✨ 所有单元测试通过');
