/**
 * MemoryManager - 多层记忆管理系统
 * 
 * 三层记忆：
 * 1. Working Memory (工作记忆) - 当前会话的上下文
 * 2. Long-term Memory (长期记忆) - 用户执行历史和偏好
 * 3. Semantic Memory (语义记忆) - 知识库中的 Recipe 信息
 */

const fs = require('fs');
const path = require('path');

class MemoryManager {
  constructor(options = {}) {
    this.persistPath = options.persistPath || '.autosnippet/memory';
    this.maxWorkingMemorySize = options.maxWorkingMemorySize || 10;
    this.maxLongTermMemorySize = options.maxLongTermMemorySize || 100;
    
    // 工作记忆（当前会话）
    this.workingMemory = new Map();
    
    // 长期记忆（跨会话）
    this.longTermMemory = new Map();
    
    // 用户偏好
    this.userPreferences = new Map();
    
    // 执行统计
    this.executionStats = {
      totalRequests: 0,
      intentCounts: {},
      agentPerformance: {},
      userBehavior: {}
    };
    
    this.initializePersistence();
  }
  
  /**
   * 初始化持久化存储
   */
  initializePersistence() {
    if (!fs.existsSync(this.persistPath)) {
      fs.mkdirSync(this.persistPath, { recursive: true });
    }
    
    // 加载已保存的记忆
    this.loadLongTermMemory();
  }
  
  /**
   * 记录新的执行
   * @param {Object} context - 执行上下文
   * @param {Object} output - 执行结果
   */
  async recordExecution(context, output) {
    const executionRecord = {
      requestId: context.requestId,
      sessionId: context.sessionId,
      userId: context.userId,
      userInput: context.userInput,
      intent: output.intent,
      timestamp: Date.now(),
      executionTime: output.metadata?.totalExecutionTime || 0,
      agentResults: output.agentResults || {},
      response: output.response || {},
      conversationLength: context.conversationHistory?.length || 0
    };
    
    // 添加到工作记忆
    this.addToWorkingMemory(executionRecord);
    
    // 添加到长期记忆
    this.addToLongTermMemory(context.sessionId, executionRecord);
    
    // 更新统计信息
    this.updateStatistics(executionRecord);
    
    // 定期持久化
    if (this.executionStats.totalRequests % 10 === 0) {
      await this.persistMemory();
    }
  }
  
  /**
   * 添加到工作记忆
   */
  addToWorkingMemory(record) {
    const sessionId = record.sessionId;
    
    if (!this.workingMemory.has(sessionId)) {
      this.workingMemory.set(sessionId, []);
    }
    
    const sessionMemory = this.workingMemory.get(sessionId);
    sessionMemory.push(record);
    
    // 保持工作记忆大小（FIFO）
    if (sessionMemory.length > this.maxWorkingMemorySize) {
      sessionMemory.shift();
    }
  }
  
  /**
   * 添加到长期记忆
   */
  addToLongTermMemory(sessionId, record) {
    if (!this.longTermMemory.has(sessionId)) {
      this.longTermMemory.set(sessionId, []);
    }
    
    const sessionHistory = this.longTermMemory.get(sessionId);
    sessionHistory.push(record);
    
    // 保持长期记忆大小
    if (sessionHistory.length > this.maxLongTermMemorySize) {
      sessionHistory.shift();
    }
  }
  
  /**
   * 获取会话的工作记忆
   */
  getWorkingMemory(sessionId) {
    return this.workingMemory.get(sessionId) || [];
  }
  
  /**
   * 获取会话的历史记忆
   */
  getSessionHistory(sessionId, limit = 10) {
    const history = this.longTermMemory.get(sessionId) || [];
    return history.slice(-limit);
  }
  
  /**
   * 获取用户的会话列表
   */
  getUserSessions(userId) {
    const sessions = [];
    
    for (const [sessionId, history] of this.longTermMemory) {
      if (history.length > 0 && history[0].userId === userId) {
        const lastRecord = history[history.length - 1];
        sessions.push({
          sessionId,
          lastActivity: lastRecord.timestamp,
          recordCount: history.length,
          intents: [...new Set(history.map(r => r.intent))]
        });
      }
    }
    
    return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
  }
  
  /**
   * 获取用户的执行统计
   */
  getUserStats(userId) {
    const userSessions = this.getUserSessions(userId);
    
    if (userSessions.length === 0) {
      return null;
    }
    
    let totalRecords = 0;
    const intentCounts = {};
    let totalTime = 0;
    
    for (const sessionData of userSessions) {
      const history = this.longTermMemory.get(sessionData.sessionId) || [];
      totalRecords += history.length;
      
      for (const record of history) {
        if (record.userId === userId) {
          intentCounts[record.intent] = (intentCounts[record.intent] || 0) + 1;
          totalTime += record.executionTime || 0;
        }
      }
    }
    
    return {
      userId,
      totalSessions: userSessions.length,
      totalRequests: totalRecords,
      intentDistribution: intentCounts,
      averageExecutionTime: totalRecords > 0 ? (totalTime / totalRecords).toFixed(2) : 0,
      lastActive: userSessions[0]?.lastActivity || null
    };
  }
  
  /**
   * 获取用户偏好
   */
  getUserPreferences(userId) {
    return this.userPreferences.get(userId) || this.initializeUserPreferences();
  }
  
  /**
   * 初始化用户偏好
   */
  initializeUserPreferences() {
    return {
      preferredLanguages: ['javascript'],
      preferredCategories: [],
      responseStyle: 'balanced',  // 'detailed' | 'concise' | 'balanced'
      focusAreas: [],
      lastUpdated: Date.now()
    };
  }
  
