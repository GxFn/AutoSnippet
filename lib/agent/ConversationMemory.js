/**
 * ConversationMemory - 多轮对话管理系统
 * 
 * 职责：
 * - 管理对话轮次
 * - 提取关键信息
 * - 维持对话连续性
 * - 提供上下文总结
 */

const EventEmitter = require('events');

class ConversationMemory extends EventEmitter {
  constructor(options = {}) {
    super();
    this.name = 'ConversationMemory';
    this.version = '1.0.0';

    this.config = {
      maxRounds: options.maxRounds || 5,
      compressionThreshold: options.compressionThreshold || 0.7,
      enableAutoSummary: options.enableAutoSummary !== false,
      ...options
    };

    this.logger = options.logger || console;

    // 对话状态
    this.rounds = [];
    this.keyInfo = {};
    this.contextSummary = '';
    this.relatedRecipes = [];
    this.currentRound = 0;

    // 统计
    this.stats = {
      totalRounds: 0,
      totalKeyInfoExtracted: 0,
      totalSummarizations: 0,
      averageKeysPerRound: 0
    };
  }

  /**
   * 添加新的对话轮次
   * @param {Object} round - 对话轮次
   * @returns {boolean} 添加是否成功
   */
  addRound(round) {
    if (!round || typeof round !== 'object') {
      this.logger.warn('Invalid round data');
      return false;
    }

    const newRound = {
      id: this.rounds.length + 1,
      timestamp: Date.now(),
      userInput: round.userInput || '',
      agentOutput: round.agentOutput || '',
      recipes: round.recipes || [],
      metadata: round.metadata || {},
      keyInfo: {},
      summary: ''
    };

    // 提取关键信息
    newRound.keyInfo = this.extractKeyInfo(newRound.userInput, newRound.agentOutput);
    this.stats.totalKeyInfoExtracted += Object.keys(newRound.keyInfo).length;

    // 生成轮次摘要
    newRound.summary = this.generateRoundSummary(newRound);

    this.rounds.push(newRound);
    this.stats.totalRounds++;
    this.currentRound = this.rounds.length;

    // 管理 maxRounds 限制
    if (this.rounds.length > this.config.maxRounds) {
      const removed = this.rounds.shift();
      this.emit('round_removed', {
        id: removed.id,
        reason: 'max_rounds_exceeded'
      });
    }

    // 更新全局 keyInfo
    Object.assign(this.keyInfo, newRound.keyInfo);

    // 自动生成总结
    if (this.config.enableAutoSummary && this.rounds.length >= 2) {
      this.updateContextSummary();
    }

    this.emit('round_added', {
      id: newRound.id,
      roundCount: this.rounds.length,
      keyInfoCount: Object.keys(newRound.keyInfo).length
    });

    return true;
  }

  /**
   * 提取关键信息
   * @param {string} userInput - 用户输入
   * @param {string} agentOutput - Agent 输出
   * @returns {Object} 关键信息
   */
  extractKeyInfo(userInput = '', agentOutput = '') {
    const keyInfo = {};

    // 从用户输入提取
    const userKeywords = this._extractKeywords(userInput);
    if (userKeywords.length > 0) {
      keyInfo.userIntent = userKeywords[0];
      keyInfo.topics = userKeywords;
    }

    // 从 Agent 输出提取
    const agentKeywords = this._extractKeywords(agentOutput);
    if (agentKeywords.length > 0) {
      keyInfo.solution = agentKeywords[0];
      keyInfo.solutions = agentKeywords;
    }

    // 提取代码片段
    const codeBlocks = this._extractCodeBlocks(agentOutput);
    if (codeBlocks.length > 0) {
      keyInfo.codeSnippets = codeBlocks;
    }

    // 提取提问类型
    keyInfo.questionType = this._classifyQuestion(userInput);

    // 提取涉及的领域
    keyInfo.domain = this._detectDomain(userInput + ' ' + agentOutput);

    return keyInfo;
  }

  /**
   * 提取关键词
   * @private
   */
  _extractKeywords(text = '') {
    const words = text.split(/[\s\W]+/).filter(w => w.length > 2);
    return [...new Set(words)].slice(0, 5); // 返回最多 5 个唯一关键词
  }

