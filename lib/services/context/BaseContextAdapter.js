/**
 * Base Context Adapter - 所有 Adapter 的基类
 * 提供通用功能和标准接口实现
 */
const IContextAdapter = require('./IContextAdapter');

class BaseContextAdapter extends IContextAdapter {
	/**
	 * @param {string} projectRoot 项目根目录
	 * @param {Object} config Adapter 配置
	 */
	constructor(projectRoot, config = {}) {
		super();
		this.projectRoot = projectRoot;
		this.config = config;
		this.initialized = false;
	}

	/**
	 * 获取适配器信息
	 * @returns {Object}
	 */
	getInfo() {
		return {
			name: this.constructor.name,
			projectRoot: this.projectRoot,
			initialized: this.initialized,
			version: '1.0.0'
		};
	}

	/**
	 * 验证条目格式
	 * @protected
	 * @param {Object} item 条目
	 * @throws {Error}
	 */
	validateItem(item) {
		if (!item || typeof item !== 'object') {
			throw new Error('Item must be an object');
		}
		if (!item.id || typeof item.id !== 'string') {
			throw new Error('Item must have a valid id (string)');
		}
		if (!item.content || typeof item.content !== 'string') {
			throw new Error('Item must have valid content (string)');
		}
		if (!item.metadata || typeof item.metadata !== 'object') {
			throw new Error('Item must have metadata (object)');
		}
		if (item.vector && !Array.isArray(item.vector)) {
			throw new Error('Item vector must be an array');
		}
	}

	/**
	 * 验证初始化状态
	 * @protected
	 * @throws {Error}
	 */
	ensureInitialized() {
		if (!this.initialized) {
			throw new Error(`${this.constructor.name} not initialized. Call init() first.`);
		}
	}

	/**
	 * 默认的批量删除实现
	 * @param {Array<string>} ids 条目ID数组
	 * @returns {Promise<void>}
	 */
	async batchRemove(ids) {
		for (const id of ids) {
			await this.remove(id);
		}
	}

	/**
	 * 默认的统计实现（通过 list 获取）
	 * @param {Object} filter 过滤条件
	 * @returns {Promise<number>}
	 */
	async count(filter = {}) {
		const items = await this.list({ filter });
		return items.length;
	}

	/**
	 * 默认的健康检查实现
	 * @returns {Promise<Object>}
	 */
	async healthCheck() {
		try {
			if (!this.initialized) {
				return {
					healthy: false,
					message: 'Adapter not initialized'
				};
			}

			// 尝试获取统计信息
			const count = await this.count().catch(() => 0);
			
			return {
				healthy: true,
				message: `${this.constructor.name} is healthy`,
				itemCount: count
			};
		} catch (error) {
			return {
				healthy: false,
				message: error.message
			};
		}
	}

	/**
	 * 默认的关闭实现
	 * @returns {Promise<void>}
	 */
	async close() {
		this.initialized = false;
	}

	/**
	 * 计算余弦相似度
	 * @protected
	 * @param {Array<number>} vec1 向量1
	 * @param {Array<number>} vec2 向量2
	 * @returns {number} 相似度（0-1）
	 */
	cosineSimilarity(vec1, vec2) {
		if (!vec1 || !vec2 || vec1.length !== vec2.length) {
			return 0;
		}

		let dotProduct = 0;
		let norm1 = 0;
		let norm2 = 0;

		for (let i = 0; i < vec1.length; i++) {
			dotProduct += vec1[i] * vec2[i];
			norm1 += vec1[i] * vec1[i];
			norm2 += vec2[i] * vec2[i];
		}

		if (norm1 === 0 || norm2 === 0) {
			return 0;
		}

		return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
	}

	/**
	 * 应用过滤条件
	 * @protected
	 * @param {Array<Object>} items 条目数组
	 * @param {Object} filter 过滤条件
	 * @returns {Array<Object>}
	 */
	applyFilter(items, filter = {}) {
		if (!filter || Object.keys(filter).length === 0) {
			return items;
		}

		return items.filter(item => {
			for (const [key, value] of Object.entries(filter)) {
				// 支持元数据过滤
				if (key.startsWith('metadata.')) {
					const metaKey = key.substring(9);
					if (item.metadata && item.metadata[metaKey] !== value) {
						return false;
					}
				} else if (item[key] !== value) {
					return false;
				}
			}
			return true;
		});
	}

	/**
	 * 应用分页
	 * @protected
	 * @param {Array<Object>} items 条目数组
	 * @param {Object} options 选项
	 * @returns {Array<Object>}
	 */
	applyPagination(items, options = {}) {
		const { limit, offset = 0 } = options;
		
		if (offset > 0) {
			items = items.slice(offset);
		}

		if (limit && limit > 0) {
			items = items.slice(0, limit);
		}

		return items;
	}

	/**
	 * 字符串表示
	 * @returns {string}
	 */
	toString() {
		return `${this.constructor.name}(projectRoot=${this.projectRoot})`;
	}
}

module.exports = BaseContextAdapter;
