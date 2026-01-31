#!/usr/bin/env node

/**
 * 上下文存储 - 服务层入口
 * 对外 API: search(query, options), getById(id), upsert(item), remove(id)
 * 按 projectRoot 缓存实例，供 Guard/Search/Chat 使用
 */

const path = require('path');
const fs = require('fs');
const paths = require('../infra/paths');
const persistence = require('./persistence');
const JsonAdapter = require('./adapters/JsonAdapter');
const defaults = require('../infra/defaults');

function createAdapter(projectRoot, config) {
	const adapterName = (config.storage && config.storage.adapter) || defaults.DEFAULT_STORAGE_ADAPTER;
	switch (adapterName) {
		case 'json':
			return new JsonAdapter(projectRoot, config.storage);
		case 'lance':
			try {
				const LanceAdapter = require('./adapters/LanceAdapter');
				return new LanceAdapter(projectRoot, config.storage);
			} catch (e) {
				if (e.code === 'MODULE_NOT_FOUND') {
					throw new Error('LanceDB 未安装。请执行: npm install @lancedb/lancedb');
				}
				throw e;
			}
		default:
			throw new Error(`不支持的 context 存储适配器: ${adapterName}。可选: ${defaults.STORAGE_ADAPTERS.join(', ')}`);
	}
}

const instanceCache = new Map();

/**
 * 从 boxspec 读取 context 配置，若无则返回默认
 * @param {string} projectRoot
 */
function getContextConfig(projectRoot) {
	const specPath = path.join(projectRoot, defaults.ROOT_SPEC_FILENAME);
	if (!fs.existsSync(specPath)) {
		return { storage: { adapter: defaults.DEFAULT_STORAGE_ADAPTER }, index: {} };
	}
	try {
		const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
		return spec.context || { storage: { adapter: defaults.DEFAULT_STORAGE_ADAPTER }, index: {} };
	} catch (e) {
		return { storage: { adapter: defaults.DEFAULT_STORAGE_ADAPTER }, index: {} };
	}
}

/**
 * 获取或创建 ContextService 实例（按 projectRoot 缓存）
 * @param {string} projectRoot
 * @returns {ContextService}
 */
function getInstance(projectRoot) {
	if (!projectRoot) return null;
	let service = instanceCache.get(projectRoot);
	if (!service) {
		service = new ContextService(projectRoot);
		instanceCache.set(projectRoot, service);
	}
	return service;
}

/**
 * 清除某项目或全部缓存（用于测试或重载配置）
 * @param {string} [projectRoot] 不传则清空全部
 */
function clearCache(projectRoot) {
	if (projectRoot) {
		instanceCache.delete(projectRoot);
	} else {
		instanceCache.clear();
	}
}

class ContextService {
	constructor(projectRoot) {
		this.projectRoot = projectRoot;
		persistence.cleanupStaleTmpFiles(projectRoot);
		persistence.checkAndMigrate(projectRoot);
		this.config = getContextConfig(projectRoot);
		this.adapter = createAdapter(projectRoot, this.config);
	}

	/**
	 * 语义搜索：query 为字符串时先 embed 再向量检索；支持关键词混合
	 * @param {string|number[]} query 查询文本或已计算好的 queryVector
	 * @param {Object} options { limit?, filter?, keywords?, includeContent?, mode?: 'semantic'|'keyword'|'hybrid' }
	 * @returns {Promise<Object[]>} ContextItem[] with similarity
	 */
	async search(query, options = {}) {
		const limit = options.limit ?? 5;
		const filter = options.filter;
		const keywords = options.keywords;
		const mode = options.mode || 'semantic';
		const includeContent = options.includeContent !== false;

		let queryVector = [];
		let searchKeywords = keywords;

		if (Array.isArray(query) && query.length > 0 && typeof query[0] === 'number') {
			queryVector = query;
		} else if (typeof query === 'string' && query.trim()) {
			if (mode === 'keyword') {
				searchKeywords = keywords || [query];
			} else if (mode === 'hybrid') {
				searchKeywords = keywords ? [...keywords, query] : [query];
			}
			if (mode !== 'keyword') {
				const AiFactory = require('../ai/AiFactory');
				const ai = await AiFactory.getProvider(this.projectRoot);
				if (ai && typeof ai.embed === 'function') {
					const vec = await ai.embed(query);
					queryVector = Array.isArray(vec) && vec[0] !== undefined
						? (Array.isArray(vec[0]) ? vec[0] : vec) : [];
				}
			}
		}

		const results = await this.adapter.searchVector(queryVector, {
			limit,
			filter,
			metric: 'cosine',
			keywords: searchKeywords
		});

		if (!includeContent) {
			return results.map(r => ({
				id: r.id,
				metadata: r.metadata || {},
				similarity: r.similarity
			}));
		}
		return results;
	}

	async getById(id) {
		return this.adapter.getById(id);
	}

	async upsert(item) {
		await this.adapter.upsert(item);
		const stats = await Promise.resolve(this.adapter.getStats());
		persistence.updateManifest(this.projectRoot, { count: stats.count });
	}

	async batchUpsert(items) {
		if (!items || items.length === 0) return;
		await this.adapter.batchUpsert(items);
		const stats = await Promise.resolve(this.adapter.getStats());
		persistence.updateManifest(this.projectRoot, { count: stats.count });
	}

	async remove(id) {
		await this.adapter.remove(id);
		const stats = await Promise.resolve(this.adapter.getStats());
		persistence.updateManifest(this.projectRoot, { count: stats.count });
	}

	async clear() {
		await this.adapter.clear();
		persistence.updateManifest(this.projectRoot, { count: 0, indexVersion: (persistence.readManifest(this.projectRoot).indexVersion || 0) + 1 });
	}

	async getStats() {
		return Promise.resolve(this.adapter.getStats());
	}

	/**
	 * 获取底层 Adapter（供 embed 管道等直接写入）
	 */
	getAdapter() {
		return this.adapter;
	}
}

module.exports = {
	ContextService,
	getInstance,
	clearCache,
	getContextConfig
};