  /**
   * 提取代码块
   * @private
   */
  _extractCodeBlocks(text = '') {
    const codeRegex = /```[\s\S]*?```/g;
    const matches = text.match(codeRegex) || [];
    return matches.slice(0, 3); // 最多 3 个代码块
  }

  /**
   * 分类问题类型
   * @private
   */
  _classifyQuestion(text = '') {
    const textLower = text.toLowerCase();

    if (/^how|如何|怎样|怎么/.test(textLower)) return 'how_to';
    if (/^what|什么|哪个|哪些/.test(textLower)) return 'what_is';
    if (/^why|为什么/.test(textLower)) return 'why';
    if (/^fix|修复|错误|bug|问题/.test(textLower)) return 'bug_fix';
    if (/generate|创建|编写|生成/.test(textLower)) return 'generate';
    if (/optimize|优化|提升/.test(textLower)) return 'optimize';
    if (/explain|解释|说明/.test(textLower)) return 'explain';

    return 'general';
  }

  /**
   * 检测领域
   * @private
   */
  _detectDomain(text = '') {
    const textLower = text.toLowerCase();

    const domains = {
      web: /html|css|javascript|react|vue|angular|node|express|http|api/,
      mobile: /react.native|ios|android|swift|kotlin|flutter/,
      backend: /database|sql|mongodb|python|java|golang|rust|spring|django/,
      devops: /docker|kubernetes|ci\/cd|jenkins|terraform|aws|gcp/,
      security: /security|authentication|encryption|oauth|jwt|password/,
      performance: /optimization|cache|memory|cpu|performance|benchmark/
    };

    for (const [domain, regex] of Object.entries(domains)) {
      if (regex.test(textLower)) {
        return domain;
      }
    }

    return 'general';
  }

  /**
   * 生成对话轮次摘要
   * @param {Object} round - 对话轮次
   * @returns {string} 摘要
   */
  generateRoundSummary(round) {
    const parts = [];

    if (round.userInput) {
      const shortInput = round.userInput.substring(0, 50).replace(/\n/g, ' ');
      parts.push(`用户: ${shortInput}${round.userInput.length > 50 ? '...' : ''}`);
    }

    if (round.keyInfo.questionType) {
      parts.push(`[${round.keyInfo.questionType}]`);
    }

    if (round.keyInfo.domain) {
      parts.push(`@${round.keyInfo.domain}`);
    }

    return parts.join(' ');
  }

  /**
   * 更新上下文总结
   */
  updateContextSummary() {
    const summaries = this.rounds.map(r => r.summary).join(' → ');
    this.contextSummary = summaries;

    // 提取所有相关的 Recipe
    this.relatedRecipes = this._extractRelatedRecipes();

    this.stats.totalSummarizations++;

    this.emit('context_updated', {
      roundCount: this.rounds.length,
      summaryLength: this.contextSummary.length,
      relatedRecipes: this.relatedRecipes.length
    });

    return this.contextSummary;
  }

  /**
   * 提取相关的 Recipe
   * @private
   */
  _extractRelatedRecipes() {
    const recipes = [];
    const seen = new Set();

    for (const round of this.rounds) {
      if (Array.isArray(round.recipes)) {
        for (const recipe of round.recipes) {
          const key = recipe.id || recipe.name;
          if (key && !seen.has(key)) {
            recipes.push(recipe);
            seen.add(key);
          }
        }
      }
    }

    return recipes;
  }

  /**
   * 获取下一轮的上下文
   * @returns {Object} 上下文信息
   */
  getContextForNextRound() {
    if (this.rounds.length === 0) {
      return {
        previousRounds: 0,
        keyInfo: {},
        contextSummary: '',
        relatedRecipes: []
      };
    }

    // 获取最近 3 轮的上下文
    const recentRounds = this.rounds.slice(-3);
    const messages = recentRounds.map(r => ({
      userInput: r.userInput,
      agentOutput: r.agentOutput,
      keyInfo: r.keyInfo
    }));

    return {
      previousRounds: this.rounds.length,
      recentMessages: messages,
      keyInfo: this.keyInfo,
      contextSummary: this.contextSummary,
      relatedRecipes: this.relatedRecipes,
      lastRoundAt: this.rounds[this.rounds.length - 1].timestamp
    };
  }

