/**
 * SearchService V2 - 升级版本
 * 
 * 改进点：
 * - Class 设计，明确的职责划分
 * - 整合关键词、语义、排名三层搜索
 * - 支持缓存和查询优化
 * - 更好的错误处理和日志
 * - 配置驱动的功能开关
 * 
 * @class SearchServiceV2
 * @description 统一搜索服务，提供关键词、语义、排名搜索能力
 * 
 * @example
 * const service = new SearchServiceV2(projectRoot);
 * const results = await service.search('keyword', {
 *   semantic: true,
 *   ranking: true,
 *   cache: true,
 *   limit: 10
 * });
 */

const path = require('path');
const fs = require('fs');
const defaults = require('../../infrastructure/config/Defaults');
const Paths = require('../../infrastructure/config/Paths.js');
const { getTriggerFromContent } = require('../../recipe/parseRecipeMd');
const SearchCache = require('../../search/searchCache');
const { normalizeQuery } = require('../../search/queryOptimizer');
const { buildSearchIndex, searchIndex, hasIndex } = require('../../search/indexer');
const RankingEngine = require('../../search/rankingEngine');

/**
 * 智能分词函数：将长句子拆分成多个搜索词
 * @param {string} text - 输入文本
 * @returns {string[]} 关键词数组
 */
function tokenizeQuery(text) {
  if (!text) return [];
  
  const cleaned = text.trim();
  
  // 单个词直接返回
  if (cleaned.split(/\s+/).length === 1) {
  return [cleaned];
  }
  
  // 英文：按空格分割，过滤停用词
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'how', 'what', 'where', 'when']);
  const englishTokens = cleaned
  .toLowerCase()
  .split(/[\s\-_]+/)
  .filter(w => w.length > 1 && !stopWords.has(w));
  
  // 中文：简单按标点分割（更复杂的可以使用 jieba 等分词库）
  const chineseTokens = cleaned
  .split(/[，。！？、；：]/)
  .filter(w => w.trim().length > 0);
  
  // 合并去重
  const tokens = [...new Set([...englishTokens, ...chineseTokens])];
  
  return tokens.length > 0 ? tokens : [cleaned];
}

/**
 * 判断是否包含中文
 * @param {string} text
 * @returns {boolean}
 */
function containsChinese(text) {
  return /[\u4e00-\u9fff]/.test(text || '');
}
const FENCED_CODE_RE = /```[\w]*\r?\n([\s\S]*?)```/;

/**
 * SearchService V2 - 统一搜索服务
 * 
 * 职责：
 * - 提供关键词搜索
 * - 提供语义搜索（需要 embed 索引）
 * - 整合搜索排名引擎
 * - 管理搜索缓存
 * - 支持查询优化
 * 
 * 使用示例：
 * ```javascript
 * const service = new SearchServiceV2(projectRoot);
 * const results = await service.search('keyword', {
 *   semantic: true,
 *   ranking: true,
 *   cache: true,
 *   limit: 10
 * });
 * ```
 */
class SearchServiceV2 {
  constructor(projectRoot, config = {}) {
  this._validateProjectRoot(projectRoot);
  
  this.projectRoot = projectRoot;
  this.config = this._parseConfig(config);
  this.cache = new SearchCache({ max: 200, ttlMs: 5 * 60 * 1000 });
  this.logger = this._createLogger();
  
  // 智能层（可选，通过配置启用）
  this.intelligentLayer = null;
  if (config.enableIntelligentLayer) {
    try {
    // 懒加载 IntelligentServiceLayer
    const IntelligentServiceLayer = require('./IntelligentServiceLayer');
    this.intelligentLayer = new IntelligentServiceLayer(projectRoot, {
      ...config.intelligentLayerOptions,
      enableLearning: config.enableLearning !== false
    });
    this.logger.log('✓ 智能服务层已启用');
    } catch (error) {
    this.logger.log('智能服务层加载失败:', error.message);
    }
  }
  }

  // ============ Public API ============

