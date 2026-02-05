/**
 * IntelligentServiceLayer - 智能服务层
 * 
 * 将 Agent 引擎能力集成到基础业务服务中，提供智能化增强
 * 
 * 核心能力：
 * 1. 意图识别：自动理解用户查询意图
 * 2. 智能路由：根据意图将请求路由到最合适的服务
 * 3. 上下文感知：维护会话上下文，提供连续对话能力
 * 4. 结果优化：使用 Agent 进行结果重排序和优化
 * 5. 自适应学习：根据用户反馈优化服务质量
 * 
 * 架构：
 *                User Request
 *                     ↓
 *        ┌─────────────────────────┐
 *        │ IntelligentServiceLayer │
 *        │  ┌──────────────────┐   │
 *        │  │ Intent Classifier│   │ ← 意图分类
 *        │  └──────────────────┘   │
 *        │  ┌──────────────────┐   │
 *        │  │ Context Manager  │   │ ← 上下文管理
 *        │  └──────────────────┘   │
 *        │  ┌──────────────────┐   │
 *        │  │ Smart Router     │   │ ← 智能路由
 *        │  └──────────────────┘   │
 *        └─────────────────────────┘
 *                     ↓
 *      ┌──────┬───────┬───────┬────────┐
 *      ↓      ↓       ↓       ↓        ↓
 *   Search Context Candidate Guard Injection
 *   Service Service Service Service Service
 *      ↓      ↓       ↓       ↓        ↓
 *      └──────┴───────┴───────┴────────┘
 *                     ↓
 *        ┌─────────────────────────┐
 *        │    Agent Enhancement    │
 *        │  ┌──────────────────┐   │
 *        │  │ Result Reranker  │   │ ← 结果优化
 *        │  └──────────────────┘   │
 *        │  ┌──────────────────┐   │
 *        │  │ Quality Scorer   │   │ ← 质量评分
 *        │  └──────────────────┘   │
 *        │  ┌──────────────────┐   │
 *        │  │ User Preference  │   │ ← 个性化
 *        │  └──────────────────┘   │
 *        └─────────────────────────┘
 *                     ↓
 *              Enhanced Result
 */

const IntentClassifier = require('../../agent/IntentClassifier');
const ConversationManager = require('../../agent/ConversationManager');
const UserPreferenceManager = require('../../agent/UserPreferenceManager');
const ResultFusion = require('../../agent/ResultFusion');

class IntelligentServiceLayer {
  constructor(projectRoot, options = {}) {
  this.projectRoot = projectRoot;
  this.options = options;

  // 基础服务（懒加载）
  this._services = new Map();

  // Agent 组件
  this.intentClassifier = new IntentClassifier({
    confidenceThreshold: options.intentConfidenceThreshold || 0.6,
    useML: options.useMLIntent || false
  });

  this.conversationManager = new ConversationManager({
    maxHistoryLength: options.maxHistoryLength || 10,
    contextWindow: options.contextWindow || 5
  });

  this.userPreferenceManager = new UserPreferenceManager({
    projectRoot,
    enableLearning: options.enableLearning !== false
  });

  this.resultFusion = new ResultFusion({
    weights: options.fusionWeights || {
    relevance: 0.4,
    quality: 0.3,
    preference: 0.2,
    recency: 0.1
    }
  });

  this.feedbackStore = new Map();

  // 智能路由配置
  this.routingConfig = {
    search: {
    service: 'SearchServiceV2',
    fallback: 'ContextServiceV2',
    cache: true,
    aiEnhanced: true
    },
    context: {
    service: 'ContextServiceV2',
    fallback: null,
    cache: true,
    aiEnhanced: true
    },
    candidate: {
    service: 'CandidateServiceV2',
    fallback: null,
    cache: false,
    aiEnhanced: true
    },
    guard: {
    service: 'GuardServiceV2',
    fallback: null,
    cache: false,
    aiEnhanced: false
    },
    injection: {
    service: 'InjectionServiceV2',
    fallback: null,
    cache: false,
    aiEnhanced: false
    },
    // 新增的 AutoSnippet 特有意图
    recipe: {
    service: 'SearchServiceV2',  // Recipe 搜索使用 SearchServiceV2
    fallback: 'ContextServiceV2',
    cache: true,
    aiEnhanced: true,
    defaultFilter: { type: 'recipe' }  // 默认过滤 recipe 类型
    },
    snippet: {
    service: 'SearchServiceV2',
    fallback: null,
    cache: true,
    aiEnhanced: true,
    defaultFilter: { type: 'snippet' }
    }
  };

  // 缓存层
  this.cache = new Map();
  this.cacheMaxSize = options.cacheMaxSize || 100;
  this.cacheTTL = options.cacheTTL || 5 * 60 * 1000; // 5分钟

  // 统计数据
  this.stats = {
    totalRequests: 0,
    intentClassificationCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    aiEnhancedRequests: 0,
    fallbackCount: 0,
    avgResponseTime: 0
  };
  }

