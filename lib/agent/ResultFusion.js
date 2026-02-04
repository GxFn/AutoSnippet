/**
 * ResultFusion - Agent 输出聚合和优化
 * 
 * 职责：
 * - 聚合多个 Agent 的输出
 * - 解决冲突和不一致
 * - 排序和优化最终结果
 * - 生成统一的响应格式
 */

class ResultFusion {
  constructor(options = {}) {
    this.name = 'ResultFusion';
    this.version = '1.0.0';

    this.config = {
      confidenceThreshold: options.confidenceThreshold || 0.3,
      maxResults: options.maxResults || 10,
      deduplicationEnabled: options.deduplicationEnabled !== false,
      ...options
    };

    this.weights = options.weights || {
      relevance: 0.4,
      quality: 0.3,
      preference: 0.2,
      recency: 0.1,
      intentMatch: 0.1,
      feedback: 0.1
    };

    this.logger = options.logger || console;

    // 聚合策略
    this.strategies = {
      'code-quality': this._fuseLintResults.bind(this),
      'generation': this._fuseGenerateResults.bind(this),
      'search': this._fuseSearchResults.bind(this),
      'learning': this._fuseLearningResults.bind(this),
      'general': this._fuseGeneralResults.bind(this)
    };

    // 统计
    this.stats = {
      totalFusions: 0,
      conflictResolutions: 0,
      deduplicatedItems: 0,
      avgConfidence: 0
    };
  }

  /**
   * 融合多个 Agent 的结果
   * @param {Array} results - Agent 执行结果数组
   * @param {string} topic - 对话话题
   * @param {Object} context - 执行上下文
   * @returns {Promise<Object>} 融合后的结果
   */
  async fuse(results, topic = 'general', context = {}) {
    this.stats.totalFusions++;

    try {
      // 1. 过滤和验证结果
      const validResults = this._validateResults(results);
      if (validResults.length === 0) {
        return this._createEmptyResult();
      }

      // 2. 选择合适的融合策略
      const strategy = this.strategies[topic] || this.strategies.general;

      // 3. 执行融合
      const fused = await strategy(validResults, context);

      // 4. 应用后处理（去重、排序、截断）
      const processed = this._postProcess(fused);

      // 5. 生成统一格式
      const unified = this._unifyFormat(processed, validResults, topic);

      return {
        success: true,
        result: unified,
        metadata: {
          sourceCount: validResults.length,
          resultCount: processed.items.length,
          fusionTopic: topic,
          avgConfidence: (unified.items.reduce((sum, item) => sum + (item.confidence || 0), 0) / Math.max(unified.items.length, 1)).toFixed(2),
          conflictCount: fused.conflicts?.length || 0
        }
      };

    } catch (error) {
      this.logger.error('[ResultFusion] Fusion failed:', error);
      return {
        success: false,
        error,
        result: null
      };
    }
  }

  /**
   * 融合 Lint 结果
   * @private
   */
  async _fuseLintResults(results, context) {
    const merged = {
      violations: [],
      totalIssues: 0,
      severityDistribution: {},
      recommendations: new Set(),
      conflicts: []
    };

    for (const result of results) {
      if (result.violations && Array.isArray(result.violations)) {
        // 去重并合并违规
        for (const violation of result.violations) {
          const exists = merged.violations.find(v =>
            v.line === violation.line && 
            v.type === violation.type &&
            v.message === violation.message
          );

          if (!exists) {
            merged.violations.push(violation);
            merged.totalIssues++;

            // 统计严重级别分布
            const severity = violation.severity || 'medium';
            merged.severityDistribution[severity] = 
              (merged.severityDistribution[severity] || 0) + 1;
          }
        }
      }

      // 收集建议
      if (result.recommendations && Array.isArray(result.recommendations)) {
        result.recommendations.forEach(rec => merged.recommendations.add(rec));
      }
    }

    // 按严重程度和行号排序
    const severityOrder = { 'error': 0, 'warning': 1, 'info': 2 };
    merged.violations.sort((a, b) => {
      const severityDiff = (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2);
      return severityDiff !== 0 ? severityDiff : a.line - b.line;
    });

    return {
      items: merged.violations,
      recommendations: Array.from(merged.recommendations),
      totalIssues: merged.totalIssues,
      severityDistribution: merged.severityDistribution,
      conflicts: merged.conflicts
    };
  }

