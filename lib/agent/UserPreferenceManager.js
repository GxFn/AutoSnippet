/**
 * UserPreferenceManager - 用户偏好学习和个性化
 * 
 * 职责：
 * - 用户行为追踪
 * - 偏好学习
 * - 推荐个性化
 * - 交互优化
 */

class UserPreferenceManager {
  constructor(options = {}) {
    this.name = 'UserPreferenceManager';
    this.version = '1.0.0';

    this.config = {
      maxHistorySize: options.maxHistorySize || 1000,
      decayFactor: options.decayFactor || 0.95,
      updateInterval: options.updateInterval || 100,
      ...options
    };

    this.logger = options.logger || console;

    // 用户数据 Map<userId, UserProfile>
    this.users = new Map();

    // 统计
    this.stats = {
      totalUsers: 0,
      totalInteractions: 0,
      preferencesLearned: 0,
      recommendationsGenerated: 0
    };
  }

  /**
   * 记录用户交互
   * @param {string} userId - 用户 ID
   * @param {Object} interaction - 交互数据
   */
  recordInteraction(userId, interaction) {
    let userProfile = this.users.get(userId);

    if (!userProfile) {
      userProfile = this._createUserProfile(userId);
      this.users.set(userId, userProfile);
      this.stats.totalUsers++;
    }

    // 添加交互到历史
    userProfile.interactions.push({
      ...interaction,
      timestamp: Date.now(),
      weight: 1.0
    });

    // 维持历史大小
    if (userProfile.interactions.length > this.config.maxHistorySize) {
      userProfile.interactions = userProfile.interactions.slice(-this.config.maxHistorySize);
    }

    // 更新主题偏好
    if (interaction.topic) {
      const topicPref = userProfile.topicPreferences.get(interaction.topic) || 0;
      userProfile.topicPreferences.set(
        interaction.topic,
        topicPref + 1
      );
    }

    // 更新 Agent 偏好
    if (interaction.agent) {
      const agentPref = userProfile.agentPreferences.get(interaction.agent) || 0;
      userProfile.agentPreferences.set(
        interaction.agent,
        agentPref + (interaction.success ? 1 : 0.5)
      );
    }

    // 更新内容质量偏好
    if (interaction.quality !== undefined) {
      userProfile.contentQualityPref = 
        (userProfile.contentQualityPref * 0.9) + (interaction.quality * 0.1);
    }

    this.stats.totalInteractions++;
    userProfile.lastUpdated = Date.now();
  }

  /**
   * 获取用户偏好
   * @param {string} userId - 用户 ID
   * @returns {Object} 用户偏好
   */
  getUserPreferences(userId) {
    const userProfile = this.users.get(userId);
    if (!userProfile) {
      return this._getDefaultPreferences();
    }

    return {
      userId,
      topicPreferences: this._rankMap(userProfile.topicPreferences),
      agentPreferences: this._rankMap(userProfile.agentPreferences),
      contentQuality: userProfile.contentQualityPref,
      interactionCount: userProfile.interactions.length,
      learningScore: this._calculateLearningScore(userProfile),
      lastUpdated: userProfile.lastUpdated
    };
  }

  // 兼容旧调用
  getUserPreference(userId) {
    return this.getUserPreferences(userId);
  }

  /**
   * 生成个性化推荐
   * @param {string} userId - 用户 ID
   * @param {Object} context - 上下文
   * @returns {Object} 推荐信息
   */
  generateRecommendations(userId, context = {}) {
    const preferences = this.getUserPreferences(userId);
    const recommendations = {
      preferredTopics: [],
      recommendedAgents: [],
      contentType: 'balanced',
      difficulty: 'intermediate',
      confidence: 0
    };

    // 基于交互历史推荐话题
    if (preferences.topicPreferences && preferences.topicPreferences.length > 0) {
      recommendations.preferredTopics = preferences.topicPreferences
        .slice(0, 3)
        .map(item => item.topic);
    }

    // 基于成功率推荐 Agent
    if (preferences.agentPreferences && preferences.agentPreferences.length > 0) {
      recommendations.recommendedAgents = preferences.agentPreferences
        .slice(0, 2)
        .map(item => item.agent);
    }

    // 根据内容质量偏好确定难度
    if (preferences.contentQuality > 0.7) {
      recommendations.difficulty = 'advanced';
    } else if (preferences.contentQuality < 0.3) {
      recommendations.difficulty = 'beginner';
    }

    // 根据学习分数确定内容类型
    const learningScore = preferences.learningScore || 0.5;
    if (learningScore > 0.7) {
      recommendations.contentType = 'exploration'; // 探索新内容
    } else if (learningScore < 0.3) {
      recommendations.contentType = 'reinforcement'; // 加强基础
    }

    recommendations.confidence = this._calculateConfidence(preferences);
    this.stats.recommendationsGenerated++;

    return recommendations;
  }

  /**
   * 学习用户风格
   * @private
   */
  _createUserProfile(userId) {
    return {
      userId,
      interactions: [],
      topicPreferences: new Map(),
      agentPreferences: new Map(),
      contentQualityPref: 0.5,
      learningStyle: 'balanced', // balanced, visual, textual, interactive
      responseTime: null,
      createdAt: Date.now(),
      lastUpdated: Date.now()
    };
  }