  /**
   * 懒加载服务
   */
  _getService(serviceName) {
  if (!this._services.has(serviceName)) {
    // eslint-disable-next-line global-require
    const ServiceClass = require(`./${serviceName}`);
    const service = new ServiceClass(this.projectRoot);
    this._services.set(serviceName, service);
  }
  return this._services.get(serviceName);
  }

  /**
   * 智能搜索 - 主入口
   * @param {string} query - 用户查询
   * @param {Object} options - 选项
   * @param {string} options.sessionId - 会话ID
   * @param {string} options.userId - 用户ID
   * @param {Object} options.context - 额外上下文
   * @returns {Promise<Object>} 增强的搜索结果
   */
  async intelligentSearch(query, options = {}) {
  // 调用链路（智能层）:
  // IntelligentServiceLayer.intelligentSearch -> _routeRequest -> SearchServiceV2.search
  const startTime = Date.now();
  this.stats.totalRequests++;

  try {
    // 1. 意图分类
    const intent = await this._classifyIntent(query, options.context);
    this.stats.intentClassificationCount++;

    // 2. 获取会话上下文
    const sessionContext = this._getSessionContext(options.sessionId);

    // 3. 检查缓存
    const cacheKey = this._generateCacheKey(query, intent, options);
    const cached = this._getFromCache(cacheKey);
    if (cached) {
    this.stats.cacheHits++;
    return {
      ...cached,
      fromCache: true,
      responseTime: Date.now() - startTime
    };
    }
    this.stats.cacheMisses++;

    // 4. 路由到合适的服务
    const results = await this._routeRequest(intent, query, {
    ...options,
    sessionContext
    });

    // 5. AI 增强（如果启用）
    const enhanced = await this._enhanceResults(results, {
    intent,
    query,
    sessionContext,
    userId: options.userId,
    context: options.context
    });

    // 6. 更新会话上下文
    this._updateSessionContext(options.sessionId, {
    query,
    intent,
    results: enhanced
    });

    // 7. 学习用户偏好
    if (options.userId) {
    this.userPreferenceManager.recordInteraction(options.userId, {
      query,
      intent,
      results: enhanced,
      timestamp: Date.now()
    });
    }

    // 8. 缓存结果
    this._setCache(cacheKey, enhanced);

    const responseTime = Date.now() - startTime;
    this.stats.avgResponseTime = (this.stats.avgResponseTime * (this.stats.totalRequests - 1) + responseTime) / this.stats.totalRequests;

    return {
    ...enhanced,
    intent,
    fromCache: false,
    responseTime
    };
  } catch (error) {
    console.error('IntelligentServiceLayer error:', error);
    throw error;
  }
  }

  /**
   * 意图分类
   */
  async _classifyIntent(query, context = {}) {
  const result = this.intentClassifier.classify(query, context);
  return result.intent;
  }

  /**
   * 智能路由
   */
  async _routeRequest(intent, query, options = {}) {
  // 根据意图映射到服务类型
  const serviceType = this._intentToServiceType(intent);
  const routeConfig = this.routingConfig[serviceType];

  if (!routeConfig) {
    throw new Error(`Unknown service type: ${serviceType}`);
  }

  try {
    const service = this._getService(routeConfig.service);
    
    // 合并默认过滤器（如果有）
    const mergedFilter = routeConfig.defaultFilter 
    ? { ...routeConfig.defaultFilter, ...options.filter }
    : options.filter;
    
    // 调用对应的服务方法
    let results;
    if (serviceType === 'search' || serviceType === 'recipe' || serviceType === 'snippet') {
    if (process.env.ASD_DEBUG_SEARCH_CHAIN === '1') {
      console.log('[CHAIN] Intelligent->SearchServiceV2', {
      intent,
      serviceType,
      mode: options.mode,
      semantic: options.semantic,
      ranking: options.ranking,
      fineRanking: options.fineRanking
      });
    }
    results = await service.search(query, {
      limit: options.limit || 10,
      filter: mergedFilter,
      mode: options.mode || 'semantic',
      semantic: options.semantic,
      ranking: options.ranking,
      fineRanking: options.fineRanking,
      context: options.context,
      sessionId: options.sessionId,
      userId: options.userId
    });
    } else if (serviceType === 'context') {
    results = await service.search(query, {
      limit: options.limit || 5,
      filter: mergedFilter,
      includeContent: options.includeContent !== false
    });
    } else if (serviceType === 'candidate') {
    results = await service.getCandidates(query, {
      language: options.language,
      context: options.context
    });
    }

    return {
    serviceType,
    serviceName: routeConfig.service,
    results: results || []
    };
  } catch (error) {
    // 回退策略
    if (routeConfig.fallback) {
    this.stats.fallbackCount++;
    const fallbackService = this._getService(routeConfig.fallback);
    const results = await fallbackService.search(query, options);
    return {
      serviceType,
      serviceName: routeConfig.fallback,
      results: results || [],
      fallback: true
    };
    }
    throw error;
  }
  }

