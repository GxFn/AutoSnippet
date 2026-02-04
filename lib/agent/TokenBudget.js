/**
 * TokenBudget - Token 预算管理系统
 * 
 * 职责：
 * - Token 预算分配
 * - 上下文优化
 * - 成本控制
 */

const EventEmitter = require('events');

class TokenBudget extends EventEmitter {
  constructor(options = {}) {
    super();
    this.name = 'TokenBudget';
    this.version = '1.0.0';

    this.config = {
      maxTokens: options.maxTokens || 4000,
      systemPromptTokens: options.systemPromptTokens || 300,
      bufferTokens: options.bufferTokens || 400,
      enableAutoOptimize: options.enableAutoOptimize !== false,
      ...options
    };

    this.logger = options.logger || console;

    // Token 分配基础配置
    this.baseAllocation = {
      systemPrompt: 300,
      conversationHistory: 1200,
      recipes: 800,
      userInput: 300,
      buffer: 400
    };

    // 场景特定的分配
    this.scenarioAllocations = {
      quick_fix: {
        conversationHistory: 200,
        recipes: 1500,
        buffer: 100,
        description: '快速修复 - 优先 Recipe 内容'
      },
      detailed_explanation: {
        conversationHistory: 600,
        recipes: 1200,
        buffer: 200,
        description: '详细解释 - 保留完整对话历史'
      },
      learning_session: {
        conversationHistory: 400,
        recipes: 1500,
        buffer: 200,
        description: '学习会话 - 保持知识连贯性'
      },
      multi_turn_dialog: {
        conversationHistory: 1000,
        recipes: 600,
        buffer: 300,
        description: '多轮对话 - 最大化对话上下文'
      },
      code_generation: {
        conversationHistory: 300,
        recipes: 1400,
        buffer: 200,
        description: '代码生成 - 优先参考代码'
      }
    };

    // 统计
    this.stats = {
      totalRequests: 0,
      totalTokensAllocated: 0,
      totalTokensUsed: 0,
      compressionCount: 0,
      optimizationCount: 0,
      averageUsageRate: 0
    };

    this.requestHistory = [];
    this.maxHistorySize = 100;
  }

  /**
   * 为请求分配 Token 预算
   * @param {string} scenario - 场景类型
   * @returns {Object} Token 预算分配
   */
  allocateForScenario(scenario = 'default') {
    const allocation = { ...this.baseAllocation };

    // 应用场景特定的分配
    if (this.scenarioAllocations[scenario]) {
      const scenarioAlloc = this.scenarioAllocations[scenario];
      Object.assign(allocation, scenarioAlloc);
    }

    // 确保总额不超过最大 Token
    const total = Object.values(allocation).reduce((sum, v) => {
      return sum + (typeof v === 'number' ? v : 0);
    }, 0);

    if (total > this.config.maxTokens) {
      // 按比例缩减
      const scaleFactor = this.config.maxTokens / total;
      for (const key of Object.keys(allocation)) {
        if (typeof allocation[key] === 'number') {
          allocation[key] = Math.floor(allocation[key] * scaleFactor);
        }
      }
    }

    return allocation;
  }