  /**
   * 统一搜索接口
   * 
   * @param {string} keyword - 搜索关键词
   * @param {Object} options - 搜索选项
   *   @param {boolean} options.semantic - 是否使用语义搜索 (默认 false)
   *   @param {number} options.limit - 返回结果数量上限 (默认 10)
   *   @param {Object} options.filter - 过滤条件
   *   @param {boolean} options.ranking - 是否启用排名 (默认由 env var 决定)
   *   @param {Object} options.weights - 排名权重配置
   *   @param {boolean} options.fineRanking - 是否启用细粒度排名 (默认由 env var 决定)
   *   @param {Object} options.context - 排名上下文
   *   @param {boolean} options.cache - 是否使用缓存 (默认由 env var 决定)
   *   @param {boolean} options.optimizeQuery - 是否优化查询 (默认由 env var 决定)
   *   @param {boolean} options.useIndex - 是否使用倒排索引 (默认由 env var 决定)
   *   @param {boolean} options.rebuildIndex - 是否重建索引 (默认由 env var 决定)
   * 
   * @returns {Promise<Object[]>} 搜索结果
   */
  async search(keyword, options = {}) {
  try {
    // 调用链路（搜索入口）:
    // SearchServiceV2.search -> _mergeOptions -> _rankingSearch/_semanticSearch/_keywordSearch
    // -> _searchRecipes/_searchSnippets
    if (process.env.ASD_DEBUG === '1') {
    console.log('[CHAIN] SearchServiceV2.search', {
      keyword: String(keyword || '').slice(0, 80),
      mode: options.mode,
      semantic: options.semantic,
      ranking: options.ranking,
      fineRanking: options.fineRanking,
      sessionId: options.sessionId,
      userId: options.userId
    });
    }
    // 如果启用了智能层且提供了 sessionId 或 userId，使用智能搜索
    if (this.intelligentLayer && (options.sessionId || options.userId)) {
    this.logger.log('使用智能服务层');
    const result = await this.intelligentLayer.intelligentSearch(keyword, {
      ...options,
      limit: options.limit || 10
    });
    // 返回兼容格式
    return result.results || [];
    }

    // 合并配置：参数 > 环境变量 > 默认值
    const config = this._mergeOptions(options);

    // 查询优化
    const query = config.optimizeQuery ? normalizeQuery(keyword) : keyword;

    // 缓存查询
    if (config.cache) {
    const cached = this._getCached(query, config);
    if (cached) {
      this.logger.log('缓存命中', { query });
      return cached;
    }
    }

    // 执行搜索
    let results;
    if (config.ranking) {
    results = await this._rankingSearch(query, config);
    } else if (config.semantic) {
    results = await this._semanticSearch(query, config);
    } else {
    results = await this._keywordSearch(query);
    }

    // 为 keyword 和 semantic 模式应用 limit 截取（ranking 模式在 RankingEngine 中已经处理）
    if (!config.ranking && config.limit && results.length > config.limit) {
    results = results.slice(0, config.limit);
    }

    // 缓存结果
    if (config.cache && query) {
    this._setCached(query, config, results);
    }

    return results;
  } catch (e) {
    this.logger.error('搜索失败', { keyword, error: e.message });
    return [];
  }
  }

  /**
   * 关键词搜索（不依赖 embedding）
   * 
   * @param {string} keyword - 搜索关键词
   * @returns {Promise<Object[]>} 搜索结果
   */
  async keywordSearch(keyword) {
  return await this._keywordSearch(keyword);
  }

  /**
   * 语义搜索（需要 embed 索引）
   * 
   * @param {string} keyword - 搜索关键词
   * @param {Object} options - 搜索选项 { limit, filter }
   * @returns {Promise<Object[]>} 搜索结果
   */
  async semanticSearch(keyword, options = {}) {
  return this._semanticSearch(keyword, {
    limit: options.limit || 5,
    filter: options.filter || {}
  });
  }