  /**
   * 结果增强
   */
  async _enhanceResults(serviceResults, context) {
  const { intent, query, sessionContext, userId } = context;
  const { results, serviceType, serviceName } = serviceResults;

  if (!results || results.length === 0) {
    return serviceResults;
  }

  const routeConfig = this.routingConfig[serviceType];
  if (!routeConfig.aiEnhanced) {
    return serviceResults;
  }

  this.stats.aiEnhancedRequests++;

  const explainEnabled = process.env.ASD_SEARCH_EXPLAIN !== '0';
  const groupEnabled = process.env.ASD_SEARCH_GROUP !== '0';
  const feedbackEnabled = process.env.ASD_SEARCH_FEEDBACK !== '0';
  const demandEnabled = process.env.ASD_SEARCH_DEMAND !== '0';
  const demandType = demandEnabled ? this._inferDemandType(query, context) : null;

  try {
    // 1. 获取用户偏好
    let userPreference = null;
    if (userId) {
    userPreference = await this.userPreferenceManager.getUserPreference(userId);
    }

    // 2. 结果重排序
    const reranked = await this._rerankResults(results, {
    query,
    intent,
    userPreference,
    sessionContext,
    userId,
    demandType,
    feedbackEnabled
    });

    // 3. 质量评分
    const scored = reranked.map(item => ({
    ...item,
    qualityScore: this._calculateQualityScore(item, context)
    }));

    // 4. 个性化调整
    const personalized = userPreference 
    ? this._personalizeResults(scored, userPreference)
    : scored;

    let enhancedResults = personalized;

    if (explainEnabled) {
    enhancedResults = enhancedResults.map(item => ({
      ...item,
      explanation: this._buildRecommendationReason(item, {
      intent,
      demandType,
      context
      })
    }));
    }

    if (groupEnabled) {
    enhancedResults = this._groupSimilarResults(enhancedResults);
    }

    return {
    ...serviceResults,
    results: enhancedResults,
    enhanced: true,
    enhancements: {
      reranked: true,
      scored: true,
      personalized: !!userPreference,
      explained: explainEnabled,
      grouped: groupEnabled,
      demandType: demandType || undefined
    }
    };
  } catch (error) {
    console.error('Result enhancement error:', error);
    // 增强失败时返回原始结果
    return serviceResults;
  }
  }

  /**
   * 结果重排序
   */
  async _rerankResults(results, context) {
  const { query, intent, userPreference, sessionContext, userId, demandType, feedbackEnabled } = context;

  // 计算每个结果的综合分数
  const scoredResults = results.map(item => {
    const scores = {
    relevance: item.similarity || 0,
    quality: this._calculateQualityScore(item, context),
    preference: userPreference ? this._calculatePreferenceScore(item, userPreference) : 0.5,
    recency: this._calculateRecencyScore(item),
    intentMatch: demandType ? this._calculateIntentMatchScore(item, demandType) : 0,
    feedback: feedbackEnabled ? this._calculateFeedbackScore(item, userId) : 1
    };

    // 使用 ResultFusion 的权重计算最终分数
    const finalScore = this.resultFusion.fuseScores(scores);

    return {
    ...item,
    _scores: scores,
    _finalScore: finalScore
    };
  });

  // 按最终分数排序
  scoredResults.sort((a, b) => b._finalScore - a._finalScore);

  return scoredResults;
  }

  /**
   * 质量评分
   */
  _calculateQualityScore(item, context) {
  let score = 0.5;

  // 基于内容长度
  if (item.content) {
    const length = item.content.length;
    if (length > 100 && length < 5000) {
    score += 0.2;
    }
  }

  // 基于元数据完整性
  if (item.metadata) {
    const metadataFields = Object.keys(item.metadata).length;
    score += Math.min(metadataFields * 0.05, 0.2);
  }

  // 基于代码块存在
  if (item.content && item.content.includes('```')) {
    score += 0.1;
  }

  return Math.min(score, 1.0);
  }

