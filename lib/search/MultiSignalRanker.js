/**
 * MultiSignalRanker - 多信号排序算法
 * 
 * 实现六信号加权融合排序：
 * 1. 相关性 (Relevance): 语义相似度 + BM25 关键词匹配
 * 2. 权威性 (Authority): 作者评分、审核状态、质量指标
 * 3. 新鲜度 (Recency): 最近修改时间
 * 4. 使用热度 (Popularity): 使用统计
 * 5. 难度匹配 (Difficulty): 与查询难度的匹配度
 * 6. 时间匹配 (Seasonality): 时间相关性
 */

const kbConfig = require('../../config/knowledge-base.config');

class MultiSignalRanker {
  constructor(options = {}) {
  this.config = kbConfig.retrieval.weights || {};
  this.scenarios = options.scenarios || {};
  this.signals = {
    relevance: new RelevanceSignal(),
    authority: new AuthoritySignal(),
    recency: new RecencySignal(),
    popularity: new PopularitySignal(),
    difficulty: new DifficultySignal(),
    seasonality: new SeasonalitySignal()
  };
  }
  
  /**
   * 对候选列表进行多信号排序
   * @param {Array} candidates - 候选 Recipe 列表（包含初始相关性分数）
   * @param {Object} context - 排序上下文
   * @returns {Array} 排序后的结果
   */
  rank(candidates, context = {}) {
  const {
    scenario = 'search',
    userProfile = {},
    conversationHistory = [],
    query = '',
    knowledgeGraph = null
  } = context;
  
  // 获取场景权重
  const weights = this.getScenarioWeights(scenario);
  
  // 为每个候选计算各信号的分数
  const scoredCandidates = candidates.map(candidate => {
    const scores = {
    relevance: this.signals.relevance.compute(candidate, query, context),
    authority: this.signals.authority.compute(candidate, userProfile, context),
    recency: this.signals.recency.compute(candidate, context),
    popularity: this.signals.popularity.compute(candidate, context),
    difficulty: this.signals.difficulty.compute(candidate, query, context),
    seasonality: this.signals.seasonality.compute(candidate, context)
    };
    
    // 计算加权总分
    let totalScore = 0;
    for (const [signal, weight] of Object.entries(weights)) {
    totalScore += (scores[signal] || 0) * weight;
    }
    
    return {
    ...candidate,
    scores,
    totalScore,
    signalBreakdown: this.createBreakdown(scores, weights)
    };
  });
  
  // 排序
  scoredCandidates.sort((a, b) => b.totalScore - a.totalScore);
  
  // 应用依赖关系重排（如果有知识图谱）
  if (knowledgeGraph) {
    return this.reorderByDependencies(scoredCandidates, knowledgeGraph);
  }
  
  return scoredCandidates;
  }
  
  /**
   * 获取场景权重
   * @param {string} scenario - 场景名称
   * @returns {Object} 权重对象
   */
  getScenarioWeights(scenario) {
  // 默认权重（搜索场景）
  const defaultWeights = {
    relevance: 0.35,
    authority: 0.20,
    recency: 0.15,
    popularity: 0.15,
    difficulty: 0.10,
    seasonality: 0.05
  };
  
  // 场景特定权重
  const scenarioWeights = {
    // Lint: 精确匹配优先，权威来源优先
    lint: {
    relevance: 0.40,
    authority: 0.30,
    recency: 0.10,
    popularity: 0.10,
    difficulty: 0.05,
    seasonality: 0.05
    },
    
    // 生成：流行的、最新的实践
    generate: {
    relevance: 0.35,
    authority: 0.15,
    recency: 0.15,
    popularity: 0.20,
    difficulty: 0.10,
    seasonality: 0.05
    },
    
    // 搜索：均衡考虑
    search: {
    relevance: 0.30,
    authority: 0.25,
    recency: 0.15,
    popularity: 0.15,
    difficulty: 0.10,
    seasonality: 0.05
    },
    
    // 学习：循序渐进
    learning: {
    relevance: 0.25,
    authority: 0.20,
    recency: 0.10,
    popularity: 0.10,
    difficulty: 0.30,  // 优先简单的
    seasonality: 0.05
    }
  };
  
  return scenarioWeights[scenario] || defaultWeights;
  }
  