  /**
   * 清空搜索缓存
   * 
   * @returns {void}
   */
  clearCache() {
  this.cache.clear();
  this.logger.log('缓存已清空');
  }

  /**
   * 获取缓存统计
   * 
   * @returns {Object} 缓存统计信息
   */
  getCacheStats() {
  return {
    cacheSize: this.cache.cache.size,
    maxSize: this.cache.max,
    ttlMs: this.cache.ttlMs
  };
  }

  // ============ Private Methods ============

  /**
   * 验证项目根目录
   * @private
   */
  _validateProjectRoot(projectRoot) {
  if (!projectRoot || typeof projectRoot !== 'string') {
    throw new Error('projectRoot 必须是非空字符串');
  }
  }

  /**
   * 解析初始配置
   * @private
   */
  _parseConfig(config) {
  return {
    enableRanking: config.enableRanking !== false,
    enableFineRanking: config.enableFineRanking !== false,
    enableCache: config.enableCache !== false,
    enableOptimize: config.enableOptimize !== false,
    enableIndex: config.enableIndex !== false,
    weights: config.weights || {}
  };
  }

  /**
   * 合并选项：参数 > 环境变量 > 默认值
   * @private
   */
  _mergeOptions(options) {
  const hasSemantic = typeof options.semantic === 'boolean';
  const hasRanking = typeof options.ranking === 'boolean';
  const mode = String(options.mode || '').toLowerCase();

  let semantic = hasSemantic ? options.semantic : false;
  let ranking = hasRanking
    ? options.ranking
    : (process.env.ASD_SEARCH_RANKING === '1' || this.config.enableRanking);

  if (mode === 'semantic') {
    if (!hasSemantic) semantic = true;
    if (!hasRanking) ranking = false;
  } else if (mode === 'keyword') {
    if (!hasSemantic) semantic = false;
    if (!hasRanking) ranking = false;
  } else if (mode === 'ranking') {
    if (!hasRanking) ranking = true;
  }

  return {
    semantic,
    limit: options.limit ?? 10,
    filter: options.filter ?? {},
    ranking,
    fineRanking: typeof options.fineRanking === 'boolean'
    ? options.fineRanking
    : (process.env.ASD_SEARCH_FINE_RANKING === '1' || this.config.enableFineRanking),
    context: options.context ?? {},
    cache: typeof options.cache === 'boolean'
    ? options.cache
    : (process.env.ASD_SEARCH_CACHE === '1' || this.config.enableCache),
    optimizeQuery: typeof options.optimizeQuery === 'boolean'
    ? options.optimizeQuery
    : (process.env.ASD_SEARCH_OPTIMIZE === '1' || this.config.enableOptimize),
    useIndex: typeof options.useIndex === 'boolean'
    ? options.useIndex
    : (process.env.ASD_SEARCH_USE_INDEX === '1' || this.config.enableIndex),
    rebuildIndex: options.rebuildIndex ?? false,
    weights: options.weights ?? this.config.weights
  };
  }

  /**
   * 关键词搜索实现
   * @private
   */
  async _keywordSearch(keyword) {
  const k = keyword ? keyword.toLowerCase() : '';
  
  // 智能分词：将长句子拆分成多个关键词
  let tokens = tokenizeQuery(keyword);
  
  // 长句子：交给 Agent Service 提取关键词（含中文关键词 + 英文翻译/同义词）
  if ((keyword || '').length >= 8) {
    const aiTokens = await this._extractKeywordsWithAI(keyword);
    if (aiTokens.length > 0) {
    tokens = [...new Set([...tokens, ...aiTokens])];
    }
  }
  
  // 如果只有一个词，使用原有逻辑
  if (tokens.length === 1) {
    const results = [];
    results.push(...this._searchSnippets(k));
    results.push(...this._searchRecipes(k));
    return results;
  }
  
  // 多关键词：对每个词搜索并合并结果
  const allResults = new Map(); // 使用 Map 去重并累积匹配分数
  
  for (const token of tokens) {
    const tokenLower = token.toLowerCase();
    const snippetResults = this._searchSnippets(tokenLower);
    const recipeResults = this._searchRecipes(tokenLower);
    const tokenResults = [...snippetResults, ...recipeResults];
    
    for (const result of tokenResults) {
    const key = `${result.title}|${result.type}`;
    if (allResults.has(key)) {
      // 已存在：增加匹配分数
      const existing = allResults.get(key);
      existing._matchCount = (existing._matchCount || 1) + 1;
    } else {
      // 新结果：添加匹配计数
      result._matchCount = 1;
      result._matchTokens = [token];
      allResults.set(key, result);
    }
    }
  }
  
  // 转为数组并按匹配数排序（匹配更多关键词的排在前面）
  const mergedResults = Array.from(allResults.values())
    .sort((a, b) => (b._matchCount || 0) - (a._matchCount || 0));
  
  return mergedResults;
  }

