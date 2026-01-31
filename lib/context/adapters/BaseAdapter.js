#!/usr/bin/env node

/**
 * 上下文存储 - Storage Adapter 接口定义
 * 实现类：JsonAdapter、可选 SqliteAdapter
 *
 * ContextItem: { id, content, vector?, metadata, parentId? }
 * metadata: { type, sourcePath, sourceHash?, category?, module?, chunkIndex?, sectionTitle?, updatedAt }
 *
 * SearchOptions: { limit?, filter?: { type?, category?, module? }, metric? }
 */

/**
 * BaseAdapter 接口（抽象，不直接实例化）
 */
class BaseAdapter {
	/**
	 * @param {string} projectRoot
	 * @param {Object} options
	 */
	constructor(projectRoot, options = {}) {
		this.projectRoot = projectRoot;
		this.options = options;
	}

	/**
	 * 初始化存储（如创建目录、建表）
	 * @returns {Promise<void>}
	 */
	async init() {
		throw new Error('BaseAdapter.init() must be implemented');
	}

	/**
	 * 添加或更新一条上下文条目
	 * @param {Object} item ContextItem
	 * @returns {Promise<void>}
	 */
	async upsert(item) {
		throw new Error('BaseAdapter.upsert() must be implemented');
	}

	/**
	 * 批量添加或更新上下文条目（默认实现：逐条 upsert，子类可优化）
	 * @param {Object[]} items ContextItem[]
	 * @returns {Promise<void>}
	 */
	async batchUpsert(items) {
		for (const item of items) {
			await this.upsert(item);
		}
	}

	/**
	 * 按 id 删除一条
	 * @param {string} id
	 * @returns {Promise<void>}
	 */
	async remove(id) {
		throw new Error('BaseAdapter.remove() must be implemented');
	}

	/**
	 * 按 id 获取一条
	 * @param {string} id
	 * @returns {Promise<Object|null>} ContextItem or null
	 */
	async getById(id) {
		throw new Error('BaseAdapter.getById() must be implemented');
	}

	/**
	 * 向量相似度搜索
	 * @param {number[]} queryVector
	 * @param {Object} options { limit?, filter?, metric? }
	 * @returns {Promise<Object[]>} ContextItem[] with similarity
	 */
	async searchVector(queryVector, options = {}) {
		throw new Error('BaseAdapter.searchVector() must be implemented');
	}

	/**
	 * 按 metadata 过滤查询（可选，JsonAdapter 可先返回全部再内存过滤）
	 * @param {Object} filter { type?, category?, module? }
	 * @returns {Promise<Object[]>} ContextItem[]
	 */
	async searchByFilter(filter = {}) {
		throw new Error('BaseAdapter.searchByFilter() must be implemented');
	}

	/**
	 * 列出所有 id
	 * @returns {Promise<string[]>}
	 */
	async listIds() {
		throw new Error('BaseAdapter.listIds() must be implemented');
	}

	/**
	 * 清空索引
	 * @returns {Promise<void>}
	 */
	async clear() {
		throw new Error('BaseAdapter.clear() must be implemented');
	}

	/**
	 * 获取统计信息
	 * @returns {{ count: number, version?: string }}
	 */
	getStats() {
		throw new Error('BaseAdapter.getStats() must be implemented');
	}
}

module.exports = BaseAdapter;