  /**
   * 基于依赖关系重排
   */
  reorderByDependencies(candidates, knowledgeGraph) {
  // 检测如果 A 依赖 B，则 B 应该排在 A 前面
  const reordered = [...candidates];
  
  for (let i = 0; i < reordered.length; i++) {
    for (let j = i + 1; j < reordered.length; j++) {
    const recipeA = reordered[i];
    const recipeB = reordered[j];
    
    // 检查 A 是否依赖 B
    const deps = knowledgeGraph.getDependencies(recipeA.id, { depth: 1 });
    if (deps.some(d => d.id === recipeB.id)) {
      // B 应该在 A 前面
      [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    }
    }
  }
  
  return reordered;
  }
  
  /**
   * 创建分数分解说明
   */
  createBreakdown(scores, weights) {
  const breakdown = {};
  for (const [signal, score] of Object.entries(scores)) {
    breakdown[signal] = {
    score: parseFloat(score.toFixed(3)),
    weight: parseFloat(weights[signal].toFixed(3)),
    weighted: parseFloat((score * weights[signal]).toFixed(3))
    };
  }
  return breakdown;
  }
}

/**
 * 相关性信号：语义相似度 + BM25 关键词匹配
 */
class RelevanceSignal {
  compute(candidate, query, context) {
  if (!query) return candidate.semanticScore || 0.5;
  
  // 语义相似度（来自向量搜索）
  const semanticSimilarity = candidate.semanticScore || 0.5;
  
  // BM25 关键词匹配
  const bm25Score = this.computeBM25(query, candidate);
  
  // 融合：语义 50%，BM25 50%
  return 0.5 * semanticSimilarity + 0.5 * bm25Score;
  }
  
  /**
   * 简化的 BM25 计算
   */
  computeBM25(query, document, k1 = 1.5, b = 0.75) {
  const queryTerms = query.toLowerCase().split(/\s+/);
  const docTerms = [
    ...document.title?.toLowerCase().split(/\s+/) || [],
    ...(document.keywords || []).slice(0, 5).map(k => k.toLowerCase())
  ];
  
  const docLength = docTerms.length;
  const avgDocLength = 50; // 假设平均 Recipe 文档长度
  
  let score = 0;
  
  for (const term of queryTerms) {
    // 计算词频
    const termFreq = docTerms.filter(t => t.includes(term)).length;
    
    // 计算 IDF（简化）
    const idf = Math.log(1 + (1 / (docTerms.filter(t => t.includes(term)).length + 1)));
    
    // BM25 公式
    const numerator = termFreq * (k1 + 1);
    const denominator = termFreq + k1 * (1 - b + b * (docLength / avgDocLength));
    
    score += idf * (numerator / denominator);
  }
  
  // 归一化到 0-1
  return Math.min(score / (queryTerms.length * 3), 1);
  }
}

/**
 * 权威性信号：质量评分、作者声望、审核状态
 */
class AuthoritySignal {
  compute(candidate, userProfile, context) {
  let score = 0;
  
  // 1. 质量评分（0-5 -> 0-1）
  if (candidate.quality) {
    const authorityScore = (candidate.quality.authorityScore || 3) / 5;
    score += authorityScore * 0.5;
  }
  
  // 2. 测试覆盖率
  if (candidate.quality?.testCoverage) {
    score += Math.min(candidate.quality.testCoverage * 0.3, 0.3);
  }
  
  // 3. 安全审计
  if (candidate.quality?.securityAudit === 'pass') {
    score += 0.2;
  }
  
  return Math.min(score, 1);
  }
}

/**
 * 新鲜度信号：基于最近修改时间的指数衰减
 */
class RecencySignal {
  compute(candidate, context) {
  const now = Date.now();
  const lastModified = new Date(candidate.lastModified || candidate.createdAt).getTime();
  
  const daysSinceUpdate = (now - lastModified) / (24 * 60 * 60 * 1000);
  
  // 指数衰减：90 天为半衰期
  const halfLife = 90;
  const decayFactor = Math.pow(0.5, daysSinceUpdate / halfLife);
  
  return Math.max(decayFactor, 0.1);  // 最低 10% 的分数
  }
}

/**
 * 使用热度信号：基于使用统计
 */
class PopularitySignal {
  compute(candidate, context) {
  if (!candidate.stats) return 0.5;
  
  const {
    guardUsageCount = 0,
    humanUsageCount = 0,
    aiUsageCount = 0,
    usageHeat = 0.5
  } = candidate.stats;
  
  // 直接使用预计算的 usageHeat
  if (usageHeat) {
    return usageHeat;
  }
  
  // 或计算热度：tanh(总使用次数 / 100)
  const totalUsage = (guardUsageCount || 0) + (humanUsageCount || 0) + (aiUsageCount || 0);
  return Math.tanh(totalUsage / 100);
  }
}

/**
 * 难度匹配信号：推断查询难度并与 Recipe 难度匹配
 */
class DifficultySignal {
  compute(candidate, query, context) {
  // 推断查询难度（0-5）
  const queryDifficulty = this.inferQueryDifficulty(query);
  
  // 获取 Recipe 难度
  const recipeDifficulty = candidate.difficulty || 2.5;
  
  // 计算匹配度：差异越小，分数越高
  const difference = Math.abs(queryDifficulty - recipeDifficulty);
  
  // 使用反向距离函数
  return Math.max(1 - (difference / 5), 0);
  }
  