  /**
   * 获取特定轮次的信息
   * @param {number} roundId - 轮次 ID
   * @returns {Object} 轮次信息
   */
  getRound(roundId) {
    return this.rounds.find(r => r.id === roundId) || null;
  }

  /**
   * 获取所有轮次
   * @returns {Array} 轮次数组
   */
  getAllRounds() {
    return this.rounds;
  }

  /**
   * 清除旧轮次
   * @param {number} keepCount - 保留的轮次数
   */
  clearOldRounds(keepCount = 2) {
    const toRemove = this.rounds.length - keepCount;

    if (toRemove > 0) {
      const removed = this.rounds.splice(0, toRemove);
      this.emit('old_rounds_cleared', {
        removedCount: removed.length,
        remainingCount: this.rounds.length
      });
    }
  }

  /**
   * 压缩对话记忆
   * 当达到压缩阈值时，总结并清理旧轮次
   */
  compress() {
    if (this.rounds.length < this.config.maxRounds * this.config.compressionThreshold) {
      return false; // 无需压缩
    }

    const oldRounds = this.rounds.slice(0, -2);
    const recentRounds = this.rounds.slice(-2);

    if (oldRounds.length === 0) {
      return false;
    }

    // 创建压缩摘要
    const compressedSummary = {
      id: 0,
      type: 'compressed_summary',
      timestamp: oldRounds[0].timestamp,
      originalCount: oldRounds.length,
      keyInfo: this._mergeKeyInfo(oldRounds),
      summary: `[${oldRounds.length} 轮对话的总结]`
    };

    // 替换旧轮次
    this.rounds = [compressedSummary, ...recentRounds];

    this.emit('memory_compressed', {
      originalRounds: oldRounds.length + recentRounds.length,
      compressedRounds: this.rounds.length,
      tokensEstimated: this._estimateTokenSavings(oldRounds)
    });

    return true;
  }

  /**
   * 合并多个轮次的关键信息
   * @private
   */
  _mergeKeyInfo(rounds) {
    const merged = {};

    for (const round of rounds) {
      for (const [key, value] of Object.entries(round.keyInfo || {})) {
        if (Array.isArray(value)) {
          if (!Array.isArray(merged[key])) {
            merged[key] = [];
          }
          merged[key].push(...value);
        } else if (typeof value === 'object') {
          merged[key] = Object.assign(merged[key] || {}, value);
        } else {
          merged[key] = value;
        }
      }
    }

    return merged;
  }

  /**
   * 估算节省的 Token 数
   * @private
   */
  _estimateTokenSavings(rounds) {
    let totalChars = 0;

    for (const round of rounds) {
      totalChars += (round.userInput || '').length;
      totalChars += (round.agentOutput || '').length;
    }

    // 估算: 4 个字符约 1 Token
    return Math.ceil(totalChars / 4);
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    return {
      ...this.stats,
      currentRounds: this.rounds.length,
      totalKeyInfoKeys: Object.keys(this.keyInfo).length,
      averageKeysPerRound: this.stats.totalRounds > 0
        ? (this.stats.totalKeyInfoExtracted / this.stats.totalRounds).toFixed(2)
        : 0,
      summaryLength: this.contextSummary.length,
      relatedRecipesCount: this.relatedRecipes.length
    };
  }

  /**
   * 清除所有数据
   */
  clear() {
    this.rounds = [];
    this.keyInfo = {};
    this.contextSummary = '';
    this.relatedRecipes = [];
    this.currentRound = 0;
    this.emit('memory_cleared');
  }

  /**
   * 序列化为 JSON（用于持久化）
   */
  toJSON() {
    return {
      rounds: this.rounds,
      keyInfo: this.keyInfo,
      contextSummary: this.contextSummary,
      relatedRecipes: this.relatedRecipes,
      stats: this.stats
    };
  }

  /**
   * 从 JSON 恢复（用于加载）
   */
  fromJSON(data) {
    if (data.rounds) this.rounds = data.rounds;
    if (data.keyInfo) this.keyInfo = data.keyInfo;
    if (data.contextSummary) this.contextSummary = data.contextSummary;
    if (data.relatedRecipes) this.relatedRecipes = data.relatedRecipes;
    if (data.stats) this.stats = data.stats;
    this.currentRound = this.rounds.length;
  }
}

module.exports = ConversationMemory;