  /**
  * 使用 Agent Service 提取长句子的关键词（中英文一起）
   * @private
   * @param {string} text
   * @returns {Promise<string[]>}
   */
  async _extractKeywordsWithAI(text) {
  try {
    const { getAgentService } = require('../../services/agent/agentServiceHelper');
    const { agentService } = await getAgentService(this.projectRoot);

    const prompt = `请从以下查询中提取 4-8 个核心关键词：\n\n${text}\n\n要求：\n1) 如果包含中文，请给出中文关键词，并提供对应英文翻译或同义词；\n2) 只返回关键词列表，用逗号分隔；\n3) 不要解释。`;
    const response = await agentService.chat('code', prompt);
    const reply = typeof response === 'string' ? response : response.reply;

    return String(reply || '')
    .split(/[，,、\s]+/)
    .map(s => s.trim())
    .filter(s => s.length >= 2)
    .slice(0, 10);
  } catch (error) {
    this.logger.warn('Agent 关键词提取失败', { error: error.message });
    return [];
  }
  }

  /**
   * 语义搜索实现
   * @private
   */
  async _semanticSearch(keyword, config) {
  try {
    // eslint-disable-next-line global-require
    const ContextServiceV2 = require('./ContextServiceV2');
    const service = new ContextServiceV2(this.projectRoot);

    const mergedFilter = { type: 'recipe', ...config.filter };
    const items = await service.search(keyword, {
    limit: config.limit || 5,
    filter: mergedFilter
    });

    const { parseRecipeMd } = require('../../recipe/parseRecipeMd');
    
    return items.map(res => {
    const percent = ((res.similarity || 0) * 100).toFixed(0);
    const name = res.metadata?.name || res.metadata?.sourcePath || res.id;
    const content = res.content || '';
    const trigger = getTriggerFromContent(content) || undefined;

    // 尝试解析 Recipe 获取真实标题和代码
    let displayTitle = name;
    let snippetCode = this._extractFirstCodeBlock(content) || content.slice(0, 2000) || '';
    
    try {
      const parsed = parseRecipeMd(content);
      if (parsed && parsed.title) {
      displayTitle = parsed.trigger 
        ? `${parsed.title} (${parsed.trigger})`
        : parsed.title;
      if (parsed.code) {
        snippetCode = parsed.code;
      }
      }
    } catch (_) {
      // 解析失败则使用文件名
    }

    return {
      title: displayTitle,
      name,
      content,
      code: snippetCode,
      type: 'recipe',
      trigger,
      similarity: res.similarity
    };
    });
  } catch (e) {
    this.logger.warn('语义搜索失败', { error: e.message });
    return [];
  }
  }

