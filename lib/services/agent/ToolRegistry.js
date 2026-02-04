/**
 * ToolRegistry - 工具注册表
 * 
 * 管理所有可用工具的注册、查找和调用
 * Phase 5: Agent System
 */

const { ITool } = require('./ITool');
const path = require('path');
const fs = require('fs');

class ToolRegistry {
	/**
	 * @param {Object} container - 服务容器
	 * @param {Object} logger - 日志服务
	 */
	constructor(container, logger) {
		this.container = container;
		this.logger = logger;
		
		// 工具存储: Map<name, ToolClass>
		this._tools = new Map();
		
		// 工具实例缓存: Map<name, toolInstance>
		this._instances = new Map();
		
		// 工具分类索引: Map<category, Set<name>>
		this._categories = new Map();
		
		// 统计信息
		this._stats = {
			totalRegistered: 0,
			totalCalls: 0,
			successfulCalls: 0,
			failedCalls: 0
		};
	}

	/**
	 * 注册工具
	 * @param {string} name - 工具名称
	 * @param {Function|Object} ToolClass - 工具类或工具实例
	 * @param {Object} [options] - 选项
	 * @param {string} [options.category] - 工具分类
	 * @param {boolean} [options.singleton=true] - 是否单例
	 */
	register(name, ToolClass, options = {}) {
		if (this._tools.has(name)) {
			this.logger.warn(`Tool '${name}' already registered, overwriting`);
		}

		let { category, singleton = true } = options;

		// 如果传入的是实例而不是类，直接存储
		const isInstance = typeof ToolClass === 'object' && ToolClass !== null;

		// 如果未指定分类，尝试从工具信息中获取
		if (!category && isInstance && typeof ToolClass.getInfo === 'function') {
			try {
				const info = ToolClass.getInfo();
				category = info.category || category;
			} catch (error) {
				this.logger.warn(`Failed to infer category for tool '${name}': ${error.message}`);
			}
		}
		
		this._tools.set(name, {
			ToolClass,
			singleton,
			category,
			isInstance
		});

		// 更新分类索引
		if (category) {
			if (!this._categories.has(category)) {
				this._categories.set(category, new Set());
			}
			this._categories.get(category).add(name);
		}

		this._stats.totalRegistered++;
		this.logger.debug(`Registered tool: ${name}`);
	}

	/**
	 * 注销工具
	 * @param {string} name - 工具名称
	 */
	unregister(name) {
		if (!this._tools.has(name)) {
			this.logger.warn(`Tool '${name}' not found`);
			return;
		}

		const toolInfo = this._tools.get(name);
		
		// 清理分类索引
		if (toolInfo.category && this._categories.has(toolInfo.category)) {
			this._categories.get(toolInfo.category).delete(name);
		}

		// 清理实例
		this._instances.delete(name);
		this._tools.delete(name);
		
		this._stats.totalRegistered--;
		this.logger.debug(`Unregistered tool: ${name}`);
	}

	/**
	 * 检查工具是否存在
	 * @param {string} name - 工具名称
	 * @returns {boolean}
	 */
	has(name) {
		return this._tools.has(name);
	}

	/**
	 * 获取工具实例
	 * @param {string} name - 工具名称
	 * @param {Object} [config] - 工具配置
	 * @returns {ITool} 工具实例
	 */
	getInstance(name, config = {}) {
		if (!this._tools.has(name)) {
			throw new Error(`Tool '${name}' not found`);
		}

		const toolInfo = this._tools.get(name);

		// 如果存储的是实例，直接返回
		if (toolInfo.isInstance) {
			return toolInfo.ToolClass;
		}

		// 单例模式：复用实例
		if (toolInfo.singleton && this._instances.has(name)) {
			return this._instances.get(name);
		}

		// 创建新实例
		const instance = new toolInfo.ToolClass(this.container, config);

		// 验证实例实现了 ITool 接口
		if (typeof instance.execute !== 'function') {
			throw new Error(`Tool '${name}' must implement execute() method`);
		}

		// 缓存单例实例
		if (toolInfo.singleton) {
			this._instances.set(name, instance);
		}

		return instance;
	}