  /**
   * 个性化评分
   */
  _calculatePreferenceScore(item, userPreference) {
  if (!userPreference || !userPreference.preferences) {
    return 0.5;
  }

  let score = 0.5;

  // 基于语言偏好
  if (item.metadata?.language && userPreference.preferences.languages) {
    const langPreference = userPreference.preferences.languages[item.metadata.language];
    if (langPreference) {
    score += langPreference * 0.3;
    }
  }

  // 基于主题偏好
  if (item.metadata?.topics && userPreference.preferences.topics) {
    const topicScores = item.metadata.topics.map(topic => 
    userPreference.preferences.topics[topic] || 0
    );
    if (topicScores.length > 0) {
    const avgTopicScore = topicScores.reduce((a, b) => a + b, 0) / topicScores.length;
    score += avgTopicScore * 0.2;
    }
  }

  return Math.min(score, 1.0);
  }

  /**
   * 时效性评分
   */
  _calculateRecencyScore(item) {
  if (!item.metadata?.updatedAt && !item.updatedAt) {
    return 0.5;
  }

  const timestamp = item.metadata?.updatedAt || item.updatedAt;
  const ageInDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);

  if (ageInDays < 7) return 1.0;
  if (ageInDays < 30) return 0.8;
  if (ageInDays < 90) return 0.6;
  if (ageInDays < 180) return 0.4;
  return 0.2;
  }

  /**
   * 个性化结果
   */
  _personalizeResults(results, userPreference) {
  // 基于用户历史行为调整结果
  return results.map(item => {
    const personalizedScore = this._calculatePreferenceScore(item, userPreference);
    return {
    ...item,
    personalizedScore,
    // 将个性化分数融入最终分数
    similarity: (item.similarity || 0) * 0.7 + personalizedScore * 0.3
    };
  });
  }

  /**
   * 意图到服务类型的映射
   */
  _intentToServiceType(intent) {
  const mapping = {
    // 基础意图
    search: 'search',
    find: 'search',
    query: 'search',
    context: 'context',
    embed: 'context',
    index: 'context',
    candidate: 'candidate',
    generate: 'candidate',
    suggest: 'candidate',
    guard: 'guard',
    lint: 'guard',
    validate: 'guard',
    inject: 'injection',
    insert: 'injection',
    
    // AutoSnippet 特有意图
    recipe: 'recipe',
    snippet: 'snippet',
    learn: 'search',      // 学习意图映射到搜索
    analyze: 'search',    // 分析意图映射到搜索
    help: 'search'        // 帮助意图映射到搜索
  };

  return mapping[intent] || 'search';
  }

  /**
   * 会话上下文管理
   */
  _getSessionContext(sessionId) {
  if (!sessionId) return null;
  const conversation = this.conversationManager.getOrCreateConversation(sessionId);
  return {
    history: conversation.turns || [],
    currentTopic: conversation.currentTopic,
    context: conversation.context || {}
  };
  }

  _updateSessionContext(sessionId, data) {
  if (!sessionId) return;
  const conversation = this.conversationManager.getOrCreateConversation(sessionId);
  
  // 添加到对话历史
  conversation.turns.push({
    query: data.query,
    intent: data.intent,
    results: data.results,
    timestamp: Date.now()
  });
  
  // 限制历史长度
  const maxHistory = this.options.maxHistoryLength || 10;
  if (conversation.turns.length > maxHistory) {
    conversation.turns = conversation.turns.slice(-maxHistory);
  }
  }

  /**
   * 记录搜索反馈
   */
  recordSearchFeedback({ userId, item, query, positive = true, intent, demandType } = {}) {
  if (!userId || !item) return;
  const key = `${userId}:${this._getItemKey(item)}`;
  const current = this.feedbackStore.get(key) || { positive: 0, negative: 0 };
  if (positive) current.positive += 1;
  else current.negative += 1;
  this.feedbackStore.set(key, current);

  this.userPreferenceManager.recordInteraction(userId, {
    topic: intent || 'search',
    success: !!positive,
    quality: item.qualityScore || item.similarity || 0.5,
    query,
    demandType
  });
  }

  _getItemKey(item) {
  const title = (item.title || item.name || '').replace(/^\(\d+%\)\s*/, '').trim();
  const trigger = item.trigger || '';
  const name = item.name || '';
  return `${trigger}|${name}|${title}`.toLowerCase();
  }

  _calculateFeedbackScore(item, userId) {
  if (!userId) return 1;
  const key = `${userId}:${this._getItemKey(item)}`;
  const fb = this.feedbackStore.get(key);
  if (!fb) return 1;
  const penalty = Math.min(fb.negative * 0.15, 0.6);
  const bonus = Math.min(fb.positive * 0.05, 0.2);
  return Math.max(0, 1 - penalty + bonus);
  }

  _inferDemandType(query, context) {
  const q = String(query || '').toLowerCase();
  const structured = context?.context?.structured || context?.structured || {};
  const tokens = [
    q,
    ...(structured.imports || []),
    ...(structured.types || []),
    ...(structured.functions || []),
    ...(structured.variables || [])
  ].join(' ').toLowerCase();

  const buckets = {
    ui: [/\bui\b/, /view/, /button/, /layout/, /color/, /uikit/, /swiftui/, /autolayout/],
    network: [/http/, /request/, /api/, /urlsession/, /afnetwork/, /alamofire/, /network/],
    storage: [/cache/, /db/, /database/, /sqlite/, /coredata/, /file/, /disk/, /storage/],
    permission: [/permission/, /privacy/, /camera/, /photo/, /contacts/, /location/, /microphone/],
    analytics: [/analytics/, /track/, /event/, /log/, /logging/],
    notification: [/notification/, /push/, /unusernotification/, /apns/]
  };

  const scores = Object.entries(buckets).map(([k, patterns]) => ({
    key: k,
    score: patterns.reduce((sum, p) => sum + (p.test(tokens) ? 1 : 0), 0)
  }));

  scores.sort((a, b) => b.score - a.score);
  if (scores[0]?.score > 0) return scores[0].key;
  return null;
  }

  _calculateIntentMatchScore(item, demandType) {
  if (!demandType) return 0;
  const text = `${item.title || ''} ${item.name || ''} ${item.trigger || ''} ${item.content || ''}`.toLowerCase();
  return text.includes(demandType) ? 1 : 0.4;
  }

  _buildRecommendationReason(item, { intent, demandType, context }) {
  const parts = [];
  if (demandType) parts.push(`需求:${demandType}`);
  if (intent) parts.push(`意图:${intent}`);
  if (context?.context?.language) parts.push(`语言:${context.context.language}`);
  if (item.trigger) parts.push(`触发:${item.trigger}`);
  if (item.groupSize && item.groupSize > 1) parts.push(`同类:${item.groupSize}`);
  return parts.join(' · ');
  }

  _groupSimilarResults(results) {
  const map = new Map();
  const normalized = (item) => {
    const title = (item.title || item.name || '').replace(/^\(\d+%\)\s*/, '').trim().toLowerCase();
    const trigger = (item.trigger || '').toLowerCase();
    return trigger || title;
  };

  results.forEach((item) => {
    const key = normalized(item);
    if (!map.has(key)) {
    map.set(key, { primary: item, items: [item] });
    } else {
    map.get(key).items.push(item);
    }
  });

  const grouped = [];
  for (const { primary, items } of map.values()) {
    const best = items.sort((a, b) => (b._finalScore || b.similarity || 0) - (a._finalScore || a.similarity || 0))[0];
    grouped.push({
    ...best,
    groupSize: items.length,
    alternatives: items.slice(0, 3).map(i => i.title || i.name).filter(Boolean)
    });
  }

  return grouped;
  }

  /**
   * 缓存管理
   */
  _generateCacheKey(query, intent, options) {
  const keyParts = [
    query.toLowerCase(),
    intent,
    options.filter ? JSON.stringify(options.filter) : '',
    options.limit || ''
  ];
  return keyParts.join('|');
  }

  _getFromCache(key) {
  const cached = this.cache.get(key);
  if (!cached) return null;

  // 检查是否过期
  if (Date.now() - cached.timestamp > this.cacheTTL) {
    this.cache.delete(key);
    return null;
  }

  return cached.data;
  }

  _setCache(key, data) {
  // 限制缓存大小
  if (this.cache.size >= this.cacheMaxSize) {
    // 删除最旧的条目
    const firstKey = this.cache.keys().next().value;
    this.cache.delete(firstKey);
  }

  this.cache.set(key, {
    data,
    timestamp: Date.now()
  });
  }

  /**
   * 获取统计数据
   */
  getStats() {
  return {
    ...this.stats,
    cacheSize: this.cache.size,
    servicesLoaded: this._services.size
  };
  }

  /**
   * 清理资源
   */
  async cleanup() {
  this.cache.clear();
  this._services.clear();
  
  // 保存用户偏好（如果有 save 方法）
  if (this.userPreferenceManager && typeof this.userPreferenceManager.save === 'function') {
    await this.userPreferenceManager.save();
  }
  }
}

module.exports = IntelligentServiceLayer;
