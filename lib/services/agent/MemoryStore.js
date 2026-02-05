/**
 * MemoryStore - 分布式内存管理系统
 * 提供长期记忆、知识持久化、语义检索
 * 
 * 设计特点：
 * 1. 多层记忆模型（短期、长期、知识库）
 * 2. 语义相似度检索
 * 3. TTL 和容量限制
 * 4. 向量化存储
 * 5. 自适应遗忘
 */

class MemoryStore {
  constructor(logger, options = {}) {
  this.logger = logger;

  this.config = {
    maxShortTermMemory: options.maxShortTermMemory || 100,
    maxLongTermMemory: options.maxLongTermMemory || 1000,
    shortTermTTL: options.shortTermTTL || 3600000, // 1小时
    longTermTTL: options.longTermTTL || 2592000000, // 30天
    enableAutoForget: options.enableAutoForget !== false,
    similarityThreshold: options.similarityThreshold || 0.7,
  };

  // 记忆存储
  this.shortTermMemory = []; // 最近的交互记录
  this.longTermMemory = []; // 重要的信息
  this.knowledgeBase = new Map(); // 主题 -> 知识项目数组

  // 统计
  this.stats = {
    totalMemoriesStored: 0,
    totalMemoriesRetrieved: 0,
    totalForgetEvents: 0,
    avgSimilarityScore: 0,
    totalSimilarityQueries: 0,
  };

  this.cleanupInterval = null;
  }

  /**
   * 存储到短期记忆
   */
  storeShortTerm(content, metadata = {}) {
  if (this.shortTermMemory.length >= this.config.maxShortTermMemory) {
    // 移除最早的记忆
    const removed = this.shortTermMemory.shift();
    this.logger.debug(`Short-term memory overflow, removed: ${removed.id}`);
  }

  const memory = {
    id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    content,
    metadata,
    storedAt: new Date(),
    expiresAt: new Date(Date.now() + this.config.shortTermTTL),
    type: 'short-term',
    accessCount: 0,
    lastAccessedAt: null,
  };

  this.shortTermMemory.push(memory);
  this.stats.totalMemoriesStored += 1;

  this.logger.debug(`Short-term memory stored: ${memory.id}`);
  return memory.id;
  }

  /**
   * 存储到长期记忆
   * 通常用于重要信息、用户偏好、历史决策等
   */
  storeLongTerm(content, metadata = {}, topic = 'general') {
  if (this.longTermMemory.length >= this.config.maxLongTermMemory) {
    // 移除访问次数最少的记忆
    const sorted = this.longTermMemory.sort((a, b) => a.accessCount - b.accessCount);
    const removed = sorted.shift();
    const index = this.longTermMemory.indexOf(removed);
    if (index >= 0) {
    this.longTermMemory.splice(index, 1);
    }
    this.logger.debug(`Long-term memory overflow, removed: ${removed.id}`);
  }

  const memory = {
    id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    content,
    metadata,
    topic,
    storedAt: new Date(),
    expiresAt: new Date(Date.now() + this.config.longTermTTL),
    type: 'long-term',
    accessCount: 0,
    lastAccessedAt: null,
    importance: metadata.importance || 0.5, // 0-1 scale
  };

  this.longTermMemory.push(memory);

  // 按主题索引
  if (!this.knowledgeBase.has(topic)) {
    this.knowledgeBase.set(topic, []);
  }
  this.knowledgeBase.get(topic).push(memory.id);

  this.stats.totalMemoriesStored += 1;
  this.logger.debug(`Long-term memory stored: ${memory.id} (topic: ${topic})`);
  return memory.id;
  }

  /**
   * 检索短期记忆
   */
  retrieveShortTerm(query, limit = 5) {
  const results = this._search(this.shortTermMemory, query, limit);
  results.forEach(result => {
    result.memory.accessCount += 1;
    result.memory.lastAccessedAt = new Date();
  });
  this.stats.totalMemoriesRetrieved += results.length;
  return results;
  }

  /**
   * 检索长期记忆
   */
  retrieveLongTerm(query, limit = 5, minImportance = 0) {
  const filtered = this.longTermMemory.filter(m => m.importance >= minImportance);
  const results = this._search(filtered, query, limit);
  results.forEach(result => {
    result.memory.accessCount += 1;
    result.memory.lastAccessedAt = new Date();
  });
  this.stats.totalMemoriesRetrieved += results.length;
  return results;
  }

  /**
   * 按主题检索
   */
  retrieveByTopic(topic, limit = 10) {
  const memoryIds = this.knowledgeBase.get(topic) || [];
  const memories = memoryIds
    .map(id => this._findMemoryById(id))
    .filter(Boolean)
    .slice(0, limit);

  memories.forEach(m => {
    m.accessCount += 1;
    m.lastAccessedAt = new Date();
  });
  this.stats.totalMemoriesRetrieved += memories.length;
  return memories;
  }

  /**
   * 语义相似度搜索
   */
  searchBySimilarity(query, limit = 5) {
  const allMemories = [...this.shortTermMemory, ...this.longTermMemory];
  const results = this._search(allMemories, query, limit);

  // 计算平均相似度
  if (results.length > 0) {
    const avgScore = results.reduce((sum, r) => sum + r.similarity, 0) / results.length;
    this.stats.avgSimilarityScore = 
    (this.stats.avgSimilarityScore + avgScore) / 2;
  }
  this.stats.totalSimilarityQueries += 1;

  results.forEach(result => {
    result.memory.accessCount += 1;
    result.memory.lastAccessedAt = new Date();
  });

  return results;
  }