  /**
   * 融合 Generate 结果
   * @private
   */
  async _fuseGenerateResults(results, context) {
    const merged = {
      candidates: [],
      qualityAnalysis: {},
      conflicts: []
    };

    for (const result of results) {
      if (result.code) {
        // 检查是否已存在相同或非常相似的代码
        const similar = merged.candidates.find(c => 
          this._calculateSimilarity(c.code, result.code) > 0.8
        );

        if (!similar) {
          merged.candidates.push({
            code: result.code,
            language: result.language,
            confidence: result.confidence || 0.7,
            quality: result.quality || 0,
            source: result.source || 'unknown',
            explanation: result.explanation
          });
        } else {
          // 合并相似代码的信息
          if (result.confidence > similar.confidence) {
            similar.code = result.code;
            similar.confidence = result.confidence;
          }
          similar.sources = similar.sources || [];
          similar.sources.push(result.source);
        }
      }
    }

    // 按质量和信心度排序
    merged.candidates.sort((a, b) => {
      const qualityDiff = (b.quality || 0) - (a.quality || 0);
      return qualityDiff !== 0 ? qualityDiff : b.confidence - a.confidence;
    });

    return {
      items: merged.candidates,
      topCandidate: merged.candidates[0] || null,
      candidateCount: merged.candidates.length,
      conflicts: merged.conflicts
    };
  }

  /**
   * 融合 Search 结果
   * @private
   */
  async _fuseSearchResults(results, context) {
    const merged = {
      items: [],
      sourceMap: new Map(),
      rankingScores: new Map(),
      conflicts: []
    };

    for (const result of results) {
      if (result.items && Array.isArray(result.items)) {
        for (const item of result.items) {
          const key = `${item.id || item.name}`;
          
          if (merged.sourceMap.has(key)) {
            // 结果已存在，更新排名分数
            const currentScore = merged.rankingScores.get(key) || 0;
            merged.rankingScores.set(key, currentScore + (item.relevance || 0.5));
          } else {
            // 新结果
            merged.items.push({
              ...item,
              relevance: item.relevance || 0.5,
              sources: [result.source || 'unknown']
            });
            merged.sourceMap.set(key, item);
            merged.rankingScores.set(key, item.relevance || 0.5);
          }
        }
      }
    }

    // 按聚合相关度排序
    merged.items.sort((a, b) => {
      const aScore = merged.rankingScores.get(`${a.id || a.name}`) || 0;
      const bScore = merged.rankingScores.get(`${b.id || b.name}`) || 0;
      return bScore - aScore;
    });

    // 添加聚合相关度分数
    merged.items.forEach(item => {
      const key = `${item.id || item.name}`;
      item.fusedRelevance = (merged.rankingScores.get(key) / results.length).toFixed(2);
    });

    return {
      items: merged.items,
      totalResults: merged.items.length,
      conflicts: merged.conflicts
    };
  }

  /**
   * 融合 Learn 结果
   * @private
   */
  async _fuseLearningResults(results, context) {
    const merged = {
      content: [],
      learningPath: [],
      concepts: new Set(),
      conflicts: []
    };

    for (const result of results) {
      if (result.content) {
        merged.content.push({
          ...result.content,
          source: result.source || 'unknown',
          difficulty: result.difficulty || 'intermediate',
          confidence: result.confidence || 0.7
        });
      }

      if (result.learningPath && Array.isArray(result.learningPath)) {
        merged.learningPath.push(...result.learningPath);
      }

      if (result.relatedConcepts && Array.isArray(result.relatedConcepts)) {
        result.relatedConcepts.forEach(c => merged.concepts.add(c));
      }
    }

    // 按难度排序学习内容
    const difficultyOrder = { 'beginner': 0, 'intermediate': 1, 'advanced': 2 };
    merged.content.sort((a, b) => 
      difficultyOrder[a.difficulty || 'intermediate'] - 
      difficultyOrder[b.difficulty || 'intermediate']
    );

    // 构建统一的学习路径
    const unifiedPath = this._buildUnifiedLearningPath(merged.content, Array.from(merged.concepts));

    return {
      items: merged.content,
      learningPath: unifiedPath,
      concepts: Array.from(merged.concepts),
      conflicts: merged.conflicts
    };
  }

  /**
   * 融合通用结果
   * @private
   */
  async _fuseGeneralResults(results, context) {
    return {
      items: results,
      totalResults: results.length,
      conflicts: []
    };
  }

  /**
   * 验证结果
   * @private
   */
  _validateResults(results) {
    if (!Array.isArray(results)) return [];

    return results.filter(result => {
      // 过滤掉错误和空结果
      if (result.error || !result.result) return false;
      
      // 过滤掉信心度太低的结果
      if (result.confidence !== undefined && result.confidence < this.config.confidenceThreshold) {
        return false;
      }

      return true;
    }).map(result => result.result);
  }

