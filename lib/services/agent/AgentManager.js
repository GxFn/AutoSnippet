/**
 * AgentManager - Agent 管理器
 * 
 * 管理所有 Agent 的注册、实例化和生命周期
 * Phase 5: Agent System
 */

const { IAgent } = require('./IAgent');
const path = require('path');
const fs = require('fs');

class AgentManager {
	/**
	 * @param {Object} container - 服务容器
	 * @param {Object} logger - 日志服务
	 * @param {Object} toolRegistry - 工具注册表
	 */
	constructor(container, logger, toolRegistry) {
		this.container = container;
		this.logger = logger;
		this.toolRegistry = toolRegistry;

		// Agent 类存储: Map<name, { AgentClass, config }>
		this._agents = new Map();

		// Agent 实例缓存: Map<name, agentInstance>
		this._instances = new Map();

		// 统计信息
		this._stats = {
			totalRegistered: 0,
			totalInstances: 0,
			totalTasks: 0,
			successfulTasks: 0,
			failedTasks: 0
		};
	}

	/**
	 * 注册 Agent
	 * @param {string} name - Agent 名称
	 * @param {Function|Object} AgentClass - Agent 类或 Agent 实例
	 * @param {Object} [config] - Agent 配置
	 */
	register(name, AgentClass, config = {}) {
		if (this._agents.has(name)) {
			this.logger.warn(`Agent '${name}' already registered, overwriting`);
		}

		// 检查是否为实例
		const isInstance = typeof AgentClass === 'object' && AgentClass !== null;
		
		this._agents.set(name, {
			AgentClass,
			config,
			isInstance
		});

		// 如果是实例，放入实例缓存
		if (isInstance) {
			this._instances.set(name, AgentClass);
			this._stats.totalInstances = this._instances.size;
		}

		this._stats.totalRegistered++;
		this.logger.debug(`Registered agent: ${name}`);
	}

	/**
	 * 注销 Agent
	 * @param {string} name - Agent 名称
	 */
	async unregister(name) {
		if (!this._agents.has(name)) {
			this.logger.warn(`Agent '${name}' not found`);
			return;
		}

		// 关闭并清理实例
		if (this._instances.has(name)) {
			const instance = this._instances.get(name);
			await instance.close();
			this._instances.delete(name);
			this._stats.totalInstances--;
		}

		this._agents.delete(name);
		this._stats.totalRegistered--;
		this.logger.debug(`Unregistered agent: ${name}`);
	}

	/**
	 * 检查 Agent 是否存在
	 * @param {string} name - Agent 名称
	 * @returns {boolean}
	 */
	has(name) {
		return this._agents.has(name);
	}

	/**
	 * 获取 Agent 实例
	 * @param {string} name - Agent 名称
	 * @param {Object} [options] - 选项
	 * @param {boolean} [options.singleton=true] - 是否单例
	 * @param {Object} [options.config] - 覆盖配置
	 * @returns {IAgent} Agent 实例
	 */
	async getInstance(name, options = {}) {
		if (!this._agents.has(name)) {
			throw new Error(`Agent '${name}' not found. Available: ${this.list().join(', ')}`);
		}

		const { singleton = true, config: overrideConfig } = options;

		const agentData = this._agents.get(name);

		// 如果存储的是实例，直接返回
		if (agentData.isInstance) {
			return agentData.AgentClass;
		}

		// 单例模式：复用实例
		if (singleton && this._instances.has(name)) {
			return this._instances.get(name);
		}

		const config = {
			...agentData.config,
			...overrideConfig
		};

		// 创建新实例
		const instance = new agentData.AgentClass(
			this.container,
			this.toolRegistry,
			config
		);

		// 初始化 Agent
		await instance.initialize();

		// 缓存单例实例
		if (singleton) {
			this._instances.set(name, instance);
			this._stats.totalInstances++;
		}

		this.logger.debug(`Created agent instance: ${name}`);
		return instance;
	}

	/**
	 * 执行 Agent 任务
	 * @param {string} name - Agent 名称
	 * @param {Object} task - 任务对象
	 * @param {Object} [options] - 选项
	 * @returns {Promise<Object>} 执行结果
	 */
	async executeTask(name, task, options = {}) {
		const startTime = Date.now();

		try {
			const agent = await this.getInstance(name);

			this.logger.debug(`Executing task with agent '${name}': ${task.type || 'unknown'}`);
			const result = await agent.execute(task, options);

			// 更新统计
			this._stats.totalTasks++;
			if (result.success) {
				this._stats.successfulTasks++;
			} else {
				this._stats.failedTasks++;
			}

			const duration = Date.now() - startTime;
			this.logger.debug(`Agent '${name}' task completed in ${duration}ms`);

			return {
				...result,
				metadata: {
					...result.metadata,
					agentName: name,
					duration
				}
			};

		} catch (error) {
			this._stats.totalTasks++;
			this._stats.failedTasks++;

			this.logger.error(`Agent '${name}' task failed:`, error);

			return {
				success: false,
				error: error.message,
				metadata: {
					agentName: name,
					duration: Date.now() - startTime
				}
			};
		}
	}