  /**
   * 压缩对话历史
   * @param {Array} history - 对话历史
   * @param {number} targetTokens - 目标 Token 数
   * @returns {Array} 压缩后的历史
   */
  compressConversationHistory(history, targetTokens) {
    if (!Array.isArray(history) || history.length === 0) {
      return [];
    }

    // 估算当前 Token 使用
    const estimateTokens = (text) => {
      return Math.ceil((text || '').length / 4);
    };

    let currentTokens = history.reduce((sum, msg) => {
      return sum + estimateTokens((msg.content || msg.text || ''));
    }, 0);

    // 如果已经在预算内，直接返回
    if (currentTokens <= targetTokens) {
      return history;
    }

    const compressed = [];
    const compressionRate = (1 - targetTokens / currentTokens);

    // 策略 1: 删除旧的澄清性对话
    const filteredHistory = history.filter(msg => {
      const isClarification = /^(yes|no|ok|确定|取消|重新|再来|可以|不行)$/i.test(msg.content);
      return !isClarification;
    });

    if (filteredHistory.length < history.length) {
      this.stats.compressionCount++;
      this.emit('history_compressed', {
        original: history.length,
        filtered: filteredHistory.length,
        reason: 'removed_clarifications'
      });

      return this.compressConversationHistory(filteredHistory, targetTokens);
    }

    // 策略 2: 总结多轮相似对话
    const summarized = this._summarizeRepetitions(filteredHistory, Math.floor(compressionRate * 0.3));

    if (summarized.length < filteredHistory.length) {
      this.stats.compressionCount++;
      this.emit('history_compressed', {
        original: filteredHistory.length,
        summarized: summarized.length,
        reason: 'summarized_repetitions'
      });

      return this.compressConversationHistory(summarized, targetTokens);
    }

    // 策略 3: 保留最近的消息，总结旧消息
    const recentCount = Math.ceil(history.length * 0.3);
    const recentMessages = history.slice(-recentCount);
    const olderMessages = history.slice(0, -recentCount);

    if (olderMessages.length > 0) {
      const olderSummary = {
        type: 'summary',
        content: `[${olderMessages.length} 条旧消息的总结] 用户和 AI 讨论了相关主题`,
        timestamp: olderMessages[0].timestamp,
        collapsed: true
      };

      compressed.push(olderSummary, ...recentMessages);
      this.stats.compressionCount++;
      this.emit('history_compressed', {
        original: history.length,
        final: compressed.length,
        reason: 'collapsed_older_messages'
      });

      return compressed;
    }

    return history;
  }

  /**
   * 总结重复的对话
   * @private
   */
  _summarizeRepetitions(history, targetReduction) {
    const result = [];
    const seen = new Map();

    for (const msg of history) {
      const key = this._extractSummaryKey(msg.content || '');

      if (seen.has(key)) {
        // 跳过重复
        continue;
      }

      seen.set(key, true);
      result.push(msg);

      if (history.length - result.length <= targetReduction) {
        break;
      }
    }

    return result;
  }

  /**
   * 提取消息摘要键
   * @private
   */
  _extractSummaryKey(text) {
    // 取前 20 个字符作为唯一标识
    return text.substring(0, 20).toLowerCase();
  }