  /**
   * 推断查询难度
   */
  inferQueryDifficulty(query) {
  if (!query) return 2.5;  // 中等难度
  
  const easyKeywords = ['basic', 'simple', 'beginner', 'intro', 'hello', 'quick'];
  const hardKeywords = ['advanced', 'complex', 'optimization', 'performance', 'architecture', 'pattern'];
  
  const queryLower = query.toLowerCase();
  
  let score = 2.5;  // 默认中等
  
  if (easyKeywords.some(k => queryLower.includes(k))) {
    score = 1.5;
  } else if (hardKeywords.some(k => queryLower.includes(k))) {
    score = 4.0;
  }
  
  return score;
  }
}

/**
 * 时间匹配信号：季节性和时间相关性
 */
class SeasonalitySignal {
  compute(candidate, context) {
  // 简化版本：根据类别返回固定的季节性加权
  const seasonalBoosts = {
    'async-patterns': 0.9,  // 始终相关
    'error-handling': 0.85,
    'testing': 0.8,
    'performance': 0.7,
    'deprecated': 0.1
  };
  
  const category = candidate.category || 'default';
  return seasonalBoosts[category] || 0.5;
  }
}

/**
 * 四层检索漏斗整合器
 */
class RetrievalFunnel {
  constructor(options = {}) {
  this.ranker = new MultiSignalRanker(options);
  this.config = kbConfig.retrieval.layers || [];
  this.topK = kbConfig.retrieval.topK || {};
  }
  
