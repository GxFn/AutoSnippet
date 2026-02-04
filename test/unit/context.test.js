#!/usr/bin/env node

/**
 * context 模块单元测试
 * 覆盖：constants、JsonAdapter 基本操作、IndexingPipeline.scan（路径型）、persistence
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createItemMetadata } = require('../../lib/context/constants');
const persistence = require('../../lib/context/persistence');
const JsonAdapter = require('../../lib/context/adapters/JsonAdapter');
const { run: _runPipeline, scan } = require('../../lib/context/IndexingPipeline');

function assert(cond, msg) {
	if (!cond) throw new Error(msg || 'Assertion failed');
}

function testCreateItemMetadata() {
	const m = createItemMetadata({ type: 'recipe', sourcePath: 'Knowledge/recipes/x.md' });
	assert(m.type === 'recipe');
	assert(m.sourcePath === 'Knowledge/recipes/x.md');
	assert(typeof m.updatedAt === 'number');
	assert(createItemMetadata().type === 'recipe');
}

async function testJsonAdapter() {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-context-test-'));
	try {
		const adapter = new JsonAdapter(tmpDir);
		await adapter.init();  // 初始化 adapter
		await adapter.upsert({
			id: 'test_1',
			content: 'hello',
			vector: [0.1, 0.2],
			metadata: { type: 'recipe', sourcePath: 'r/a.md' }
		});
		const stats = await Promise.resolve(adapter.getStats());
		assert(stats.count === 1);
		const found = await adapter.getById('test_1');
		assert(found && found.content === 'hello');
		await adapter.remove('test_1');
		assert((await Promise.resolve(adapter.getStats())).count === 0);
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

async function testScanPathSource() {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-scan-test-'));
	const recipesDir = path.join(tmpDir, 'Knowledge/recipes');
	fs.mkdirSync(recipesDir, { recursive: true });
	fs.writeFileSync(path.join(recipesDir, 'a.md'), '# A\ncontent a');
	fs.writeFileSync(path.join(recipesDir, 'b.md'), '# B\ncontent b');
	try {
		const items = await scan(tmpDir, {
			sources: [{ path: 'Knowledge/recipes', type: 'recipe' }]
		});
		assert(items.length >= 2, 'scan 应找到 2 个 md');
		assert(items.some(i => i.path.includes('a.md')));
		assert(items.some(i => i.type === 'recipe'));
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

function testPersistencePaths() {
	const paths = require('../../lib/infrastructure/config/Paths');
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-pers-test-'));
	try {
		const storagePath = paths.getContextStoragePath(tmpDir);
		const indexPath = paths.getContextIndexPath(tmpDir);
		assert(storagePath.includes('.autosnippet'));
		assert(indexPath.includes('.autosnippet'));
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

async function main() {
	testCreateItemMetadata();
	await testJsonAdapter();
	await testScanPathSource();
	testPersistencePaths();
	console.log('✅ context.test.js 通过');
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