  /**
   * 从 Recipe 候选中选择最有价值的
   * @param {Array} candidates - Recipe 候选
   * @param {number} targetTokens - 目标 Token 数
   * @returns {Array} 选中的 Recipe
   */
  selectTopRecipes(candidates, targetTokens) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return [];
    }

    const estimateTokens = (recipe) => {
      const content = recipe.content || recipe.snippet || '';
      return Math.ceil(content.length / 4);
    };

    const selectedRecipes = [];
    let tokensUsed = 0;

    // 按得分排序（高优先级）
    const sorted = [...candidates].sort((a, b) => {
      const scoreA = a.score || 0;
      const scoreB = b.score || 0;
      return scoreB - scoreA;
    });

    for (const recipe of sorted) {
      const recipeTokens = estimateTokens(recipe);

      if (tokensUsed + recipeTokens <= targetTokens) {
        selectedRecipes.push(recipe);
        tokensUsed += recipeTokens;
      } else if (selectedRecipes.length === 0) {
        // 至少选一个
        selectedRecipes.push(recipe);
        tokensUsed += recipeTokens;
        break;
      } else {
        break;
      }
    }

    this.emit('recipes_selected', {
      total: candidates.length,
      selected: selectedRecipes.length,
      tokensUsed,
      targetTokens
    });

    return selectedRecipes;
  }

  /**
   * 估算文本 Token 数
   * @param {string} text - 文本
   * @returns {number} Token 数
   */
  estimateTokens(text) {
    // 简单的估算: 平均 4 个字符 = 1 Token
    return Math.ceil((text || '').length / 4);
  }

  /**
   * 优化上下文使用
   * @param {Object} context - 上下文对象
   * @returns {Object} 优化后的上下文
   */
  optimizeContext(context) {
    const optimized = { ...context };
    const budget = this.allocateForScenario(context.scenario || 'default');

    // 压缩对话历史
    if (optimized.conversationHistory && budget.conversationHistory) {
      optimized.conversationHistory = this.compressConversationHistory(
        optimized.conversationHistory,
        budget.conversationHistory
      );
    }

    // 选择顶级 Recipe
    if (optimized.recipes && budget.recipes) {
      optimized.recipes = this.selectTopRecipes(
        optimized.recipes,
        budget.recipes
      );
    }

    // 截断用户输入（极少数情况）
    if (optimized.userInput && budget.userInput) {
      const maxInputChars = budget.userInput * 4;
      if (optimized.userInput.length > maxInputChars) {
        optimized.userInput = optimized.userInput.substring(0, maxInputChars) + '...';
      }
    }

    this.stats.optimizationCount++;

    return optimized;
  }

  /**
   * 记录 Token 使用
   * @param {Object} usage - 使用情况
   */
  recordUsage(usage) {
    const record = {
      timestamp: Date.now(),
      ...usage
    };

    this.requestHistory.push(record);
    this.stats.totalTokensUsed += usage.tokensUsed || 0;

    // 维持历史大小
    if (this.requestHistory.length > this.maxHistorySize) {
      this.requestHistory.shift();
    }

    // 计算使用率
    if (this.stats.totalTokensAllocated > 0) {
      this.stats.averageUsageRate = (
        this.stats.totalTokensUsed / this.stats.totalTokensAllocated
      ).toFixed(2);
    }

    this.emit('usage_recorded', record);
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    return {
      ...this.stats,
      requestHistory: this.requestHistory.slice(-10),
      scenarioAllocations: Object.keys(this.scenarioAllocations),
      maxTokens: this.config.maxTokens
    };
  }

  /**
   * 获取使用报告
   */
  getUsageReport() {
    if (this.requestHistory.length === 0) {
      return {
        totalRequests: 0,
        averageTokensPerRequest: 0,
        mostUsedScenario: null,
        recommendations: []
      };
    }

    // 统计场景使用
    const scenarioCounts = {};
    const scenarioTokens = {};

    for (const record of this.requestHistory) {
      const scenario = record.scenario || 'unknown';
      scenarioCounts[scenario] = (scenarioCounts[scenario] || 0) + 1;
      scenarioTokens[scenario] = (scenarioTokens[scenario] || 0) + (record.tokensUsed || 0);
    }

    const mostUsedScenario = Object.keys(scenarioCounts).reduce((a, b) =>
      scenarioCounts[a] > scenarioCounts[b] ? a : b
    );

    const averageTokensPerRequest = Math.floor(
      this.stats.totalTokensUsed / this.requestHistory.length
    );

    // 生成建议
    const recommendations = [];

    if (this.stats.averageUsageRate > 0.9) {
      recommendations.push('⚠️ Token 使用率 > 90%，建议增加预算或压缩上下文');
    }

    if (this.stats.compressionCount > this.stats.totalRequests * 0.3) {
      recommendations.push('💡 压缩频繁，考虑增加对话历史预算');
    }

    if (this.stats.optimizationCount > 0) {
      recommendations.push(`✅ 已优化 ${this.stats.optimizationCount} 次请求`);
    }

    return {
      totalRequests: this.requestHistory.length,
      averageTokensPerRequest,
      totalTokensUsed: this.stats.totalTokensUsed,
      mostUsedScenario,
      scenarioDistribution: scenarioCounts,
      recommendations
    };
  }

  /**
   * 重置统计
   */
  resetStatistics() {
    this.stats = {
      totalRequests: 0,
      totalTokensAllocated: 0,
      totalTokensUsed: 0,
      compressionCount: 0,
      optimizationCount: 0,
      averageUsageRate: 0
    };
    this.requestHistory = [];
  }
}

module.exports = TokenBudget;
