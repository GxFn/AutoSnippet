/**
 * ConversationManager - 对话管理器
 * 
 * 管理 Agent 的对话历史、上下文和会话状态
 * Phase 5: Agent System
 */

class ConversationManager {
	/**
	 * @param {Object} logger - 日志服务
	 * @param {Object} [options] - 选项
	 * @param {number} [options.maxHistory=50] - 最大历史消息数
	 * @param {number} [options.maxContextLength=4000] - 最大上下文长度（token数）
	 * @param {number} [options.ttl=3600000] - 会话过期时间（毫秒）
	 */
	constructor(logger, options = {}) {
		this.logger = logger;
		this.options = {
			maxHistory: options.maxHistory || 50,
			maxContextLength: options.maxContextLength || 4000,
			ttl: options.ttl || 3600000 // 1 hour
		};

		// 会话存储: Map<conversationId, Conversation>
		this._conversations = new Map();
		
		// 统计信息
		this._stats = {
			totalConversations: 0,
			activeConversations: 0,
			totalMessages: 0
		};
	}

	/**
	 * 创建新对话
	 * @param {Object} [metadata] - 对话元数据
	 * @param {string} [metadata.agentName] - Agent 名称
	 * @param {string} [metadata.userId] - 用户 ID
	 * @param {Object} [metadata.context] - 初始上下文
	 * @returns {string} 对话 ID
	 */
	createConversation(metadata = {}) {
		const conversationId = this._generateId();
		const now = Date.now();

		const conversation = {
			id: conversationId,
			metadata: {
				...metadata,
				createdAt: now,
				updatedAt: now
			},
			messages: [],
			context: metadata.context || {},
			state: 'active'
		};

		this._conversations.set(conversationId, conversation);
		this._stats.totalConversations++;
		this._stats.activeConversations++;

		this.logger.debug(`Created conversation: ${conversationId}`);
		return conversationId;
	}

	/**
	 * 获取对话
	 * @param {string} conversationId - 对话 ID
	 * @returns {Object|null} 对话对象
	 */
	getConversation(conversationId) {
		const conversation = this._conversations.get(conversationId);
		
		if (!conversation) {
			return null;
		}

		// 检查是否过期
		if (this._isExpired(conversation)) {
			this.endConversation(conversationId);
			return null;
		}

		return conversation;
	}

	/**
	 * 添加消息
	 * @param {string} conversationId - 对话 ID
	 * @param {Object|string} message - 消息对象或角色
	 * @param {string} [message.role] - 角色 ('user' | 'assistant' | 'system')
	 * @param {string} [message.content] - 消息内容
	 * @param {Object} [message.metadata] - 消息元数据
	 * @param {string} [content] - 消息内容（当 message 为角色时）
	 * @param {Object} [metadata] - 消息元数据（当 message 为角色时）
	 */
	addMessage(conversationId, message, content, metadata) {
		const conversation = this.getConversation(conversationId);
		
		if (!conversation) {
			throw new Error(`Conversation '${conversationId}' not found or expired`);
		}

		// 兼容 (role, content, metadata) 调用方式
		if (typeof message === 'string') {
			message = {
				role: message,
				content,
				metadata: metadata || {}
			};
		}

		const messageObj = {
			id: this._generateId(),
			timestamp: Date.now(),
			role: message.role,
			content: message.content,
			metadata: message.metadata || {}
		};

		conversation.messages.push(messageObj);
		conversation.metadata.updatedAt = Date.now();
		this._stats.totalMessages++;

		// 限制历史消息数量
		if (conversation.messages.length > this.options.maxHistory) {
			const removed = conversation.messages.length - this.options.maxHistory;
			conversation.messages.splice(0, removed);
			this.logger.debug(`Trimmed ${removed} old messages from conversation ${conversationId}`);
		}

		this.logger.debug(`Added message to conversation ${conversationId}: ${message.role}`);
	}

	/**
	 * 获取对话历史
	 * @param {string} conversationId - 对话 ID
	 * @param {Object} [options] - 选项
	 * @param {number} [options.limit] - 返回消息数量限制
	 * @param {string} [options.role] - 按角色过滤
	 * @returns {Array<Object>} 消息列表
	 */
	getHistory(conversationId, options = {}) {
		const conversation = this.getConversation(conversationId);
		
		if (!conversation) {
			return [];
		}

		let messages = [...conversation.messages];

		// 按角色过滤
		if (options.role) {
			messages = messages.filter(m => m.role === options.role);
		}

		// 限制数量
		if (options.limit && options.limit > 0) {
			messages = messages.slice(-options.limit);
		}

		return messages;
	}

