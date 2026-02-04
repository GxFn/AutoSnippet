/**
 * SearchAgent - 知识搜索和检索Agent
 * 集成 Phase 2 的 RetrievalFunnel 和 KnowledgeGraph
 */

const { EventEmitter } = require('events');

class SearchAgent extends EventEmitter {
  constructor(options = {}) {
    super();
    this.name = 'search';
    this.version = '1.0.0';
    this.capabilities = [
      'semantic-search',
      'pattern-matching',
      'ranked-retrieval',
      'context-aware-search'
    ];

    // 配置
    this.config = {
      timeout: options.timeout || 5000,
      maxResults: options.maxResults || 10,
      minRelevance: options.minRelevance || 0.5,
      searchMode: options.searchMode || 'balanced', // 'fast', 'accurate', 'balanced'
      ...options
    };

    // 依赖注入
    this.retrievalFunnel = options.retrievalFunnel; // Phase 2
    this.knowledgeGraph = options.knowledgeGraph; // Phase 2
    this.vectorStore = options.vectorStore; // Phase 1
    this.logger = options.logger || console;

    // 搜索缓存
    this.searchCache = new Map();
    this.cacheSize = 100;

    // 统计
    this.stats = {
      totalSearches: 0,
      successfulSearches: 0,
      failedSearches: 0,
      avgResponseTime: 0,
      totalResultsReturned: 0,
      cacheHits: 0,
      cacheMisses: 0,
      lastSearch: null
    };
  }

