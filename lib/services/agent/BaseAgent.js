/**
 * BaseAgent - Agent 基类
 * 
 * 提供 Agent 的通用实现和工具方法
 * Phase 5: Agent System
 */

const { IAgent, AgentCapability } = require('./IAgent');

class BaseAgent extends IAgent {
	/**
	 * @param {Object} container - 服务容器
	 * @param {Object} toolRegistry - 工具注册表
	 * @param {Object} [config] - Agent 配置
	 */
	constructor(container, toolRegistry, config = {}) {
		super();
		this.container = container;
		this.toolRegistry = toolRegistry;
		this.config = config;

		// 服务引用
		this.logger = container.resolve('logger');
		this.aiService = null; // 懒加载
		this.contextService = null; // 懒加载

		// Agent 状态
		this.initialized = false;
		this.name = config.name || 'base-agent';
		this.description = config.description || 'Base Agent';
		this.version = config.version || '1.0.0';

		// 工具管理
		this._tools = new Map();

		// 统计信息
		this._stats = {
			totalTasks: 0,
			successfulTasks: 0,
			failedTasks: 0,
			totalMessages: 0
		};
	}

	/**
	 * 获取 Agent 信息
	 * @returns {Object}
	 */
	getInfo() {
		return {
			name: this.name,
			description: this.description,
			version: this.version,
			capabilities: this.getCapabilities(),
			tools: this.getAvailableTools()
		};
	}

	/**
	 * 获取 Agent 能力列表
	 * @returns {Array<string>}
	 */
	getCapabilities() {
		return [AgentCapability.TOOL_USAGE, AgentCapability.CONVERSATION];
	}

	/**
	 * 初始化 Agent
	 * @param {Object} [options] - 初始化选项
	 * @returns {Promise<void>}
	 */
	async initialize(options = {}) {
		if (this.initialized) {
			return;
		}

		// 懒加载服务
		try {
			this.aiService = this.container.resolve('ai-service');
		} catch (error) {
			this.logger.warn('AI Service not available');
		}

		try {
			this.contextService = this.container.resolve('context-service');
		} catch (error) {
			this.logger.warn('Context Service not available');
		}

		// 子类可以覆盖此方法进行额外初始化
		await this._initializeAgent(options);

		this.initialized = true;
		this.logger.debug(`Agent '${this.name}' initialized`);
	}

	/**
	 * 子类初始化钩子
	 * @protected
	 */
	async _initializeAgent(options) {
		// 子类实现
	}

	/**
	 * 确保已初始化
	 * @protected
	 */
	_ensureInitialized() {
		if (!this.initialized) {
			throw new Error(`Agent '${this.name}' not initialized. Call initialize() first.`);
		}
	}

	/**
	 * 执行任务
	 * @param {Object} task - 任务对象
	 * @param {Object} [options] - 执行选项
	 * @returns {Promise<Object>} 执行结果
	 */
	async execute(task, options = {}) {
		this._ensureInitialized();
		const startTime = Date.now();

		try {
			this.logger.debug(`Agent '${this.name}' executing task: ${task.type || 'unknown'}`);

			// 子类实现具体执行逻辑
			const result = await this._executeTask(task, options);

			// 更新统计
			this._stats.totalTasks++;
			if (result.success) {
				this._stats.successfulTasks++;
			} else {
				this._stats.failedTasks++;
			}

			return {
				success: true,
				result,
				metadata: {
					agentName: this.name,
					duration: Date.now() - startTime
				}
			};

		} catch (error) {
			this._stats.totalTasks++;
			this._stats.failedTasks++;

			this.logger.error(`Agent '${this.name}' task failed:`, error);

			return {
				success: false,
				error: error.message,
				metadata: {
					agentName: this.name,
					duration: Date.now() - startTime
				}
			};
		}
	}

	/**
	 * 子类实现任务执行逻辑
	 * @protected
	 */
	async _executeTask(task, options) {
		throw new Error('Method _executeTask() must be implemented by subclass');
	}

