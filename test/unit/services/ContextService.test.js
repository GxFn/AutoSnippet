#!/usr/bin/env node

/**
 * Context Service 单元测试
 */
const assert = require('assert');
const path = require('path');
const os = require('os');
const ContextService = require('../../../lib/services/context/ContextService');
const AdapterManager = require('../../../lib/services/context/AdapterManager');
const BaseContextAdapter = require('../../../lib/services/context/BaseContextAdapter');
const IContextAdapter = require('../../../lib/services/context/IContextAdapter');

// 模拟 Adapter
class MockContextAdapter extends BaseContextAdapter {
	constructor(projectRoot, config = {}) {
		super(projectRoot, config);
		this.store = new Map();
	}

	async init(options = {}) {
		this.initialized = true;
	}

	async upsert(item) {
		this.ensureInitialized();
		this.validateItem(item);
		this.store.set(item.id, { ...item });
	}

	async batchUpsert(items) {
		for (const item of items) {
			await this.upsert(item);
		}
	}

	async getById(id) {
		this.ensureInitialized();
		return this.store.get(id) || null;
	}

	async remove(id) {
		this.ensureInitialized();
		this.store.delete(id);
	}

	async search(queryVector, options = {}) {
		this.ensureInitialized();
		const items = Array.from(this.store.values());
		
		// 计算相似度并排序
		const results = items
			.filter(item => item.vector)
			.map(item => ({
				...item,
				score: this.cosineSimilarity(queryVector, item.vector)
			}))
			.sort((a, b) => b.score - a.score);

		const limit = options.limit || 10;
		return results.slice(0, limit);
	}

	async list(options = {}) {
		this.ensureInitialized();
		let items = Array.from(this.store.values());
		
		if (options.filter) {
			items = this.applyFilter(items, options.filter);
		}

		return this.applyPagination(items, options);
	}

	async count(filter = {}) {
		this.ensureInitialized();
		const items = await this.list({ filter });
		return items.length;
	}

	async clear() {
		this.ensureInitialized();
		this.store.clear();
	}
}

// 简单的模拟
class MockLogger {
	debug(msg) {}
	info(msg) {}
	warn(msg) { console.warn(msg); }
	error(msg) { console.error(msg); }
}

class MockContainer {
	resolve(name) {
		if (name === 'logger') return new MockLogger();
		return null;
	}
}

class MockConfig {
	constructor(data = {}) {
		this.data = data;
	}
	get(key, defaultValue) {
		const keys = key.split('.');
		let value = this.data;
		for (const k of keys) {
			if (value && typeof value === 'object' && k in value) {
				value = value[k];
			} else {
				return defaultValue;
			}
		}
		return value;
	}
}

// 简化的 assert 包装
function ok(cond, msg) {
	if (!cond) throw new Error(msg || 'Assertion failed');
}

function strictEqual(a, b, msg) {
	if (a !== b) {
		throw new Error(msg || `Expected ${a} to equal ${b}`);
	}
}