  /**
   * 后处理：去重、排序、截断
   * @private
   */
  _postProcess(fused) {
    if (!fused.items || !Array.isArray(fused.items)) {
      return fused;
    }

    let items = fused.items;

    // 去重
    if (this.config.deduplicationEnabled) {
      const seen = new Set();
      items = items.filter(item => {
        const key = item.id || JSON.stringify(item);
        if (seen.has(key)) {
          this.stats.deduplicatedItems++;
          return false;
        }
        seen.add(key);
        return true;
      });
    }

    // 截断
    if (items.length > this.config.maxResults) {
      items = items.slice(0, this.config.maxResults);
    }

    return {
      ...fused,
      items
    };
  }

  /**
   * 统一结果格式
   * @private
   */
  _unifyFormat(processed, sources, topic) {
    return {
      type: topic,
      items: processed.items || [],
      summary: this._generateSummary(processed, topic),
      metadata: {
        totalSources: sources.length,
        deduplicatedCount: this.stats.deduplicatedItems,
        processedAt: new Date().toISOString()
      }
    };
  }

  /**
   * 生成摘要
   * @private
   */
  _generateSummary(processed, topic) {
    const itemCount = processed.items?.length || 0;

    switch (topic) {
      case 'code-quality':
        return `Found ${processed.totalIssues || 0} code quality issues`;
      case 'generation':
        return `Generated ${itemCount} code candidates`;
      case 'search':
        return `Found ${itemCount} relevant results`;
      case 'learning':
        return `Created ${itemCount} learning resources`;
      default:
        return `Processed ${itemCount} results`;
    }
  }

  /**
   * 计算两个代码的相似度
   * @private
   */
  _calculateSimilarity(code1, code2) {
    if (!code1 || !code2) return 0;

    // 简单的编辑距离相似度
    const longer = code1.length > code2.length ? code1 : code2;
    const shorter = code1.length > code2.length ? code2 : code1;

    if (longer.length === 0) return 1.0;

    const editDistance = this._levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * 计算 Levenshtein 距离
   * @private
   */
  _levenshteinDistance(s1, s2) {
    const costs = [];

    for (let i = 0; i <= s1.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= s2.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[s2.length] = lastValue;
    }

    return costs[s2.length];
  }

  /**
   * 构建统一的学习路径
   * @private
   */
  _buildUnifiedLearningPath(contentItems, concepts) {
    const path = [];

    // 按难度构建路径
    const byDifficulty = {
      beginner: contentItems.filter(c => c.difficulty === 'beginner'),
      intermediate: contentItems.filter(c => c.difficulty === 'intermediate' || !c.difficulty),
      advanced: contentItems.filter(c => c.difficulty === 'advanced')
    };

    // 添加每个难度级别的前两个资源
    ['beginner', 'intermediate', 'advanced'].forEach(level => {
      byDifficulty[level].slice(0, 2).forEach(item => {
        path.push({
          title: item.title,
          level,
          duration: item.duration || '5-10 min',
          type: item.type || 'explanation'
        });
      });
    });

    return path;
  }

  /**
   * 创建空结果
   * @private
   */
  _createEmptyResult() {
    return {
      success: false,
      result: {
        type: 'error',
        items: [],
        summary: 'No valid results to fuse',
        metadata: {
          totalSources: 0,
          processedAt: new Date().toISOString()
        }
      }
    };
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    return {
      ...this.stats,
      deduplicationRate: this.stats.deduplicatedItems + '个'
    };
  }

  /**
   * 重置统计
   */
  resetStatistics() {
    this.stats = {
      totalFusions: 0,
      conflictResolutions: 0,
      deduplicatedItems: 0,
      avgConfidence: 0
    };
  }

  /**
   * 融合多维度分数
   * @param {Object} scores
   * @param {Object} [weights]
   * @returns {number}
   */
  fuseScores(scores = {}, weights = null) {
    const w = weights || this.weights || {};
    let total = 0;
    let weightSum = 0;

    Object.keys(scores || {}).forEach((key) => {
      const value = typeof scores[key] === 'number' ? scores[key] : 0;
      const weight = typeof w[key] === 'number' ? w[key] : 0;
      if (weight > 0) {
        total += value * weight;
        weightSum += weight;
      }
    });

    if (weightSum === 0) return 0;
    return total / weightSum;
  }
}

module.exports = ResultFusion;