	/**
	 * 处理用户消息（对话模式）
	 * @param {string} message - 用户消息
	 * @param {Object} [context] - 对话上下文
	 * @returns {Promise<Object>} 响应
	 */
	async chat(message, context = {}) {
		this._ensureInitialized();
		this._stats.totalMessages++;

		try {
			this.logger.debug(`Agent '${this.name}' processing message`);

			// 子类实现具体对话逻辑
			const response = await this._processMessage(message, context);

			return {
				reply: response.reply || response,
				toolCalls: response.toolCalls || [],
				metadata: response.metadata || {}
			};

		} catch (error) {
			this.logger.error(`Agent '${this.name}' chat failed:`, error);

			return {
				reply: `Sorry, I encountered an error: ${error.message}`,
				toolCalls: [],
				metadata: { error: true }
			};
		}
	}

	/**
	 * 子类实现消息处理逻辑
	 * @protected
	 */
	async _processMessage(message, context) {
		// 默认实现：使用 AI Service
		if (!this.aiService) {
			throw new Error('AI Service not available');
		}

		const prompt = this._buildPrompt(message, context);
		const response = await this.aiService.chat(prompt);

		return { reply: response };
	}

	/**
	 * 构建提示词
	 * @protected
	 */
	_buildPrompt(message, context) {
		let prompt = `You are ${this.description}.\n\n`;

		if (context.history && context.history.length > 0) {
			prompt += 'Conversation history:\n';
			context.history.slice(-5).forEach(msg => {
				prompt += `${msg.role}: ${msg.content}\n`;
			});
			prompt += '\n';
		}

		prompt += `User: ${message}\nAssistant:`;

		return prompt;
	}

	/**
	 * 使用工具
	 * @param {string} toolName - 工具名称
	 * @param {Object} params - 工具参数
	 * @returns {Promise<Object>} 工具执行结果
	 */
	async useTool(toolName, params) {
		this._ensureInitialized();

		this.logger.debug(`Agent '${this.name}' using tool: ${toolName}`);

		// 优先使用 Agent 自己注册的工具
		if (this._tools.has(toolName)) {
			const tool = this._tools.get(toolName);
			return await tool.execute(params);
		}

		// 否则使用全局工具注册表
		return await this.toolRegistry.execute(toolName, params);
	}

	/**
	 * 获取可用工具列表
	 * @returns {Array<string>}
	 */
	getAvailableTools() {
		const localTools = Array.from(this._tools.keys());
		const globalTools = this.toolRegistry.list();
		return [...new Set([...localTools, ...globalTools])];
	}

	/**
	 * 注册工具
	 * @param {string} name - 工具名称
	 * @param {ITool} tool - 工具实例
	 */
	registerTool(name, tool) {
		this._tools.set(name, tool);
		this.logger.debug(`Agent '${this.name}' registered tool: ${name}`);
	}

	/**
	 * 注销工具
	 * @param {string} name - 工具名称
	 */
	unregisterTool(name) {
		this._tools.delete(name);
		this.logger.debug(`Agent '${this.name}' unregistered tool: ${name}`);
	}

	/**
	 * 获取 Agent 状态
	 * @returns {Object}
	 */
	getStatus() {
		return {
			ready: this.initialized,
			status: this.initialized ? 'ready' : 'not-initialized',
			stats: {
				...this._stats,
				successRate: this._stats.totalTasks > 0
					? (this._stats.successfulTasks / this._stats.totalTasks * 100).toFixed(2) + '%'
					: '0%'
			}
		};
	}

	/**
	 * 重置 Agent 状态
	 * @returns {Promise<void>}
	 */
	async reset() {
		this._stats = {
			totalTasks: 0,
			successfulTasks: 0,
			failedTasks: 0,
			totalMessages: 0
		};
		this.logger.debug(`Agent '${this.name}' reset`);
	}

	/**
	 * 关闭 Agent
	 * @returns {Promise<void>}
	 */
	async close() {
		this._tools.clear();
		this.initialized = false;
		this.logger.debug(`Agent '${this.name}' closed`);
	}

	/**
	 * 获取 AI Service
	 * @protected
	 */
	_getAiService() {
		if (!this.aiService) {
			throw new Error('AI Service not available');
		}
		return this.aiService;
	}

	/**
	 * 获取 Context Service
	 * @protected
	 */
	_getContextService() {
		if (!this.contextService) {
			throw new Error('Context Service not available');
		}
		return this.contextService;
	}
}

module.exports = BaseAgent;