  /**
   * 执行四层检索漏斗
   * @param {string} query - 查询文本
   * @param {Object} candidates - 各层候选
   * @returns {Array} 最终排序的结果
   */
  execute(query, candidates, context = {}) {
  console.log(`[RetrievalFunnel] 开始四层检索漏斗...`);
  
  let results = candidates;
  const topK = this.topK;
  
  // Layer 1: Keyword Filter
  console.log(`  Layer 1: Keyword Filter (topK=${topK.keyword})`);
  results = this.keywordFilter(query, results);
  results = results.slice(0, topK.keyword);
  console.log(`  -> ${results.length} 个候选通过关键词筛选`);
  
  // Layer 2: Semantic Search
  console.log(`  Layer 2: Semantic Search (topK=${topK.semantic})`);
  results = this.semanticRerank(query, results, context);
  results = results.slice(0, topK.semantic);
  console.log(`  -> ${results.length} 个候选通过语义搜索`);
  
  // Layer 3: Multi-Signal Ranking
  console.log(`  Layer 3: Multi-Signal Ranking (topK=${topK.fusion})`);
  results = this.ranker.rank(results, { 
    ...context, 
    scenario: context.scenario || 'search',
    query 
  });
  results = results.slice(0, topK.fusion);
  console.log(`  -> ${results.length} 个候选经过多信号融合`);
  
  // Layer 4: Context-Aware Reranking
  console.log(`  Layer 4: Context-Aware Reranking (topK=${topK.final})`);
  results = this.contextAwareRerank(results, context);
  results = results.slice(0, topK.final);
  console.log(`  -> ${results.length} 个最终候选`);
  
  return results;
  }
  
  /**
   * Layer 1: 关键词筛选
   */
  keywordFilter(query, candidates) {
  const queryTerms = query.toLowerCase().split(/\s+/);
  
  return candidates.filter(candidate => {
    const titleMatch = queryTerms.some(term => 
    candidate.title?.toLowerCase().includes(term)
    );
    const keywordMatch = queryTerms.some(term => 
    candidate.keywords?.some(k => k.toLowerCase().includes(term))
    );
    
    return titleMatch || keywordMatch;
  });
  }
  
  /**
   * Layer 2: 语义重排
   */
  semanticRerank(query, candidates, context) {
  // 计算查询和每个候选的语义相似度
  // 这里使用简化版本，实际应该使用向量距离
  
  return candidates.map(candidate => ({
    ...candidate,
    semanticScore: this.computeSemanticSimilarity(query, candidate)
  })).sort((a, b) => b.semanticScore - a.semanticScore);
  }
  
  /**
   * 简化的语义相似度计算
   */
  computeSemanticSimilarity(query, document) {
  const queryTerms = new Set(query.toLowerCase().split(/\s+/));
  const docTerms = new Set([
    ...document.title?.toLowerCase().split(/\s+/) || [],
    ...(document.semanticTags || []).map(t => t.toLowerCase()),
    ...(document.keywords || []).map(k => k.toLowerCase())
  ]);
  
  const intersection = Array.from(queryTerms).filter(t => 
    Array.from(docTerms).some(d => d.includes(t))
  ).length;
  
  const union = queryTerms.size + docTerms.size - intersection;
  
  return union > 0 ? intersection / union : 0;
  }
  
  /**
   * Layer 4: 上下文感知重排
   */
  contextAwareRerank(candidates, context) {
  const {
    conversationHistory = [],
    userProfile = {},
    knowledgeGraph = null
  } = context;
  
  // 提升与对话历史相关的候选
  const reordered = candidates.map(candidate => {
    let boostFactor = 1.0;
    
    // 检查是否与最近使用的 Recipe 相关
    if (conversationHistory.length > 0) {
    const recentRecipeIds = conversationHistory
      .slice(-3)
      .flatMap(h => h.relatedRecipes || []);
    
    if (knowledgeGraph) {
      const deps = knowledgeGraph.getDependencies(candidate.id, { depth: 1 });
      if (deps.some(d => recentRecipeIds.includes(d.id))) {
      boostFactor *= 1.2;  // 提升 20%
      }
    }
    }
    
    return {
    ...candidate,
    totalScore: (candidate.totalScore || 0) * boostFactor
    };
  });
  
  return reordered.sort((a, b) => b.totalScore - a.totalScore);
  }
}

module.exports = {
  MultiSignalRanker,
  RetrievalFunnel,
  RelevanceSignal,
  AuthoritySignal,
  RecencySignal,
  PopularitySignal,
  DifficultySignal,
  SeasonalitySignal
};
