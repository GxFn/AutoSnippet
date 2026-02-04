/**
 * ConversationManager - 多轮对话上下文管理
 * 
 * 职责：
 * - 维护对话历史和上下文
 * - 进行代词和引用解析
 * - 检测话题转换
 * - 管理对话状态
 */

const EventEmitter = require('events');

class ConversationManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.name = 'ConversationManager';
    this.version = '1.0.0';

    this.config = {
      maxContextTurns: options.maxContextTurns || 5,
      enableTopicDetection: options.enableTopicDetection !== false,
      enableReferenceResolution: options.enableReferenceResolution !== false,
      maxConversationLength: options.maxConversationLength || 50,
      ...options
    };

    this.logger = options.logger || console;

    // 活跃对话 Map<userId, Conversation>
    this.conversations = new Map();

    // 已知话题列表
    this.knownTopics = new Set([
      'code-quality', 'generation', 'search', 'learning',
      'performance', 'testing', 'documentation', 'refactoring'
    ]);

    // 代词和引用模式
    this.pronounPatterns = {
      'it': /\bit\b/i,
      'they': /\bthey\b|\bthese\b/i,
      'previous': /\b(previous|last|before)\b/i
    };

    // 统计
    this.stats = {
      totalConversations: 0,
      topicSwitches: 0,
      referenceResolutions: 0,
      failedResolutions: 0
    };
  }

  /**
   * 创建或获取对话
   * @param {string} userId - 用户 ID
   * @returns {Object} 对话对象
   */
  getOrCreateConversation(userId) {
    if (!this.conversations.has(userId)) {
      const conversation = {
        userId,
        id: `conv_${Date.now()}`,
        createdAt: new Date(),
        turns: [],
        currentTopic: null,
        topicHistory: [],
        context: {},
        lastIntentIntent: null,
        references: new Map()
      };

      this.conversations.set(userId, conversation);
      this.stats.totalConversations++;
      this.emit('conversation_created', { userId, conversationId: conversation.id });
    }

    return this.conversations.get(userId);
  }

  /**
   * 处理用户输入，处理引用和上下文
   * @param {string} userId - 用户 ID
   * @param {string} userInput - 用户输入
   * @param {Object} agentContext - Agent 上下文
   * @returns {Promise<Object>} 处理结果
   */
  async processUserInput(userId, userInput, agentContext = {}) {
    const conversation = this.getOrCreateConversation(userId);

    try {
      // 1. 解析用户输入中的引用
      const resolvedInput = await this._resolveReferences(userInput, conversation);

      // 2. 检测话题
      const topic = this._detectTopic(resolvedInput, conversation);
      if (topic && topic !== conversation.currentTopic) {
        conversation.topicHistory.push(conversation.currentTopic);
        conversation.currentTopic = topic;
        this.stats.topicSwitches++;
        this.emit('topic_changed', { 
          userId, 
          previousTopic: conversation.topicHistory[conversation.topicHistory.length - 1],
          newTopic: topic 
        });
      }

      // 3. 构建增强的上下文
      const enhancedContext = this._buildEnhancedContext(
        conversation,
        resolvedInput,
        agentContext
      );

      // 4. 添加到对话历史
      const turn = {
        id: `turn_${Date.now()}`,
        timestamp: new Date(),
        userInput,
        resolvedInput,
        topic,
        agentContext: enhancedContext,
        result: null,
        confidence: 0
      };

      conversation.turns.push(turn);

      // 维持对话长度限制
      if (conversation.turns.length > this.config.maxConversationLength) {
        conversation.turns = conversation.turns.slice(-this.config.maxConversationLength);
      }

      return {
        success: true,
        turn,
        enhancedContext,
        conversationState: {
          turnCount: conversation.turns.length,
          currentTopic: conversation.currentTopic,
          topicHistory: conversation.topicHistory.slice(-3)
        }
      };

    } catch (error) {
      this.logger.error(`[ConversationManager] Failed to process input for ${userId}:`, error);
      return {
        success: false,
        error,
        turn: null,
        enhancedContext: agentContext
      };
    }
  }

  /**
   * 解析代词和引用
   * @private
   */
  async _resolveReferences(userInput, conversation) {
    let resolved = userInput;
    const referenceMatches = [];

    // 检查是否包含代词
    for (const [pronoun, pattern] of Object.entries(this.pronounPatterns)) {
      if (pattern.test(userInput)) {
        // 根据对话历史查找引用
        const referencedText = this._findReference(pronoun, conversation);
        if (referencedText) {
          // 替换代词为引用文本（简单替换第一个匹配）
          resolved = userInput.replace(new RegExp(pronoun, 'i'), referencedText);
          referenceMatches.push({ pronoun, resolved: referencedText });
          this.stats.referenceResolutions++;
          return resolved; // 一旦找到引用就返回
        } else {
          this.stats.failedResolutions++;
        }
      }
    }

    // 检查省略号和不完整句子
    if (userInput.length < 5 && conversation.turns.length > 0) {
      const lastTurn = conversation.turns[conversation.turns.length - 1];
      if (lastTurn && lastTurn.result) {
        // 用最后的结果扩展输入
        resolved = `${lastTurn.userInput} ${userInput}`;
      }
    }

    // 记录解析过的引用
    if (referenceMatches.length > 0) {
      conversation.references.set(
        Date.now(),
        { original: userInput, resolved, matches: referenceMatches }
      );
    }

    return resolved;
  }

  /**
   * 查找引用的文本
   * @private
   */
  _findReference(pronoun, conversation) {
    // 从最近的 turn 向后查找相关内容
    for (let i = conversation.turns.length - 1; i >= 0 && 
         conversation.turns.length - i <= this.config.maxContextTurns; i--) {
      const turn = conversation.turns[i];
      
      if (pronoun === 'it' && turn.result && turn.result.context) {
        return turn.result.context.primary || turn.userInput;
      }
      
      if (pronoun === 'it' && turn.userInput) {
        // 如果没有上下文但有前一个输入，使用前一个输入作为引用
        if (i > 0 && !turn.result) {
          return conversation.turns[i - 1].userInput;
        }
      }
      
      if (pronoun === 'they' && turn.result && turn.result.items) {
        return turn.result.items.join(', ');
      }

      if (pronoun === 'previous' && i > 0) {
        const previousTurn = conversation.turns[i - 1];
        return previousTurn.userInput;
      }
    }

    return null;
  }

  /**
   * 检测对话话题
   * @private
   */
  _detectTopic(userInput, conversation) {
    const lowerInput = userInput.toLowerCase();

    // 基于关键词检测话题
    const topicPatterns = {
      'code-quality': ['lint', 'error', 'bug', 'fix', 'quality', 'issue'],
      'generation': ['generate', 'create', 'write', 'implement', 'code', 'function'],
      'search': ['find', 'search', 'look', 'where', 'which', 'how to find'],
      'learning': ['explain', 'teach', 'learn', 'tutorial', 'understand', 'how does'],
      'performance': ['performance', 'optimize', 'speed', 'slow', 'fast', 'efficient'],
      'testing': ['test', 'check', 'verify', 'validate', 'assert', 'unit test'],
      'documentation': ['document', 'comment', 'doc', 'readme', 'explain', 'describe'],
      'refactoring': ['refactor', 'clean', 'improve', 'restructure', 'simplify']
    };

    for (const [topic, keywords] of Object.entries(topicPatterns)) {
      for (const keyword of keywords) {
        if (lowerInput.includes(keyword)) {
          return topic;
        }
      }
    }

    // 返回前一个话题或默认话题
    return conversation.currentTopic || 'general';
  }

  /**
   * 构建增强的上下文
   * @private
   */
  _buildEnhancedContext(conversation, resolvedInput, agentContext) {
    const recentTurns = conversation.turns.slice(-this.config.maxContextTurns);
    
    // 构建上下文背景
    const contextBackground = {
      userInput: resolvedInput,
      currentTopic: conversation.currentTopic,
      conversationAge: Date.now() - conversation.createdAt.getTime(),
      turnNumber: conversation.turns.length,
      topicHistory: conversation.topicHistory.slice(-2),
      recentContext: recentTurns.map(t => ({
        input: t.userInput,
        topic: t.topic,
        result: t.result ? { success: t.result.success, type: t.result.type } : null
      }))
    };

    return {
      ...agentContext,
      conversationContext: contextBackground,
      enhancedPrompt: this._buildEnhancedPrompt(resolvedInput, contextBackground),
      focusFactor: this._calculateFocusFactor(conversation)
    };
  }

  /**
   * 构建增强的提示词
   * @private
   */
  _buildEnhancedPrompt(userInput, contextBackground) {
    let prompt = userInput;

    // 添加话题上下文
    if (contextBackground.currentTopic) {
      prompt += ` (Topic: ${contextBackground.currentTopic})`;
    }

    // 添加对话历史上下文（前1-2个turn）
    if (contextBackground.recentContext.length > 0) {
      const lastContext = contextBackground.recentContext[contextBackground.recentContext.length - 1];
      if (lastContext.input !== userInput) {
        prompt += ` [Previous: ${lastContext.input}]`;
      }
    }

    return prompt;
  }

  /**
   * 计算聚焦因子 - 用于影响搜索相关度
   * @private
   */
  _calculateFocusFactor(conversation) {
    // 如果连续提问同一话题，增加聚焦因子
    if (conversation.turns.length < 2) {
      return 0.5;
    }

    const lastThreeTurns = conversation.turns.slice(-3);
    const sameTopicCount = lastThreeTurns.filter(
      t => t.topic === conversation.currentTopic
    ).length;

    // 聚焦因子范围 0.3 - 1.0
    return 0.3 + (sameTopicCount / 3) * 0.7;
  }

  /**
   * 记录 Agent 执行结果
   * @param {string} userId - 用户 ID
   * @param {Object} result - Agent 执行结果
   */
  recordResult(userId, result) {
    const conversation = this.conversations.get(userId);
    if (conversation && conversation.turns.length > 0) {
      const lastTurn = conversation.turns[conversation.turns.length - 1];
      lastTurn.result = result;
      lastTurn.confidence = result.confidence || 0;
      
      // 更新上下文
      if (result.context) {
        conversation.context = { ...conversation.context, ...result.context };
      }

      this.emit('result_recorded', { userId, turnId: lastTurn.id });
    }
  }

  /**
   * 获取对话摘要
   * @param {string} userId - 用户 ID
   * @returns {Object} 对话摘要
   */
  getConversationSummary(userId) {
    const conversation = this.conversations.get(userId);
    if (!conversation) return null;

    return {
      id: conversation.id,
      userId,
      createdAt: conversation.createdAt,
      turnCount: conversation.turns.length,
      currentTopic: conversation.currentTopic,
      topicHistory: conversation.topicHistory,
      averageConfidence: conversation.turns.length > 0
        ? (conversation.turns.reduce((sum, t) => sum + t.confidence, 0) / conversation.turns.length).toFixed(2)
        : 0,
      successRate: conversation.turns.length > 0
        ? (conversation.turns.filter(t => t.result && t.result.success).length / conversation.turns.length * 100).toFixed(1) + '%'
        : '0%',
      recentTurns: conversation.turns.slice(-3).map(t => ({
        input: t.userInput,
        topic: t.topic,
        result: t.result ? { success: t.result.success } : null
      }))
    };
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    return {
      ...this.stats,
      activeConversations: this.conversations.size,
      avgResolutionSuccess: this.stats.referenceResolutions + this.stats.failedResolutions > 0
        ? ((this.stats.referenceResolutions / (this.stats.referenceResolutions + this.stats.failedResolutions)) * 100).toFixed(1) + '%'
        : '0%'
    };
  }

  /**
   * 清理旧对话
   * @param {number} maxAgeMs - 最大年龄（毫秒）
   */
  cleanupOldConversations(maxAgeMs = 3600000) {
    let cleaned = 0;
    const now = Date.now();

    for (const [userId, conversation] of this.conversations.entries()) {
      if (now - conversation.createdAt.getTime() > maxAgeMs) {
        this.conversations.delete(userId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * 重置用户对话
   * @param {string} userId - 用户 ID
   */
  resetConversation(userId) {
    this.conversations.delete(userId);
    this.emit('conversation_reset', { userId });
  }
}

module.exports = ConversationManager;