  /**
   * 执行搜索
   * @param {Object} context - 执行上下文
   * @param {string} context.query - 搜索查询
   * @param {string} context.type - 搜索类型 ('recipe', 'snippet', 'pattern', 'general')
   * @param {Object} context.filters - 搜索过滤器
   * @param {Object} context.sessionContext - 会话上下文
   * @returns {Promise<Object>} 搜索结果
   */
  async execute(context) {
    const startTime = Date.now();
    this.stats.totalSearches++;

    try {
      // 参数验证
      if (!context || !context.query) {
        throw new Error('Missing required context.query');
      }

      const query = context.query;
      const type = context.type || 'general';
      const filters = context.filters || {};
      const userId = context.sessionContext?.userId;

      // 检查缓存
      const cacheKey = this._generateCacheKey(query, type, filters);
      if (this.searchCache.has(cacheKey)) {
        this.stats.cacheHits++;
        const cachedResult = this.searchCache.get(cacheKey);
        const executionTime = Date.now() - startTime;
        
        return {
          ...cachedResult,
          executionTime,
          cached: true,
          timestamp: new Date().toISOString()
        };
      }

      this.stats.cacheMisses++;

      // 执行搜索
      let results = [];
      let searchStrategy = 'default';

      // 根据搜索模式选择策略
      if (this.config.searchMode === 'fast') {
        results = await this._fastSearch(query, type, filters);
        searchStrategy = 'fast';
      } else if (this.config.searchMode === 'accurate') {
        results = await this._accurateSearch(query, type, filters);
        searchStrategy = 'accurate';
      } else {
        results = await this._balancedSearch(query, type, filters);
        searchStrategy = 'balanced';
      }

      // 排序和过滤
      results = results
        .filter(r => r.relevance >= this.config.minRelevance)
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, this.config.maxResults);

      // 增强结果（添加上下文）
      const enrichedResults = await this._enrichResults(results, context);

      // 生成搜索摘要
      const summary = this._generateSearchSummary(enrichedResults, query);

      const executionTime = Date.now() - startTime;
      this.stats.successfulSearches++;
      this._updateStats(enrichedResults, executionTime);

      const searchResult = {
        agentId: this.name,
        success: true,
        query,
        type,
        searchStrategy,
        results: enrichedResults,
        resultCount: enrichedResults.length,
        summary,
        executionTime,
        timestamp: new Date().toISOString()
      };

      // 缓存结果
      this._cacheResult(cacheKey, searchResult);

      this.emit('search_complete', { context, result: searchResult });
      return searchResult;
    } catch (error) {
      this.stats.failedSearches++;
      const executionTime = Date.now() - startTime;
      this._updateStats([], executionTime, true);

      const errorResult = {
        agentId: this.name,
        success: false,
        query: context.query,
        error: error.message,
        results: [],
        resultCount: 0,
        executionTime,
        timestamp: new Date().toISOString()
      };

      this.emit('search_error', { context, error, result: errorResult });
      throw error;
    }
  }

  /**
   * 快速搜索（基于关键词匹配）
   * @private
   */
  async _fastSearch(query, type, filters) {
    const results = [];

    // 关键词提取
    const keywords = this._extractKeywords(query);

    // 如果有RetrievalFunnel，使用第一层（快速检索）
    if (this.retrievalFunnel && this.retrievalFunnel.layer1) {
      try {
        const layer1Results = await this.retrievalFunnel.layer1(keywords, filters);
        results.push(
          ...layer1Results.map(r => ({
            ...r,
            source: 'layer1',
            relevance: r.relevance || 0.6
          }))
        );
      } catch (err) {
        this.logger.warn('[SearchAgent] Layer 1 retrieval failed:', err.message);
      }
    }

    // 简单的关键词匹配作为备选
    if (results.length === 0) {
      results.push(
        ...this._keywordMatchingSearch(keywords, type)
      );
    }

    return results;
  }

  /**
   * 精确搜索（多层次检索）
   * @private
   */
  async _accurateSearch(query, type, filters) {
    const results = [];

    // 关键词提取
    const keywords = this._extractKeywords(query);

    // 使用完整的RetrievalFunnel管道（4层）
    if (this.retrievalFunnel) {
      try {
        // Layer 1: 快速检索
        let candidateSet = [];
        if (this.retrievalFunnel.layer1) {
          candidateSet = await this.retrievalFunnel.layer1(keywords, filters);
        }

        // Layer 2: 相似性计算
        let rankedSet = candidateSet;
        if (this.retrievalFunnel.layer2 && candidateSet.length > 0) {
          rankedSet = await this.retrievalFunnel.layer2(query, candidateSet);
        }

        // Layer 3: 多信号排序
        let rerankedSet = rankedSet;
        if (this.retrievalFunnel.layer3 && rankedSet.length > 0) {
          rerankedSet = await this.retrievalFunnel.layer3(query, rankedSet, {
            type,
            intent: 'search'
          });
        }

        // Layer 4: 最终过滤和排序
        let finalSet = rerankedSet;
        if (this.retrievalFunnel.layer4 && rerankedSet.length > 0) {
          finalSet = await this.retrievalFunnel.layer4(query, rerankedSet);
        }

        results.push(
          ...finalSet.map(r => ({
            ...r,
            source: 'multi-layer',
            relevance: r.relevance || r.score || 0.7
          }))
        );
      } catch (err) {
        this.logger.warn('[SearchAgent] RetrievalFunnel failed:', err.message);
        // 降级到简单搜索
        results.push(...this._keywordMatchingSearch(keywords, type));
      }
    }

    // 查询知识图谱
    if (this.knowledgeGraph) {
      try {
        const graphResults = await this._searchKnowledgeGraph(query, keywords);
        results.push(
          ...graphResults.map(r => ({
            ...r,
            source: 'knowledge-graph',
            relevance: r.relevance || 0.65
          }))
        );
      } catch (err) {
        this.logger.warn('[SearchAgent] KnowledgeGraph search failed:', err.message);
      }
    }

    return results;
  }

  /**
   * 均衡搜索（快速和精确的组合）
   * @private
   */
  async _balancedSearch(query, type, filters) {
    const results = [];

    // 关键词提取
    const keywords = this._extractKeywords(query);

    // 使用RetrievalFunnel的前两层
    if (this.retrievalFunnel) {
      try {
        // Layer 1: 快速检索
        let candidateSet = [];
        if (this.retrievalFunnel.layer1) {
          candidateSet = await this.retrievalFunnel.layer1(keywords, filters);
        }

        // Layer 2: 相似性计算
        if (this.retrievalFunnel.layer2 && candidateSet.length > 0) {
          const rankedSet = await this.retrievalFunnel.layer2(query, candidateSet);
          results.push(
            ...rankedSet.map(r => ({
              ...r,
              source: 'retrieval-funnel',
              relevance: r.relevance || r.score || 0.65
            }))
          );
        } else {
          results.push(
            ...candidateSet.map(r => ({
              ...r,
              source: 'retrieval-funnel',
              relevance: r.relevance || 0.6
            }))
          );
        }
      } catch (err) {
        this.logger.warn('[SearchAgent] Balanced retrieval failed:', err.message);
      }
    }

    // 补充关键词匹配
    if (results.length < 5) {
      const keywordResults = this._keywordMatchingSearch(keywords, type);
      results.push(...keywordResults);
    }

    return results;
  }

  /**
   * 关键词匹配搜索
   * @private
   */
  _keywordMatchingSearch(keywords, type) {
    const results = [];

    // 简单的关键词匹配实现
    // 在实际系统中这会查询知识库
    const mockDatabase = {
      recipe: [
        { id: 'r1', name: 'Async Pattern', keywords: ['async', 'await', 'promise'] },
        { id: 'r2', name: 'Error Handling', keywords: ['error', 'try', 'catch'] },
        { id: 'r3', name: 'Array Methods', keywords: ['array', 'map', 'filter'] }
      ],
      snippet: [
        { id: 's1', name: 'Fetch Data', keywords: ['fetch', 'api', 'http'] },
        { id: 's2', name: 'Parse JSON', keywords: ['json', 'parse', 'stringify'] }
      ]
    };

    const database = mockDatabase[type] || 
                    Object.values(mockDatabase).flat();

    for (const item of database) {
      const matchCount = keywords.filter(kw => 
        item.keywords.some(k => k.includes(kw.toLowerCase()))
      ).length;

      if (matchCount > 0) {
        results.push({
          id: item.id,
          name: item.name,
          type: type === 'general' ? 'mixed' : type,
          relevance: Math.min(matchCount / keywords.length, 1.0),
          matchedKeywords: keywords.filter(kw =>
            item.keywords.some(k => k.includes(kw.toLowerCase()))
          )
        });
      }
    }

    return results;
  }

  /**
   * 知识图谱搜索
   * @private
   */
  async _searchKnowledgeGraph(query, keywords) {
    if (!this.knowledgeGraph || !this.knowledgeGraph.search) {
      return [];
    }

    try {
      const graphResults = await this.knowledgeGraph.search(query, {
        keywords,
        limit: 5
      });

      return graphResults.map(r => ({
        id: r.id || r.nodeId,
        name: r.name || r.label,
        type: 'graph-node',
        relevance: r.relevance || 0.65,
        relationships: r.relationships || []
      }));
    } catch (err) {
      this.logger.warn('[SearchAgent] KnowledgeGraph search error:', err.message);
      return [];
    }
  }

  /**
   * 增强搜索结果
   * @private
   */
  async _enrichResults(results, context) {
    return results.map((result, idx) => {
      // 添加排名和元数据
      return {
        ...result,
        rank: idx + 1,
        metadata: {
          snippet: this._generateSnippet(result),
          relatedKeywords: this._findRelatedKeywords(result),
          source: result.source || 'unknown'
        }
      };
    });
  }

  /**
   * 生成搜索结果的代码片段
   * @private
   */
  _generateSnippet(result) {
    // 简单的代码片段生成
    const snippets = {
      'Async Pattern': 'async function example() {\n  const data = await fetchData();\n  return data;\n}',
      'Error Handling': 'try {\n  // code here\n} catch (error) {\n  console.error(error);\n}',
      'Fetch Data': 'fetch(url)\n  .then(res => res.json())\n  .then(data => console.log(data))'
    };

    return snippets[result.name] || '// Code snippet available';
  }

  /**
   * 查找相关关键词
   * @private
   */
  _findRelatedKeywords(result) {
    const keywordMap = {
      'async': ['await', 'promise', 'callback'],
      'fetch': ['http', 'api', 'request'],
      'error': ['exception', 'try', 'catch'],
      'array': ['map', 'filter', 'reduce']
    };

    const relatedSet = new Set();
    (result.matchedKeywords || []).forEach(kw => {
      if (keywordMap[kw]) {
        keywordMap[kw].forEach(related => relatedSet.add(related));
      }
    });

    return Array.from(relatedSet);
  }

  /**
   * 生成搜索摘要
   * @private
   */
  _generateSearchSummary(results, query) {
    if (results.length === 0) {
      return {
        message: `No results found for "${query}"`,
        suggestions: ['Try different keywords', 'Check spelling', 'Simplify your query']
      };
    }

    const avgRelevance = results.reduce((sum, r) => sum + r.relevance, 0) / results.length;

    return {
      message: `Found ${results.length} results for "${query}"`,
      avgRelevance: Number(avgRelevance.toFixed(2)),
      topMatch: results[0].name,
      topRelevance: Number(results[0].relevance.toFixed(2)),
      suggestions: this._generateSearchSuggestions(results, query)
    };
  }

  /**
   * 生成搜索建议
   * @private
   */
  _generateSearchSuggestions(results, query) {
    const suggestions = [];

    if (results.length >= this.config.maxResults) {
      suggestions.push('Refine your query for more specific results');
    }

    if (results[0].relevance < 0.7) {
      suggestions.push('Consider searching for related terms');
    }

    if (results.some(r => r.source === 'knowledge-graph')) {
      suggestions.push('Explore related concepts in knowledge graph');
    }

    return suggestions.length > 0 ? suggestions : ['Use these results as a starting point'];
  }

  /**
   * 提取关键词
   * @private
   */
  _extractKeywords(query) {
    // 简单的关键词提取
    return query
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 2 && !this._isStopword(word))
      .slice(0, 5);
  }

  /**
   * 检查是否为停用词
   * @private
   */
  _isStopword(word) {
    const stopwords = new Set([
      'the', 'and', 'for', 'how', 'what', 'when', 'where', 'which', 'who', 'why',
      'can', 'i', 'to', 'of', 'in', 'my', 'me', 'a', 'an', 'is', 'are', 'be'
    ]);
    return stopwords.has(word);
  }

  /**
   * 生成缓存键
   * @private
   */
  _generateCacheKey(query, type, filters) {
    const queryHash = query.toLowerCase().replace(/\s+/g, '_');
    const filtersHash = JSON.stringify(filters);
    return `search_${queryHash}_${type}_${filtersHash.length}`;
  }

  /**
   * 缓存搜索结果
   * @private
   */
  _cacheResult(cacheKey, result) {
    if (this.searchCache.size >= this.cacheSize) {
      const firstKey = this.searchCache.keys().next().value;
      this.searchCache.delete(firstKey);
    }

    this.searchCache.set(cacheKey, {
      query: result.query,
      type: result.type,
      searchStrategy: result.searchStrategy,
      results: result.results,
      resultCount: result.resultCount,
      summary: result.summary,
      cached: false
    });
  }

  /**
   * 更新统计信息
   * @private
   */
  _updateStats(results, executionTime, isError = false) {
    this.stats.totalResultsReturned += results.length;
    this.stats.lastSearch = {
      timestamp: new Date().toISOString(),
      executionTime,
      resultCount: results.length,
      success: !isError
    };

    const totalTime = this.stats.avgResponseTime * (this.stats.totalSearches - 1) + executionTime;
    this.stats.avgResponseTime = totalTime / this.stats.totalSearches;
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    return {
      ...this.stats,
      name: this.name,
      version: this.version,
      capabilities: this.capabilities,
      cacheSize: this.searchCache.size,
      maxCacheSize: this.cacheSize
    };
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.searchCache.clear();
  }

  /**
   * 重置统计信息
   */
  resetStatistics() {
    this.stats = {
      totalSearches: 0,
      successfulSearches: 0,
      failedSearches: 0,
      avgResponseTime: 0,
      totalResultsReturned: 0,
      cacheHits: 0,
      cacheMisses: 0,
      lastSearch: null
    };
  }
}

module.exports = SearchAgent;
