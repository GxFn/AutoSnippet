/**
 * AgentService - Agent 服务主类
 * 
 * 提供统一的 Agent 访问接口，集成 DI 容器
 * Phase 5: Agent System
 */

const AgentManager = require('./AgentManager');
const ToolRegistry = require('./ToolRegistry');
const ConversationManager = require('./ConversationManager');
const path = require('path');

class AgentService {
	/**
	 * @param {Object} options - 配置选项
	 * @param {Object} options.container - 服务容器
	 * @param {Object} options.logger - 日志服务
	 * @param {Object} options.config - 配置管理器
	 */
	constructor(options) {
		this.container = options.container;
		this.logger = options.logger;
		this.config = options.config;

		// 创建子组件
		this.toolRegistry = new ToolRegistry(this.container, this.logger);
		this.conversationManager = new ConversationManager(this.logger, {
			maxHistory: this.config.get('agent.conversation.maxHistory', 50),
			maxContextLength: this.config.get('agent.conversation.maxContextLength', 4000),
			ttl: this.config.get('agent.conversation.ttl', 3600000)
		});
		this.agentManager = new AgentManager(
			this.container,
			this.logger,
			this.toolRegistry
		);

		this.initialized = false;
	}

	/**
	 * 初始化服务
	 * @param {Object} [options] - 初始化选项
	 * @param {boolean} [options.autoLoad=true] - 是否自动加载
	 * @param {string} [options.agentsPath] - Agent 目录路径
	 * @param {string} [options.toolsPath] - 工具目录路径
	 * @returns {Promise<void>}
	 */
	async initialize(options = {}) {
		if (this.initialized) {
			this.logger.warn('AgentService already initialized');
			return;
		}

		const {
			autoLoad = true,
			agentsPath,
			toolsPath
		} = options;

		// 加载工具
		if (autoLoad && toolsPath) {
			this.logger.info(`Loading tools from ${toolsPath}`);
			const toolCount = this.toolRegistry.loadFromDirectory(toolsPath);
			this.logger.info(`Loaded ${toolCount} tools`);
		}

		// 加载 Agent
		if (autoLoad && agentsPath) {
			this.logger.info(`Loading agents from ${agentsPath}`);
			const agentCount = this.agentManager.loadFromDirectory(agentsPath);
			this.logger.info(`Loaded ${agentCount} agents`);
		}

		this.initialized = true;
		this.logger.info('AgentService initialized successfully');
	}

	// ============ Agent 操作 ============

	/**
	 * 注册 Agent
	 * @param {string} name - Agent 名称
	 * @param {Function} AgentClass - Agent 类
	 * @param {Object} [config] - 配置
	 */
	registerAgent(name, AgentClass, config = {}) {
		this.agentManager.register(name, AgentClass, config);
	}

	/**
	 * 获取 Agent 实例
	 * @param {string} name - Agent 名称
	 * @param {Object} [options] - 选项
	 * @returns {Promise<IAgent>} Agent 实例
	 */
	async getAgent(name, options = {}) {
		return await this.agentManager.getInstance(name, options);
	}

	/**
	 * 执行 Agent 任务
	 * @param {string} agentName - Agent 名称
	 * @param {Object} task - 任务对象
	 * @param {Object} [options] - 选项
	 * @returns {Promise<Object>} 执行结果
	 */
	async executeTask(agentName, task, options = {}) {
		return await this.agentManager.executeTask(agentName, task, options);
	}

	/**
	 * Agent 对话
	 * @param {string} agentName - Agent 名称
	 * @param {string} message - 消息内容
	 * @param {Object} [context] - 对话上下文
	 * @returns {Promise<Object>} 响应
	 */
	async chat(agentName, message, context = {}) {
		const { conversationId } = context;

		// 如果有会话，先记录用户消息并注入历史/上下文
		if (conversationId) {
			this.conversationManager.addMessage(conversationId, {
				role: 'user',
				content: message,
				metadata: { agentName }
			});

			const history = this.conversationManager.getHistory(conversationId);
			const conversationContext = this.conversationManager.getContext(conversationId);

			const response = await this.agentManager.chat(agentName, message, {
				...context,
				history,
				conversationContext
			});

			const reply = response.reply || response;
			this.conversationManager.addMessage(conversationId, {
				role: 'assistant',
				content: reply,
				metadata: { agentName }
			});

			return response;
		}

		return await this.agentManager.chat(agentName, message, context);
	}