	/**
	 * Agent 对话
	 * @param {string} name - Agent 名称
	 * @param {string} message - 消息内容
	 * @param {Object} [context] - 对话上下文
	 * @returns {Promise<Object>} 响应
	 */
	async chat(name, message, context = {}) {
		const agent = await this.getInstance(name);
		return await agent.chat(message, context);
	}

	/**
	 * 列出所有 Agent
	 * @returns {Array<string>} Agent 名称列表
	 */
	list() {
		return Array.from(this._agents.keys());
	}

	/**
	 * 获取 Agent 信息
	 * @param {string} name - Agent 名称
	 * @returns {Object} Agent 信息
	 */
	getInfo(name) {
		if (!this._agents.has(name)) {
			throw new Error(`Agent '${name}' not found`);
		}

		const agentData = this._agents.get(name);

		// 优先返回实例信息
		if (agentData.isInstance) {
			return agentData.AgentClass.getInfo();
		}

		if (this._instances.has(name)) {
			return this._instances.get(name).getInfo();
		}

		// 未初始化时返回基础信息
		return {
			name,
			description: agentData.config?.description || '',
			version: agentData.config?.version || 'unknown',
			capabilities: [],
			tools: []
		};
	}

	/**
	 * 获取 Agent 状态
	 * @param {string} name - Agent 名称
	 * @returns {Object} 状态信息
	 */
	getStatus(name) {
		if (!this._agents.has(name)) {
			throw new Error(`Agent '${name}' not found`);
		}

		const agentData = this._agents.get(name);

		// 如果注册的是实例，直接返回实例状态
		if (agentData.isInstance) {
			return agentData.AgentClass.getStatus();
		}

		// 如果实例存在，返回实例状态
		if (this._instances.has(name)) {
			const agent = this._instances.get(name);
			return agent.getStatus();
		}

		// 否则返回基本状态
		return {
			ready: false,
			status: 'not-initialized',
			stats: {
				totalTasks: 0,
				successfulTasks: 0,
				failedTasks: 0,
				totalMessages: 0,
				successRate: '0%'
			}
		};
	}

	/**
	 * 从目录加载 Agent
	 * @param {string} dirPath - 目录路径
	 * @returns {number} 加载的 Agent 数量
	 */
	loadFromDirectory(dirPath) {
		if (!fs.existsSync(dirPath)) {
			this.logger.warn(`Agents directory not found: ${dirPath}`);
			return 0;
		}

		const files = fs.readdirSync(dirPath);
		let count = 0;

		for (const file of files) {
			if (!file.endsWith('.js') || file.startsWith('.') || file === 'BaseAgent.js') {
				continue;
			}

			try {
				const agentPath = path.join(dirPath, file);
				const AgentClass = require(agentPath);

				// 提取 Agent 名称: CodeAgent.js -> code
				const name = file
					.replace(/Agent\.js$/, '')
					.replace(/([A-Z])/g, '-$1')
					.toLowerCase()
					.replace(/^-/, '');

				this.register(name, AgentClass, AgentClass.defaultConfig || {});
				count++;
			} catch (error) {
				this.logger.error(`Failed to load agent from ${file}:`, error.message);
			}
		}

		this.logger.info(`Loaded ${count} agents from ${dirPath}`);
		return count;
	}

	/**
	 * 批量注册 Agent
	 * @param {Object} agents - Agent 映射 { name: AgentClass }
	 * @param {Object} [config] - 通用配置
	 */
	registerBatch(agents, config = {}) {
		for (const [name, AgentClass] of Object.entries(agents)) {
			this.register(name, AgentClass, config);
		}
	}

	/**
	 * 重置 Agent
	 * @param {string} name - Agent 名称
	 * @returns {Promise<void>}
	 */
	async resetAgent(name) {
		if (this._instances.has(name)) {
			const agent = this._instances.get(name);
			await agent.reset();
			this.logger.debug(`Reset agent: ${name}`);
		}
	}

	/**
	 * 关闭所有 Agent 实例
	 * @returns {Promise<void>}
	 */
	async closeAll() {
		const promises = [];
		
		for (const [name, agent] of this._instances.entries()) {
			promises.push(
				agent.close().catch(err => {
					this.logger.error(`Failed to close agent '${name}':`, err);
				})
			);
		}

		await Promise.all(promises);
		this._instances.clear();
		this._stats.totalInstances = 0;
		
		this.logger.info('Closed all agent instances');
	}

	/**
	 * 清理实例缓存
	 */
	clearCache() {
		this._instances.clear();
		this._stats.totalInstances = 0;
		this.logger.debug('Agent instances cache cleared');
	}

	/**
	 * 获取统计信息
	 * @returns {Object} 统计信息
	 */
	getStats() {
		return {
			...this._stats,
			successRate: this._stats.totalTasks > 0
				? (this._stats.successfulTasks / this._stats.totalTasks * 100).toFixed(2) + '%'
				: '0%'
		};
	}

	/**
	 * 重置统计信息
	 */
	resetStats() {
		this._stats = {
			totalRegistered: this._agents.size,
			totalInstances: this._instances.size,
			totalTasks: 0,
			successfulTasks: 0,
			failedTasks: 0
		};
	}
}

module.exports = AgentManager;