// === 测试 AdapterManager ===
async function testAdapterManager() {
	console.log('  → 测试 AdapterManager...');
	const logger = new MockLogger();
	const container = new MockContainer();
	const adapterManager = new AdapterManager(container, logger);

	// 1. 注册 adapter
	adapterManager.register('mock', MockContextAdapter);
	ok(adapterManager.has('mock'), 'Should register adapter');

	// 2. 获取 adapter 实例
	const adapter = adapterManager.getInstance('mock', '/tmp/project');
	ok(adapter instanceof MockContextAdapter, 'Should get adapter instance');

	// 3. 测试未知 adapter
	try {
		adapterManager.getInstance('unknown', '/tmp/project');
		throw new Error('Should throw for unknown adapter');
	} catch (error) {
		ok(error.message.includes('unknown'), 'Should throw error for unknown adapter');
	}

	// 4. 设置当前 adapter
	adapterManager.setCurrent('/tmp/project', 'mock');
	strictEqual(adapterManager.getCurrentName('/tmp/project'), 'mock', 'Should set current adapter');

	// 5. 列出所有 adapter
	adapterManager.register('mock2', MockContextAdapter);
	const list = adapterManager.list();
	strictEqual(list.length, 2, 'Should list 2 adapters');
	ok(list.includes('mock'), 'Should include mock adapter');
	ok(list.includes('mock2'), 'Should include mock2 adapter');

	// 6. 实例缓存（每个项目独立）
	const a1 = adapterManager.getInstance('mock', '/tmp/project1');
	const a2 = adapterManager.getInstance('mock', '/tmp/project1');
	const a3 = adapterManager.getInstance('mock', '/tmp/project2');
	ok(a1 === a2, 'Should cache instances per project');
	ok(a1 !== a3, 'Different projects should have different instances');

	// 7. 取消注册
	adapterManager.register('other', MockContextAdapter);
	adapterManager.unregister('other');
	ok(!adapterManager.has('other'), 'Should unregister adapter');
	ok(adapterManager.has('mock'), 'Other adapters should remain');

	// 8. 统计信息
	const stats = adapterManager.getStats();
	ok(stats.total >= 2, 'Should have statistics');

	// 9. 清理特定项目缓存
	adapterManager.clearCache('/tmp/project1');
	strictEqual(adapterManager.getCurrent('/tmp/project1'), null, 'Should clear project cache');

	// 10. 清理所有缓存
	adapterManager.clearCache();
	strictEqual(adapterManager.getStats().cached, 0, 'Should clear all cache');

	console.log('  ✅ AdapterManager tests passed');
}

// === 测试 BaseContextAdapter ===
async function testBaseContextAdapter() {
	console.log('  → 测试 BaseContextAdapter...');
	const adapter = new MockContextAdapter('/tmp/project');

	// 1. 创建实例
	strictEqual(adapter.projectRoot, '/tmp/project', 'Should set project root');
	strictEqual(adapter.initialized, false, 'Should not be initialized');

	// 2. 获取信息
	const info = adapter.getInfo();
	strictEqual(info.projectRoot, '/tmp/project', 'Should get project root');
	strictEqual(info.initialized, false, 'Should get initialized status');

	// 3. 初始化
	await adapter.init();
	strictEqual(adapter.initialized, true, 'Should initialize');

	// 4. 验证 item
	try {
		adapter.validateItem({});
		throw new Error('Should throw for empty item');
	} catch (error) {
		ok(error.message.includes('id'), 'Should require id');
	}

	try {
		adapter.validateItem({ id: '1' });
		throw new Error('Should throw for incomplete item');
	} catch (error) {
		ok(error.message.includes('content'), 'Should require content');
	}

	// 正常 item 不应报错
	adapter.validateItem({
		id: '1',
		content: 'test',
		metadata: {}
	});

	// 5. 余弦相似度
	const vec1 = [1, 0, 0];
	const vec2 = [1, 0, 0];
	const sim1 = adapter.cosineSimilarity(vec1, vec2);
	strictEqual(sim1, 1, 'Same vectors should have similarity 1');

	const vec3 = [1, 0, 0];
	const vec4 = [0, 1, 0];
	const sim2 = adapter.cosineSimilarity(vec3, vec4);
	strictEqual(sim2, 0, 'Orthogonal vectors should have similarity 0');

	// 6. 过滤器
	const items = [
		{ id: '1', metadata: { type: 'code' } },
		{ id: '2', metadata: { type: 'doc' } },
		{ id: '3', metadata: { type: 'code' } }
	];
	const filtered = adapter.applyFilter(items, { 'metadata.type': 'code' });
	strictEqual(filtered.length, 2, 'Should filter items');

	// 7. 分页
	const testItems = [1, 2, 3, 4, 5];
	const page1 = adapter.applyPagination(testItems, { limit: 2 });
	strictEqual(page1.length, 2, 'Should limit page size');

	const page2 = adapter.applyPagination(testItems, { limit: 2, offset: 2 });
	strictEqual(page2.length, 2, 'Should apply offset');
	strictEqual(page2[0], 3, 'Should start from offset');

	console.log('  ✅ BaseContextAdapter tests passed');
}