	/**
	 * 列出所有 Agent
	 * @returns {Array<string>} Agent 名称列表
	 */
	listAgents() {
		return this.agentManager.list();
	}

	/**
	 * 获取 Agent 信息
	 * @param {string} name - Agent 名称
	 * @returns {Object} Agent 信息
	 */
	getAgentInfo(name) {
		return this.agentManager.getInfo(name);
	}

	/**
	 * 获取 Agent 状态
	 * @param {string} name - Agent 名称
	 * @returns {Object} 状态信息
	 */
	getAgentStatus(name) {
		return this.agentManager.getStatus(name);
	}

	// ============ 工具操作 ============

	/**
	 * 注册工具
	 * @param {string} name - 工具名称
	 * @param {Function} ToolClass - 工具类
	 * @param {Object} [options] - 选项
	 */
	registerTool(name, ToolClass, options = {}) {
		this.toolRegistry.register(name, ToolClass, options);
	}

	/**
	 * 执行工具
	 * @param {string} name - 工具名称
	 * @param {Object} params - 参数
	 * @param {Object} [context] - 上下文
	 * @returns {Promise<Object>} 执行结果
	 */
	async executeTool(name, params, context = {}) {
		return await this.toolRegistry.execute(name, params, context);
	}

	/**
	 * 列出所有工具
	 * @param {Object} [filter] - 过滤条件
	 * @returns {Array<string>} 工具名称列表
	 */
	listTools(filter = {}) {
		return this.toolRegistry.list(filter);
	}

	/**
	 * 获取工具信息
	 * @param {string} name - 工具名称
	 * @returns {Object} 工具信息
	 */
	getToolInfo(name) {
		return this.toolRegistry.getInfo(name);
	}

	// ============ 对话操作 ============

	/**
	 * 创建对话
	 * @param {Object} [metadata] - 对话元数据
	 * @returns {string} 对话 ID
	 */
	createConversation(metadata = {}) {
		return this.conversationManager.createConversation(metadata);
	}

	/**
	 * 获取对话
	 * @param {string} conversationId - 对话 ID
	 * @returns {Object|null} 对话对象
	 */
	getConversation(conversationId) {
		return this.conversationManager.getConversation(conversationId);
	}

	/**
	 * 添加消息
	 * @param {string} conversationId - 对话 ID
	 * @param {Object} message - 消息对象
	 */
	addMessage(conversationId, message) {
		this.conversationManager.addMessage(conversationId, message);
	}

	/**
	 * 获取对话历史
	 * @param {string} conversationId - 对话 ID
	 * @param {Object} [options] - 选项
	 * @returns {Array<Object>} 消息列表
	 */
	getHistory(conversationId, options = {}) {
		return this.conversationManager.getHistory(conversationId, options);
	}

	/**
	 * 更新对话上下文
	 * @param {string} conversationId - 对话 ID
	 * @param {Object} context - 上下文更新
	 */
	updateConversationContext(conversationId, context) {
		this.conversationManager.updateContext(conversationId, context);
	}

	/**
	 * 结束对话
	 * @param {string} conversationId - 对话 ID
	 */
	endConversation(conversationId) {
		this.conversationManager.endConversation(conversationId);
	}

	/**
	 * 列出所有对话
	 * @param {Object} [filter] - 过滤条件
	 * @returns {Array<Object>} 对话列表
	 */
	listConversations(filter = {}) {
		return this.conversationManager.listConversations(filter);
	}

	// ============ 维护操作 ============

	/**
	 * 清理过期对话
	 * @returns {number} 清理的对话数量
	 */
	cleanupConversations() {
		return this.conversationManager.cleanupExpired();
	}

	/**
	 * 重置 Agent
	 * @param {string} name - Agent 名称
	 * @returns {Promise<void>}
	 */
	async resetAgent(name) {
		await this.agentManager.resetAgent(name);
	}

	/**
	 * 获取服务统计信息
	 * @returns {Object} 统计信息
	 */
	getStats() {
		return {
			service: 'agent',
			initialized: this.initialized,
			agents: this.agentManager.getStats(),
			tools: this.toolRegistry.getStats(),
			conversations: this.conversationManager.getStats()
		};
	}

	/**
	 * 关闭服务
	 * @returns {Promise<void>}
	 */
	async close() {
		await this.agentManager.closeAll();
		this.conversationManager.clear();
		this.toolRegistry.clearCache();
		this.initialized = false;
		this.logger.info('AgentService closed');
	}
}

module.exports = AgentService;