	/**
	 * 更新对话上下文
	 * @param {string} conversationId - 对话 ID
	 * @param {Object} context - 上下文更新
	 */
	updateContext(conversationId, context) {
		const conversation = this.getConversation(conversationId);
		
		if (!conversation) {
			throw new Error(`Conversation '${conversationId}' not found or expired`);
		}

		conversation.context = {
			...conversation.context,
			...context
		};
		conversation.metadata.updatedAt = Date.now();

		this.logger.debug(`Updated context for conversation ${conversationId}`);
	}

	/**
	 * 获取对话上下文
	 * @param {string} conversationId - 对话 ID
	 * @returns {Object} 上下文对象
	 */
	getContext(conversationId) {
		const conversation = this.getConversation(conversationId);
		return conversation ? conversation.context : {};
	}

	/**
	 * 结束对话
	 * @param {string} conversationId - 对话 ID
	 */
	endConversation(conversationId) {
		const conversation = this._conversations.get(conversationId);
		
		if (conversation) {
			conversation.state = 'ended';
			conversation.metadata.endedAt = Date.now();
			this._stats.activeConversations--;
			this.logger.debug(`Ended conversation: ${conversationId}`);
		}
	}

	/**
	 * 删除对话
	 * @param {string} conversationId - 对话 ID
	 */
	deleteConversation(conversationId) {
		if (this._conversations.has(conversationId)) {
			const conversation = this._conversations.get(conversationId);
			if (conversation.state === 'active') {
				this._stats.activeConversations--;
			}
			this._conversations.delete(conversationId);
			this.logger.debug(`Deleted conversation: ${conversationId}`);
		}
	}

	/**
	 * 列出所有对话
	 * @param {Object} [filter] - 过滤条件
	 * @param {string} [filter.state] - 按状态过滤
	 * @param {string} [filter.agentName] - 按 Agent 过滤
	 * @returns {Array<Object>} 对话列表
	 */
	listConversations(filter = {}) {
		let conversations = Array.from(this._conversations.values());

		// 兼容传入 userId 字符串
		if (typeof filter === 'string') {
			filter = { userId: filter };
		}

		if (filter.state) {
			conversations = conversations.filter(c => c.state === filter.state);
		}

		if (filter.agentName) {
			conversations = conversations.filter(
				c => c.metadata.agentName === filter.agentName
			);
		}

		if (filter.userId) {
			conversations = conversations.filter(
				c => c.metadata.userId === filter.userId
			);
		}

		return conversations.map(c => ({
			id: c.id,
			metadata: c.metadata,
			messageCount: c.messages.length,
			state: c.state
		}));
	}

	/**
	 * 清理过期对话
	 * @returns {number} 清理的对话数量
	 */
	cleanupExpired() {
		let count = 0;
		
		for (const [id, conversation] of this._conversations.entries()) {
			if (this._isExpired(conversation)) {
				this.deleteConversation(id);
				count++;
			}
		}

		if (count > 0) {
			this.logger.info(`Cleaned up ${count} expired conversations`);
		}

		return count;
	}

	/**
	 * 获取对话摘要
	 * @param {string} conversationId - 对话 ID
	 * @returns {Object} 摘要信息
	 */
	getSummary(conversationId) {
		const conversation = this.getConversation(conversationId);
		
		if (!conversation) {
			return null;
		}

		const roles = {};
		conversation.messages.forEach(m => {
			roles[m.role] = (roles[m.role] || 0) + 1;
		});

		return {
			id: conversation.id,
			state: conversation.state,
			messageCount: conversation.messages.length,
			roles,
			duration: conversation.metadata.updatedAt - conversation.metadata.createdAt,
			lastActivity: conversation.metadata.updatedAt
		};
	}

	/**
	 * 获取统计信息
	 * @returns {Object} 统计信息
	 */
	getStats() {
		return {
			...this._stats,
			conversations: this._conversations.size
		};
	}

	/**
	 * 清空所有对话
	 */
	clear() {
		this._conversations.clear();
		this._stats.activeConversations = 0;
		this.logger.info('Cleared all conversations');
	}

	/**
	 * 检查对话是否过期
	 * @private
	 */
	_isExpired(conversation) {
		const now = Date.now();

		// 允许显式过期时间
		if (conversation.expiresAt) {
			return now >= conversation.expiresAt;
		}

		if (conversation.metadata && conversation.metadata.expiresAt) {
			return now >= conversation.metadata.expiresAt;
		}

		const lastUpdate = conversation.metadata.updatedAt;
		return now - lastUpdate > this.options.ttl;
	}

	/**
	 * 生成唯一 ID
	 * @private
	 */
	_generateId() {
		return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}
}

module.exports = ConversationManager;