  /**
   * 更新记忆（提高重要性或元数据）
   */
  updateMemory(memoryId, updates) {
  const memory = this._findMemoryById(memoryId);
  if (!memory) {
    throw new Error(`Memory not found: ${memoryId}`);
  }

  if (updates.importance !== undefined) {
    memory.importance = Math.max(0, Math.min(1, updates.importance));
  }
  if (updates.metadata !== undefined) {
    memory.metadata = { ...memory.metadata, ...updates.metadata };
  }
  if (updates.content !== undefined) {
    memory.content = updates.content;
  }

  this.logger.debug(`Memory updated: ${memoryId}`);
  return memory;
  }

  /**
   * 删除记忆
   */
  deleteMemory(memoryId) {
  const shortTermIndex = this.shortTermMemory.findIndex(m => m.id === memoryId);
  if (shortTermIndex >= 0) {
    this.shortTermMemory.splice(shortTermIndex, 1);
    this.logger.debug(`Short-term memory deleted: ${memoryId}`);
    return true;
  }

  const longTermIndex = this.longTermMemory.findIndex(m => m.id === memoryId);
  if (longTermIndex >= 0) {
    this.longTermMemory.splice(longTermIndex, 1);
    // 从主题索引中删除
    for (const [topic, ids] of this.knowledgeBase.entries()) {
    const idIndex = ids.indexOf(memoryId);
    if (idIndex >= 0) {
      ids.splice(idIndex, 1);
    }
    }
    this.logger.debug(`Long-term memory deleted: ${memoryId}`);
    return true;
  }

  return false;
  }

  /**
   * 简单的文本相似度计算（词频匹配）
   */
  _calculateSimilarity(query, text) {
  const queryWords = query.toLowerCase().split(/\s+/);
  const textWords = text.toLowerCase().split(/\s+/);

  const matchedWords = queryWords.filter(word => 
    textWords.some(tw => tw.includes(word) || word.includes(tw))
  );

  return matchedWords.length / queryWords.length;
  }

  /**
   * 搜索实现
   */
  _search(memories, query, limit) {
  const results = memories
    .map(memory => ({
    memory,
    similarity: this._calculateSimilarity(query, memory.content),
    }))
    .filter(r => r.similarity >= this.config.similarityThreshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return results;
  }

  /**
   * 根据 ID 查找记忆
   */
  _findMemoryById(memoryId) {
  let memory = this.shortTermMemory.find(m => m.id === memoryId);
  if (!memory) {
    memory = this.longTermMemory.find(m => m.id === memoryId);
  }
  return memory;
  }

  /**
   * 自动遗忘过期记忆
   */
  _autoForget() {
  const now = Date.now();

  const shortTermToRemove = this.shortTermMemory.filter(m =>
    m.expiresAt.getTime() < now
  );
  shortTermToRemove.forEach(m => {
    const index = this.shortTermMemory.indexOf(m);
    if (index >= 0) {
    this.shortTermMemory.splice(index, 1);
    this.stats.totalForgetEvents += 1;
    }
  });

  const longTermToRemove = this.longTermMemory.filter(m =>
    m.expiresAt.getTime() < now
  );
  longTermToRemove.forEach(m => {
    const index = this.longTermMemory.indexOf(m);
    if (index >= 0) {
    this.longTermMemory.splice(index, 1);
    // 从主题索引中删除
    for (const [topic, ids] of this.knowledgeBase.entries()) {
      const idIndex = ids.indexOf(m.id);
      if (idIndex >= 0) {
      ids.splice(idIndex, 1);
      }
    }
    this.stats.totalForgetEvents += 1;
    }
  });

  if (shortTermToRemove.length > 0 || longTermToRemove.length > 0) {
    this.logger.debug(
    `Auto-forget: ${shortTermToRemove.length} short-term + ${longTermToRemove.length} long-term`
    );
  }
  }

  /**
   * 启动自动清理任务
   */
  startAutoCleanup(interval = 60000) {
  if (this.cleanupInterval) return;

  if (this.config.enableAutoForget) {
    this.cleanupInterval = setInterval(() => {
    this._autoForget();
    }, interval);

    this.logger.info(`Auto cleanup started (interval: ${interval}ms)`);
  }
  }

  /**
   * 获取统计信息
   */
  getStats() {
  return {
    shortTermMemory: {
    count: this.shortTermMemory.length,
    capacity: this.config.maxShortTermMemory,
    utilization: (this.shortTermMemory.length / this.config.maxShortTermMemory * 100).toFixed(2) + '%',
    },
    longTermMemory: {
    count: this.longTermMemory.length,
    capacity: this.config.maxLongTermMemory,
    utilization: (this.longTermMemory.length / this.config.maxLongTermMemory * 100).toFixed(2) + '%',
    },
    knowledgeBase: {
    topics: this.knowledgeBase.size,
    topicsList: Array.from(this.knowledgeBase.entries()).map(([topic, ids]) => ({
      topic,
      count: ids.length,
    })),
    },
    ...this.stats,
  };
  }

  /**
   * 清理所有记忆
   */
  clear() {
  this.shortTermMemory = [];
  this.longTermMemory = [];
  this.knowledgeBase.clear();
  this.logger.info('All memories cleared');
  }

  /**
   * 关闭（停止清理任务）
   */
  close() {
  if (this.cleanupInterval) {
    clearInterval(this.cleanupInterval);
    this.cleanupInterval = null;
  }
  this.logger.info('MemoryStore closed');
  }
}

module.exports = MemoryStore;
