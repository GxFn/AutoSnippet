#!/usr/bin/env node

/**
 * LanceDB 适配器本地测试
 * 需先安装：asd install:full --lancedb 或 npm install @lancedb/lancedb
 * 运行：npm run test:unit:lance
 * 未安装时自动跳过，不纳入 CI
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

try {
	require('@lancedb/lancedb');
} catch (e) {
	if (e.code === 'MODULE_NOT_FOUND') {
		console.log('⏭️  LanceDB 未安装，跳过。运行 asd install:full --lancedb 后执行 npm run test:unit:lance');
		process.exit(0);
	}
	throw e;
}

const LanceAdapter = require('../../lib/context/adapters/LanceAdapter');

function assert(cond, msg) {
	if (!cond) throw new Error(msg || 'Assertion failed');
}

async function testLanceAdapter() {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-lance-test-'));
	try {
		const adapter = new LanceAdapter(tmpDir);
		await adapter.upsert({
			id: 'test_1',
			content: 'hello',
			vector: [0.1, 0.2],
			metadata: { type: 'recipe', sourcePath: 'r/a.md' }
		});
		const stats = await adapter.getStats();
		assert(stats.count === 1, 'count 应为 1');
		const ids = await adapter.listIds();
		assert(ids.includes('test_1'), 'listIds 应包含 test_1');
		const found = await adapter.getById('test_1');
		assert(found && found.content === 'hello', 'getById 应找到内容');
		const byFilter = await adapter.searchByFilter({ type: 'recipe' });
		assert(byFilter.length >= 1 && byFilter.some(r => r.content === 'hello'), 'searchByFilter 应找到内容');
		const vectorResults = await adapter.searchVector([0.1, 0.2], { limit: 3 });
		assert(vectorResults.length >= 1 && vectorResults[0].content === 'hello', 'searchVector 应找到内容');
		await adapter.remove('test_1');
		const statsAfter = await adapter.getStats();
		assert(statsAfter.count === 0, 'remove 后 count 应为 0');
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

async function main() {
	await testLanceAdapter();
	console.log('✅ context-lance.test.js 通过');
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