	/**
	 * 执行工具
	 * @param {string} name - 工具名称
	 * @param {Object} params - 参数
	 * @param {Object} [context] - 上下文
	 * @returns {Promise<Object>} 执行结果
	 */
	async execute(name, params, context = {}) {
		const startTime = Date.now();

		try {
			const tool = this.getInstance(name);

			// 验证参数
			if (typeof tool.validate === 'function') {
				const validation = tool.validate(params);
				if (!validation.valid) {
					throw new Error(`Parameter validation failed: ${validation.errors.join(', ')}`);
				}
			}

			// 执行工具
			this.logger.debug(`Executing tool: ${name}`);
			const result = await tool.execute(params, context);

			// 更新统计
			this._stats.totalCalls++;
			if (result.success) {
				this._stats.successfulCalls++;
			} else {
				this._stats.failedCalls++;
			}

			const duration = Date.now() - startTime;
			this.logger.debug(`Tool '${name}' completed in ${duration}ms`);

			return {
				...result,
				metadata: {
					...result.metadata,
					toolName: name,
					duration
				}
			};

		} catch (error) {
			this._stats.totalCalls++;
			this._stats.failedCalls++;
			
			this.logger.error(`Tool '${name}' execution failed:`, error);
			
			return {
				success: false,
				error: error.message,
				metadata: {
					toolName: name,
					duration: Date.now() - startTime
				}
			};
		}
	}

	/**
	 * 列出所有工具
	 * @param {Object} [filter] - 过滤条件
	 * @param {string} [filter.category] - 按分类过滤
	 * @returns {Array<string>} 工具名称列表
	 */
	list(filter = {}) {
		let tools = Array.from(this._tools.keys());

		if (filter.category) {
			const categoryTools = this._categories.get(filter.category);
			if (categoryTools) {
				tools = tools.filter(name => categoryTools.has(name));
			} else {
				tools = [];
			}
		}

		return tools;
	}

	/**
	 * 获取工具信息
	 * @param {string} name - 工具名称
	 * @returns {Object} 工具信息
	 */
	getInfo(name) {
		if (!this._tools.has(name)) {
			throw new Error(`Tool '${name}' not found`);
		}

		const tool = this.getInstance(name);
		const toolData = this._tools.get(name);

		return {
			name,
			...tool.getInfo(),
			category: toolData.category,
			singleton: toolData.singleton
		};
	}

	/**
	 * 列出所有分类
	 * @returns {Array<string>} 分类列表
	 */
	listCategories() {
		return Array.from(this._categories.entries()).map(([category, tools]) => ({
			category,
			count: tools.size
		}));
	}

	/**
	 * 从目录加载工具
	 * @param {string} dirPath - 目录路径
	 * @returns {number} 加载的工具数量
	 */
	loadFromDirectory(dirPath) {
		if (!fs.existsSync(dirPath)) {
			this.logger.warn(`Tools directory not found: ${dirPath}`);
			return 0;
		}

		const files = fs.readdirSync(dirPath);
		let count = 0;

		for (const file of files) {
			if (!file.endsWith('.js') || file.startsWith('.')) {
				continue;
			}

			try {
				const toolPath = path.join(dirPath, file);
				const ToolClass = require(toolPath);

				// 提取工具名称: CodeAnalysisTool.js -> code-analysis
				const name = file
					.replace(/Tool\.js$/, '')
					.replace(/([A-Z])/g, '-$1')
					.toLowerCase()
					.replace(/^-/, '');

				this.register(name, ToolClass, {
					category: ToolClass.category || 'custom'
				});

				count++;
			} catch (error) {
				this.logger.error(`Failed to load tool from ${file}:`, error.message);
			}
		}

		this.logger.info(`Loaded ${count} tools from ${dirPath}`);
		return count;
	}

	/**
	 * 批量注册工具
	 * @param {Object} tools - 工具映射 { name: ToolClass }
	 * @param {Object} [options] - 选项
	 */
	registerBatch(tools, options = {}) {
		for (const [name, ToolClass] of Object.entries(tools)) {
			this.register(name, ToolClass, options);
		}
	}

	/**
	 * 获取统计信息
	 * @returns {Object} 统计信息
	 */
	getStats() {
		return {
			...this._stats,
			categories: this._categories.size,
			instances: this._instances.size,
			successRate: this._stats.totalCalls > 0 
				? (this._stats.successfulCalls / this._stats.totalCalls * 100).toFixed(2) + '%'
				: '0%'
		};
	}

	/**
	 * 清理所有实例缓存
	 */
	clearCache() {
		this._instances.clear();
		this.logger.debug('Tool instances cache cleared');
	}

	/**
	 * 重置统计信息
	 */
	resetStats() {
		this._stats = {
			totalRegistered: this._tools.size,
			totalCalls: 0,
			successfulCalls: 0,
			failedCalls: 0
		};
	}
}

module.exports = ToolRegistry;