  async _rankingSearch(query, config) {
  // 加载 Recipe 使用统计（在 RankingEngine 之前）
  let recipeStats = {};
  try {
    const { getRecipeStats } = require('../../recipe/recipeStats');
    const stats = getRecipeStats(this.projectRoot);
    recipeStats = stats.byFile || {};
  } catch (e) {
    this.logger.warn('无法加载 Recipe 统计', { error: e.message });
  }

  // 包装函数以适配 RecallEngine 的调用约定 (projectRoot, query, ...)
  // 同时注入使用统计
  let keywordSearchFn = async (projectRoot, q) => {
    const results = await this._keywordSearch(q);
    return this._enrichWithStats(results, recipeStats);
  };

  // 使用倒排索引加速（索引不存在时自动回退到关键词扫描）
  let canUseIndex = config.useIndex;
  if (canUseIndex && config.rebuildIndex) {
    await buildSearchIndex(this.projectRoot);
  }
  if (canUseIndex && !hasIndex(this.projectRoot)) {
    canUseIndex = false;
  }
  if (canUseIndex) {
    keywordSearchFn = async (projectRoot, q) => {
    const results = searchIndex(projectRoot, q, { limit: 200 });
    return this._enrichWithStats(results, recipeStats);
    };
  }

  const engine = new RankingEngine({
    keywordSearch: keywordSearchFn,
    semanticSearch: async (projectRoot, q, limit, filter) => {
    const results = await this._semanticSearch(q, { ...config, limit, filter });
    return this._enrichWithStats(results, recipeStats);
    },
    weights: config.weights
  });

  const results = await engine.search(this.projectRoot, query, {
    semantic: config.semantic,
    limit: config.limit,
    filter: config.filter,
    fineRanking: config.fineRanking,
    context: config.context
  });

  // RankingEngine 已经计算了综合分数（包含 BM25、语义、新鲜度、热度）
  // 直接使用它的分数，只更新 title 显示
  return results.map(item => {
    // 清理掉旧的百分比前缀
    let displayName = item.title?.replace(/^\(\d+%\)\s*/, '') || item.name || '';
    
    return {
    ...item,  // 保留所有字段，包括 usageCount、code 和原始 score
    title: displayName
    };
  });
  // 已经按 score 排序，无需再次排序
  }

