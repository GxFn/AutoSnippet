/**
 * CrossSessionLearner - 跨会话学习和知识积累
 * 
 * 职责：
 * - 跨会话上下文保持
 * - 知识积累
 * - 学习路径管理
 * - 进度追踪
 */

const fs = require('fs');
const path = require('path');

class CrossSessionLearner {
  constructor(options = {}) {
    this.name = 'CrossSessionLearner';
    this.version = '1.0.0';

    this.config = {
      persistencePath: options.persistencePath || './data/sessions',
      maxSessions: options.maxSessions || 100,
      enableAutoSave: options.enableAutoSave !== false,
      autoSaveInterval: options.autoSaveInterval || 60000, // 1 分钟
      ...options
    };

    this.logger = options.logger || console;

    // 会话存储 Map<userId, SessionData>
    this.sessions = new Map();

    // 学习路径 Map<userId, LearningPath>
    this.learningPaths = new Map();

    // 知识库 Map<topicId, KnowledgeItem>
    this.knowledgeBase = new Map();

    // 统计
    this.stats = {
      totalSessions: 0,
      totalSessionHours: 0,
      knowledgeItemsLearned: 0,
      pathsCompleted: 0,
      crossSessionQueries: 0
    };

    // 初始化持久化
    this._initPersistence();

    // 自动保存
    if (this.config.enableAutoSave) {
      this.autoSaveInterval = setInterval(() => this._autoSave(), this.config.autoSaveInterval);
    }
  }

  /**
   * 初始化持久化
   * @private
   */
  _initPersistence() {
    try {
      if (!fs.existsSync(this.config.persistencePath)) {
        fs.mkdirSync(this.config.persistencePath, { recursive: true });
      }
    } catch (error) {
      this.logger.error('[CrossSessionLearner] 初始化持久化失败:', error.message);
    }
  }

  /**
   * 创建或恢复会话
   * @param {string} userId - 用户 ID
   * @returns {Object} 会话对象
   */
  createSession(userId) {
    // 尝试加载之前的会话
    let session = this._loadSession(userId);

    if (!session) {
      // 创建新会话
      session = {
        userId,
        sessionId: `session_${Date.now()}`,
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        interactions: [],
        learningItems: [],
        completedTopics: new Set(),
        currentLearningPath: null,
        contextSummary: {}
      };

      this.stats.totalSessions++;
    } else {
      // 恢复会话
      session.lastAccessed = Date.now();
      session.resumedFrom = session.sessionId;
      session.sessionId = `session_${Date.now()}`;
    }

    this.sessions.set(userId, session);
    return session;
  }

  /**
   * 记录学习项目
   * @param {string} userId - 用户 ID
   * @param {Object} learningItem - 学习项目
   */
  recordLearning(userId, learningItem) {
    let session = this.sessions.get(userId);
    if (!session) {
      session = this.createSession(userId);
    }

    const item = {
      ...learningItem,
      timestamp: Date.now(),
      sessionId: session.sessionId,
      topicId: learningItem.topic || 'general',
      proficiency: learningItem.proficiency || 0.5,
      reviewed: false
    };

    // 添加到当前会话
    session.learningItems.push(item);

    // 添加到知识库
    this._addToKnowledgeBase(item.topicId, item);

    // 更新完成的话题
    if (item.proficiency > 0.8) {
      session.completedTopics.add(item.topicId);
    }

    this.stats.knowledgeItemsLearned++;
    session.lastAccessed = Date.now();
  }

  /**
   * 获取学习进度
   * @param {string} userId - 用户 ID
   * @returns {Object} 进度信息
   */
  getLearningProgress(userId) {
    const session = this.sessions.get(userId);
    if (!session) {
      return this._getDefaultProgress();
    }

    const topics = Array.from(session.completedTopics);
    const totalItems = session.learningItems.length;
    const masteredItems = session.learningItems.filter(i => i.proficiency > 0.8).length;

    return {
      userId,
      sessionCount: session.sessionId ? 1 : 0,
      totalLearningItems: totalItems,
      masteredTopics: topics.length,
      masteredItems,
      overallProficiency: totalItems > 0
        ? (session.learningItems.reduce((sum, i) => sum + i.proficiency, 0) / totalItems).toFixed(2)
        : 0,
      completedTopics: topics,
      currentPath: session.currentLearningPath,
      lastAccessed: new Date(session.lastAccessed).toISOString()
    };
  }