// === 测试 ContextService ===
async function testContextService() {
	console.log('  → 测试 ContextService...');
	const container = new MockContainer();
	const logger = new MockLogger();
	const config = new MockConfig({
		context: {
			storage: {
				adapter: 'mock'
			}
		}
	});
	const contextService = new ContextService({
		container,
		logger,
		config
	});

	contextService.registerAdapter('mock', MockContextAdapter);
	await contextService.initialize({ autoLoad: false, defaultAdapter: 'mock' });

	// 1. 列出 adapters
	const adapters = contextService.listAdapters();
	ok(adapters.includes('mock'), 'Should list adapters');

	// 2. Upsert
	await contextService.upsert('/tmp/project', {
		id: 'item1',
		content: 'test content',
		metadata: { type: 'code' }
	});

	const item = await contextService.getById('/tmp/project', 'item1');
	strictEqual(item.content, 'test content', 'Should upsert item');

	// 3. Batch upsert
	const items = [
		{ id: 'item2', content: 'content2', metadata: { type: 'code' } },
		{ id: 'item3', content: 'content3', metadata: { type: 'doc' } }
	];
	await contextService.batchUpsert('/tmp/project', items);
	
	const count = await contextService.count('/tmp/project');
	strictEqual(count, 3, 'Should batch upsert');

	// 4. Remove
	await contextService.remove('/tmp/project', 'item1');
	const removed = await contextService.getById('/tmp/project', 'item1');
	strictEqual(removed, null, 'Should remove item');

	// 5. Search
	await contextService.clear('/tmp/project');
	await contextService.upsert('/tmp/project', {
		id: 'search1',
		content: 'test1',
		vector: [1, 0, 0],
		metadata: {}
	});
	await contextService.upsert('/tmp/project', {
		id: 'search2',
		content: 'test2',
		vector: [0, 1, 0],
		metadata: {}
	});

	const results = await contextService.search('/tmp/project', [1, 0, 0], { limit: 1 });
	strictEqual(results.length, 1, 'Should search items');
	strictEqual(results[0].id, 'search1', 'Should return best match');

	// 6. List
	const listed = await contextService.list('/tmp/project');
	strictEqual(listed.length, 2, 'Should list items');

	// 7. Clear
	await contextService.clear('/tmp/project');
	const countAfterClear = await contextService.count('/tmp/project');
	strictEqual(countAfterClear, 0, 'Should clear all items');

	// 8. Switch adapter
	contextService.registerAdapter('mock2', MockContextAdapter);
	await contextService.switchAdapter('/tmp/project', 'mock2');
	strictEqual(contextService.getCurrentAdapter('/tmp/project'), 'mock2', 'Should switch adapter');

	// 9. Health check
	const health = await contextService.healthCheck('/tmp/project');
	strictEqual(health.healthy, true, 'Should perform health check');

	// 10. Statistics
	const stats = contextService.getStats();
	strictEqual(stats.service, 'context', 'Should get statistics');

	// 11. 缺少 projectRoot 应报错
	try {
		await contextService.upsert(null, { id: '1', content: 'test', metadata: {} });
		throw new Error('Should throw for missing projectRoot');
	} catch (error) {
		ok(error.message.includes('projectRoot'), 'Should require projectRoot');
	}

	console.log('  ✅ ContextService tests passed');
}

// === 测试 IContextAdapter 接口 ===
function testIContextAdapter() {
	console.log('  → 测试 IContextAdapter 接口...');
	
	ok(typeof IContextAdapter === 'function', 'IContextAdapter should be a function');
	
	const methods = [
		'getInfo', 'init', 'upsert', 'batchUpsert', 'getById',
		'remove', 'batchRemove', 'search', 'list', 'count',
		'clear', 'healthCheck', 'close'
	];

	const proto = IContextAdapter.prototype;
	for (const method of methods) {
		ok(typeof proto[method] === 'function', `Method ${method} should exist`);
	}

	console.log('  ✅ IContextAdapter tests passed');
}

// === 主测试运行器 ===
async function runAllTests() {
	console.log('\n🧪 Context Service 单元测试\n');
	
	try {
		testIContextAdapter();
		await testAdapterManager();
		await testBaseContextAdapter();
		await testContextService();
		
		console.log('\n✨ 所有测试通过！\n');
	} catch (error) {
		console.error('\n❌ 测试失败:', error.message);
		console.error(error.stack);
		process.exit(1);
	}
}

runAllTests();