  /**
   * 为搜索结果注入使用统计
   * @private
   */
  _enrichWithStats(results, recipeStats) {
  return results.map(item => {
    const fileName = item.name?.replace(/^.*\//, '') || item.title?.replace(/^\(\d+%\)\s*/, '').replace(/^.*\//, '');
    const stats = recipeStats[fileName] || {};
    const usageCount = (stats.guardUsageCount || 0) + (stats.humanUsageCount || 0) * 2 + (stats.aiUsageCount || 0);
    
    return {
    ...item,
    usageCount  // CoarseRanker 会使用这个字段计算 popularity
    };
  });
  }

  /**
   * 搜索 Snippets
   * @private
   */
  _searchSnippets(keyword) {
  const results = [];
  const specPath = Paths.getProjectSpecPath(this.projectRoot);

  let spec = {};
  try {
    spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  } catch (_) {
    return results;
  }

  const list = spec.list || [];
  for (const s of list) {
    if (!keyword || this._matchesKeyword(s, keyword)) {
    const raw = s.body || s.code;
    const code = Array.isArray(raw) ? raw.join('\n') : (raw || '');
    results.push({
      title: `[Snippet] ${s.title || s.completion || 'snippet'} (${s.completion || ''})`,
      name: s.title || s.completion || 'snippet',
      content: code,
      code,
      type: 'snippet'
    });
    }
  }

  return results;
  }

  /**
   * 搜索 Recipes
   * @private
   */
  _searchRecipes(keyword) {
  const results = [];
  const specPath = Paths.getProjectSpecPath(this.projectRoot);

  let spec = {};
  try {
    spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  } catch (_) {
    return results;
  }

  const recipesDir = path.join(
    this.projectRoot,
    spec.recipes?.dir || spec.skills?.dir || defaults.RECIPES_DIR
  );

  if (!fs.existsSync(recipesDir)) {
    return results;
  }

  const allMd = this._getAllMarkdownFiles(recipesDir);
  const { parseRecipeMd } = require('../../recipe/parseRecipeMd');
  
  for (const full of allMd) {
    const content = fs.readFileSync(full, 'utf8');
    const rel = path.relative(recipesDir, full).replace(/\\/g, '/');

    // 解析 Recipe 获取 trigger 和其他元数据
    let parsed = null;
    try {
    parsed = parseRecipeMd(content);
    } catch (_) {
    // 解析失败，使用默认值
    }

    // 检查是否匹配关键词：文件路径 或 内容 或 trigger
    const triggerStr = parsed?.trigger || getTriggerFromContent(content) || '';
    const matchesKeyword = !keyword || 
               rel.toLowerCase().includes(keyword) || 
               content.toLowerCase().includes(keyword) ||
               triggerStr.toLowerCase().includes(keyword);

    if (matchesKeyword) {
    // 使用解析后的标题和代码
    let displayTitle = rel.replace(/\.md$/i, '');
    let snippetCode = this._extractFirstCodeBlock(content);
    
    if (parsed && parsed.title) {
      // 使用 Recipe 的 title + trigger 作为显示标题
      displayTitle = parsed.trigger 
      ? `${parsed.title} (${parsed.trigger})`
      : parsed.title;
      // 使用解析出的 code (snippet)
      if (parsed.code) {
      snippetCode = parsed.code;
      }
    }

    results.push({
      title: displayTitle,
      name: rel,
      content,
      code: snippetCode,
      type: 'recipe',
      trigger: triggerStr || undefined
    });
    }
  }

  return results;
  }

  /**
   * 递归获取所有 Markdown 文件
   * @private
   */
  _getAllMarkdownFiles(dirPath, list = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dirPath, e.name);
    if (e.isDirectory() && !e.name.startsWith('.')) {
    this._getAllMarkdownFiles(full, list);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
    list.push(full);
    }
  }
  return list;
  }

  /**
   * 检查是否匹配关键词
   * @private
   */
  _matchesKeyword(snippet, keyword) {
  return (snippet.title && snippet.title.toLowerCase().includes(keyword)) ||
       (snippet.completion && snippet.completion.toLowerCase().includes(keyword)) ||
       (snippet.summary && snippet.summary.toLowerCase().includes(keyword));
  }

  /**
   * 从内容中提取第一个代码块
   * @private
   */
  _extractFirstCodeBlock(content) {
  if (!content || typeof content !== 'string') return '';
  const stripped = content.replace(/^---[\s\S]*?---\s*\n?/, '').trim();
  const match = stripped.match(FENCED_CODE_RE);
  if (match && match[1]) return match[1].trim();
  return stripped.slice(0, 8000);
  }

  /**
   * 获取缓存的结果
   * @private
   */
  _getCached(query, config) {
  if (!query) return null;
  const cacheKey = this._getCacheKey(query, config);
  return this.cache.get(cacheKey);
  }

  /**
   * 设置缓存的结果
   * @private
   */
  _setCached(query, config, results) {
  const cacheKey = this._getCacheKey(query, config);
  this.cache.set(cacheKey, results);
  }

  /**
   * 生成缓存键
   * @private
   */
  _getCacheKey(query, config) {
  return JSON.stringify({
    query,
    semantic: config.semantic,
    limit: config.limit,
    filter: config.filter,
    ranking: config.ranking,
    weights: config.weights,
    fineRanking: config.fineRanking
  });
  }

  /**
   * 创建 logger 实例
   * @private
   */
  _createLogger() {
  return {
    log: (msg, data) => {
    if (process.env.DEBUG) {
      console.log(`[SearchServiceV2] ${msg}`, data ? JSON.stringify(data) : '');
    }
    },
    warn: (msg, data) => {
    console.warn(`[SearchServiceV2] ⚠️  ${msg}`, data ? JSON.stringify(data) : '');
    },
    error: (msg, data) => {
    console.error(`[SearchServiceV2] ❌ ${msg}`, data ? JSON.stringify(data) : '');
    }
  };
  }
}

module.exports = SearchServiceV2;