  /**
   * 建议学习路径
   * @param {string} userId - 用户 ID
   * @param {string} goalTopic - 目标话题
   * @returns {Object} 学习路径
   */
  suggestLearningPath(userId, goalTopic) {
    const progress = this.getLearningProgress(userId);
    const knowledgeItems = this.knowledgeBase.get(goalTopic) || [];

    // 构建学习路径
    const path = {
      userId,
      goal: goalTopic,
      suggestedAt: Date.now(),
      steps: [],
      estimatedDuration: 0,
      prerequisites: [],
      difficulty: 'intermediate'
    };

    // 按难度排序学习项目
    const sortedItems = knowledgeItems
      .sort((a, b) => (a.difficulty || 0) - (b.difficulty || 0));

    // 确定起点
    const masteredItems = new Set(progress.completedTopics);
    const prerequisites = sortedItems
      .filter(item => !masteredItems.has(item.topicId))
      .slice(0, 5);

    path.prerequisites = prerequisites.map(item => item.topicId);
    path.steps = prerequisites.map((item, index) => ({
      order: index + 1,
      topic: item.topicId,
      title: item.title,
      duration: item.estimatedDuration || 30,
      difficulty: item.difficulty || 'intermediate'
    }));

    path.estimatedDuration = path.steps.reduce((sum, step) => sum + step.duration, 0);

    // 确定难度级别
    if (progress.overallProficiency > 0.7) {
      path.difficulty = 'advanced';
    } else if (progress.overallProficiency < 0.3) {
      path.difficulty = 'beginner';
    }

    // 保存学习路径
    this.learningPaths.set(userId, path);

    const session = this.sessions.get(userId);
    if (session) {
      session.currentLearningPath = path.goal;
    }

    return path;
  }

  /**
   * 跟踪学习进度
   * @param {string} userId - 用户 ID
   * @param {string} topicId - 话题 ID
   * @param {number} progress - 进度 (0-1)
   */
  updateProgress(userId, topicId, progress) {
    const session = this.sessions.get(userId);
    if (!session) {
      this.createSession(userId);
    }

    // 更新对应学习项目的进度
    const item = session.learningItems.find(i => i.topicId === topicId);
    if (item) {
      item.proficiency = Math.max(item.proficiency, progress);
      item.lastUpdated = Date.now();

      // 如果掌握程度达到阈值，标记为完成
      if (item.proficiency > 0.8) {
        session.completedTopics.add(topicId);
      }
    }

    session.lastAccessed = Date.now();
  }

  /**
   * 添加到知识库
   * @private
   */
  _addToKnowledgeBase(topicId, item) {
    if (!this.knowledgeBase.has(topicId)) {
      this.knowledgeBase.set(topicId, []);
    }

    const items = this.knowledgeBase.get(topicId);
    const existingIndex = items.findIndex(i => i.id === item.id);

    if (existingIndex >= 0) {
      items[existingIndex] = item;
    } else {
      items.push(item);
    }
  }

  /**
   * 保存会话
   * @param {string} userId - 用户 ID
   */
  saveSession(userId) {
    const session = this.sessions.get(userId);
    if (!session) return false;

    try {
      const sessionPath = path.join(
        this.config.persistencePath,
        `${userId}_session.json`
      );

      const data = {
        ...session,
        completedTopics: Array.from(session.completedTopics)
      };

      fs.writeFileSync(sessionPath, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      this.logger.error(`[CrossSessionLearner] 保存会话失败 ${userId}:`, error.message);
      return false;
    }
  }

  /**
   * 加载会话
   * @private
   */
  _loadSession(userId) {
    try {
      const sessionPath = path.join(
        this.config.persistencePath,
        `${userId}_session.json`
      );

      if (!fs.existsSync(sessionPath)) {
        return null;
      }

      const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      data.completedTopics = new Set(data.completedTopics);

      return data;
    } catch (error) {
      this.logger.warn(`[CrossSessionLearner] 加载会话失败 ${userId}:`, error.message);
      return null;
    }
  }

  /**
   * 自动保存
   * @private
   */
  _autoSave() {
    for (const userId of this.sessions.keys()) {
      this.saveSession(userId);
    }
  }

  /**
   * 获取跨会话信息
   * @param {string} userId - 用户 ID
   * @returns {Object} 跨会话信息
   */
  getCrossSessionInfo(userId) {
    const session = this.sessions.get(userId);
    if (!session) return null;

    const path = this.learningPaths.get(userId);

    return {
      userId,
      currentSession: session.sessionId,
      totalSessions: 1,
      learningItems: session.learningItems.length,
      completedTopics: Array.from(session.completedTopics),
      currentLearningPath: path ? {
        goal: path.goal,
        progress: path.steps ? path.steps.length : 0,
        estimatedDuration: path.estimatedDuration
      } : null,
      knowledgeItems: this.knowledgeBase.size
    };
  }

  /**
   * 获取默认进度
   * @private
   */
  _getDefaultProgress() {
    return {
      totalLearningItems: 0,
      masteredTopics: 0,
      masteredItems: 0,
      overallProficiency: 0,
      completedTopics: [],
      currentPath: null
    };
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    return {
      ...this.stats,
      activeSessions: this.sessions.size,
      knowledgeItems: this.knowledgeBase.size,
      averageSessionDuration: this.stats.totalSessions > 0
        ? (this.stats.totalSessionHours / this.stats.totalSessions).toFixed(1) + ' 小时'
        : '0 小时'
    };
  }

  /**
   * 重置统计
   */
  resetStatistics() {
    this.stats = {
      totalSessions: 0,
      totalSessionHours: 0,
      knowledgeItemsLearned: 0,
      pathsCompleted: 0,
      crossSessionQueries: 0
    };
  }

  /**
   * 清理资源
   */
  cleanup() {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }

    // 保存所有会话
    for (const userId of this.sessions.keys()) {
      this.saveSession(userId);
    }
  }
}

module.exports = CrossSessionLearner;