  /**
   * 排序 Map 的条目
   * @private
   */
  _rankMap(map) {
    if (!map || map.size === 0) return [];

    return Array.from(map.entries())
      .map(([key, value]) => ({ [key === 'topic' ? 'topic' : key === 'agent' ? 'agent' : 'key']: key, score: value }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * 计算学习分数
   * @private
   */
  _calculateLearningScore(userProfile) {
    if (userProfile.interactions.length === 0) return 0;

    // 基于交互多样性和成功率计算
    const topicDiversity = userProfile.topicPreferences.size / 8; // 8 种话题
    const agentDiversity = userProfile.agentPreferences.size / 4; // 4 个 Agent
    const quality = userProfile.contentQualityPref;

    return (topicDiversity * 0.3 + agentDiversity * 0.3 + quality * 0.4);
  }

  /**
   * 计算推荐信心度
   * @private
   */
  _calculateConfidence(preferences) {
    if (!preferences) return 0;

    const interactionScore = Math.min(preferences.interactionCount / 10, 1);
    const learningScore = preferences.learningScore || 0;

    return (interactionScore * 0.6 + learningScore * 0.4);
  }

  /**
   * 获取默认偏好
   * @private
   */
  _getDefaultPreferences() {
    return {
      topicPreferences: [],
      agentPreferences: [],
      contentQuality: 0.5,
      interactionCount: 0,
      learningScore: 0,
      lastUpdated: null
    };
  }

  /**
   * 获取用户相似性
   * @param {string} userId1 - 用户 1
   * @param {string} userId2 - 用户 2
   * @returns {number} 相似性分数 (0-1)
   */
  getSimilarity(userId1, userId2) {
    const prefs1 = this.getUserPreferences(userId1);
    const prefs2 = this.getUserPreferences(userId2);

    if (!prefs1 || !prefs2) return 0;

    // 基于话题偏好计算相似性
    const topics1 = new Set((prefs1.topicPreferences || []).map(p => p.topic));
    const topics2 = new Set((prefs2.topicPreferences || []).map(p => p.topic));

    const intersection = new Set([...topics1].filter(x => topics2.has(x)));
    const union = new Set([...topics1, ...topics2]);

    const jaccardSimilarity = intersection.size / (union.size || 1);

    // 基于内容质量偏好
    const qualityDiff = Math.abs(prefs1.contentQuality - prefs2.contentQuality);
    const qualitySimilarity = 1 - qualityDiff;

    return (jaccardSimilarity * 0.6 + qualitySimilarity * 0.4);
  }

  /**
   * 获取协作过滤推荐
   * @param {string} userId - 用户 ID
   * @returns {Array} 推荐列表
   */
  getCollaborativeRecommendations(userId) {
    const targetPrefs = this.getUserPreferences(userId);
    const recommendations = [];

    // 找到相似用户
    const similarUsers = [];
    for (const [otherUserId] of this.users) {
      if (otherUserId !== userId) {
        const similarity = this.getSimilarity(userId, otherUserId);
        if (similarity > 0.5) {
          similarUsers.push({ userId: otherUserId, similarity });
        }
      }
    }

    // 从相似用户收集推荐
    const topicScores = new Map();
    for (const similarUser of similarUsers) {
      const otherPrefs = this.getUserPreferences(similarUser.userId);
      for (const topic of otherPrefs.topicPreferences || []) {
        const currentScore = topicScores.get(topic.topic) || 0;
        topicScores.set(topic.topic, currentScore + similarUser.similarity);
      }
    }

    // 排序推荐
    const sorted = Array.from(topicScores.entries())
      .map(([topic, score]) => ({ topic, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return sorted;
  }

  /**
   * 获取用户统计
   */
  getUserStatistics(userId) {
    const userProfile = this.users.get(userId);
    if (!userProfile) return null;

    return {
      userId,
      interactionCount: userProfile.interactions.length,
      topicCount: userProfile.topicPreferences.size,
      agentCount: userProfile.agentPreferences.size,
      contentQuality: userProfile.contentQualityPref.toFixed(2),
      learningScore: this._calculateLearningScore(userProfile).toFixed(2),
      createdAt: new Date(userProfile.createdAt).toISOString(),
      lastUpdated: new Date(userProfile.lastUpdated).toISOString()
    };
  }

  /**
   * 导出用户数据
   */
  exportUserData(userId) {
    const userProfile = this.users.get(userId);
    if (!userProfile) return null;

    return {
      userId,
      profile: {
        createdAt: userProfile.createdAt,
        lastUpdated: userProfile.lastUpdated,
        interactionCount: userProfile.interactions.length
      },
      preferences: this.getUserPreferences(userId),
      statistics: this.getUserStatistics(userId),
      recentInteractions: userProfile.interactions.slice(-10)
    };
  }

  /**
   * 删除用户数据
   */
  deleteUserData(userId) {
    this.users.delete(userId);
  }

  /**
   * 获取系统统计
   */
  getStatistics() {
    return {
      ...this.stats,
      averagePreferences: this.stats.totalUsers > 0
        ? (this.stats.totalInteractions / this.stats.totalUsers).toFixed(2)
        : 0,
      recommendationRate: this.stats.totalInteractions > 0
        ? ((this.stats.recommendationsGenerated / this.stats.totalInteractions) * 100).toFixed(2)
        : 0
    };
  }

  /**
   * 重置统计
   */
  resetStatistics() {
    this.stats = {
      totalUsers: 0,
      totalInteractions: 0,
      preferencesLearned: 0,
      recommendationsGenerated: 0
    };
  }
}

module.exports = UserPreferenceManager;