  /**
   * 更新用户偏好
   */
  updateUserPreferences(userId, preferences) {
    const current = this.getUserPreferences(userId);
    const updated = { ...current, ...preferences, lastUpdated: Date.now() };
    this.userPreferences.set(userId, updated);
  }
  
  /**
   * 推断用户的学习级别
   */
  inferUserLevel(userId) {
    const stats = this.getUserStats(userId);
    
    if (!stats) {
      return 'beginner';
    }
    
    const totalRequests = stats.totalRequests;
    
    // 基于请求数量推断级别
    if (totalRequests < 10) {
      return 'beginner';
    } else if (totalRequests < 50) {
      return 'intermediate';
    } else {
      return 'advanced';
    }
  }
  
  /**
   * 推荐下一步操作
   */
  recommendNextAction(userId, sessionId) {
    const sessionHistory = this.getSessionHistory(sessionId, 5);
    
    if (sessionHistory.length === 0) {
      return {
        suggestion: '开始使用搜索功能查找相关的 Recipe',
        type: 'search'
      };
    }
    
    const lastRecord = sessionHistory[sessionHistory.length - 1];
    
    // 基于最后的意图推荐
    const recommendations = {
      'lint': {
        suggestion: '检查完成！您可能想查看相关的最佳实践。',
        type: 'search'
      },
      'generate': {
        suggestion: '代码已生成。如果有任何问题，可以进行 lint 检查。',
        type: 'lint'
      },
      'search': {
        suggestion: '找到了相关的 Recipe。想要学习更多细节吗？',
        type: 'learn'
      },
      'learn': {
        suggestion: '学习完成！现在可以尝试生成相关的代码。',
        type: 'generate'
      }
    };
    
    return recommendations[lastRecord.intent] || {
      suggestion: '继续探索更多功能。',
      type: 'search'
    };
  }
  
  /**
   * 更新统计信息
   */
  updateStatistics(record) {
    this.executionStats.totalRequests++;
    
    // 意图统计
    const intent = record.intent;
    this.executionStats.intentCounts[intent] = 
      (this.executionStats.intentCounts[intent] || 0) + 1;
    
    // Agent 性能统计
    for (const [agentId, result] of Object.entries(record.agentResults)) {
      if (!this.executionStats.agentPerformance[agentId]) {
        this.executionStats.agentPerformance[agentId] = {
          totalExecutions: 0,
          successCount: 0,
          failureCount: 0,
          totalTime: 0
        };
      }
      
      const stats = this.executionStats.agentPerformance[agentId];
      stats.totalExecutions++;
      
      if (result.status === 'success') {
        stats.successCount++;
      } else {
        stats.failureCount++;
      }
      
      stats.totalTime += result.executionTime || 0;
    }
    
    // 用户行为统计
    const userId = record.userId;
    if (!this.executionStats.userBehavior[userId]) {
      this.executionStats.userBehavior[userId] = {
        requestCount: 0,
        lastActive: null
      };
    }
    
    this.executionStats.userBehavior[userId].requestCount++;
    this.executionStats.userBehavior[userId].lastActive = record.timestamp;
  }
  
  /**
   * 获取全局统计
   */
  getGlobalStatistics() {
    const stats = { ...this.executionStats };
    
    // 计算 Agent 的成功率
    for (const [agentId, agentStats] of Object.entries(stats.agentPerformance)) {
      agentStats.successRate = agentStats.totalExecutions > 0
        ? ((agentStats.successCount / agentStats.totalExecutions) * 100).toFixed(2) + '%'
        : 'N/A';
      
      agentStats.averageTime = agentStats.totalExecutions > 0
        ? (agentStats.totalTime / agentStats.totalExecutions).toFixed(2) + 'ms'
        : 'N/A';
    }
    
    return stats;
  }
  
  /**
   * 持久化记忆到磁盘
   */
  async persistMemory() {
    try {
      const memoryData = {
        timestamp: new Date().toISOString(),
        longTermMemory: Array.from(this.longTermMemory.entries()),
        userPreferences: Array.from(this.userPreferences.entries()),
        executionStats: this.executionStats
      };
      
      const filePath = path.join(this.persistPath, 'memory-snapshot.json');
      fs.writeFileSync(filePath, JSON.stringify(memoryData, null, 2));
      
      console.log(`[MemoryManager] Memory persisted at ${filePath}`);
    } catch (error) {
      console.error(`[MemoryManager] Failed to persist memory: ${error.message}`);
    }
  }
  
  /**
   * 加载长期记忆
   */
  loadLongTermMemory() {
    try {
      const filePath = path.join(this.persistPath, 'memory-snapshot.json');
      
      if (!fs.existsSync(filePath)) {
        console.log('[MemoryManager] No previous memory snapshot found');
        return;
      }
      
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      this.longTermMemory = new Map(data.longTermMemory || []);
      this.userPreferences = new Map(data.userPreferences || []);
      this.executionStats = data.executionStats || this.executionStats;
      
      console.log('[MemoryManager] Memory loaded successfully');
    } catch (error) {
      console.warn(`[MemoryManager] Failed to load memory: ${error.message}`);
    }
  }
  
  /**
   * 清空工作记忆
   */
  clearWorkingMemory(sessionId) {
    this.workingMemory.delete(sessionId);
  }
  
  /**
   * 清空所有记忆（谨慎使用）
   */
  clearAllMemory() {
    this.workingMemory.clear();
    this.longTermMemory.clear();
    this.userPreferences.clear();
    this.executionStats = {
      totalRequests: 0,
      intentCounts: {},
      agentPerformance: {},
      userBehavior: {}
    };
  }
}

module.exports = MemoryManager;
