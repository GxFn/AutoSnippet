/**
 * SearchHub - 语义搜索引擎
 * 
 * 功能：
 * - 全文搜索（关键词匹配）
 * - 简单向量相似度计算（基于 TF-IDF）
 * - 搜索排名和评分
 * - 搜索历史和统计
 */

/**
 * 简单的 TF-IDF 向量化器
 */
class TFIDFVectorizer {
  constructor() {
    this.documents = [];
    this.vocabulary = new Map();
    this.idf = new Map();
  }

  /**
   * 预处理：分词
   */
  tokenize(text) {
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 0);
  }

  /**
   * 添加文档到语料库
   */
  addDocument(docId, text) {
    const tokens = this.tokenize(text);
    
    this.documents.push({
      id: docId,
      text,
      tokens,
      tf: this._calculateTF(tokens)
    });

    // 更新词汇表
    for (const token of tokens) {
      if (!this.vocabulary.has(token)) {
        this.vocabulary.set(token, 0);
      }
      this.vocabulary.set(token, this.vocabulary.get(token) + 1);
    }
  }

  /**
   * 计算词频 (TF)
   */
  _calculateTF(tokens) {
    const tf = new Map();
    const length = tokens.length || 1;

    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1 / length);
    }

    return tf;
  }

  /**
   * 计算逆文档频率 (IDF)
   */
  _calculateIDF() {
    const n = this.documents.length || 1;

    for (const [word, count] of this.vocabulary) {
      this.idf.set(word, Math.log(n / (count + 1)));
    }
  }

  /**
   * 计算文档的 TF-IDF 向量
   */
  getVector(text) {
    // 确保 IDF 已计算
    if (this.idf.size === 0 && this.documents.length > 0) {
      this._calculateIDF();
    }

    const tokens = this.tokenize(text);
    const tf = this._calculateTF(tokens);
    const vector = new Map();

    for (const [token, tfValue] of tf) {
      const idfValue = this.idf.get(token) || 0;
      vector.set(token, tfValue * idfValue);
    }

    return vector;
  }

  /**
   * 计算两个向量的余弦相似度
   */
  cosineSimilarity(vector1, vector2) {
    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;

    // 计算点积和幅度
    for (const [key, value] of vector1) {
      magnitude1 += value * value;
      if (vector2.has(key)) {
        dotProduct += value * vector2.get(key);
      }
    }

    for (const [key, value] of vector2) {
      magnitude2 += value * value;
    }

    magnitude1 = Math.sqrt(magnitude1) || 1;
    magnitude2 = Math.sqrt(magnitude2) || 1;

    const similarity = dotProduct / (magnitude1 * magnitude2);
    
    // 处理 NaN 情况，返回 0
    return isNaN(similarity) ? 0 : similarity;
  }
}

/**
 * 搜索结果
 */
class SearchResult {
  constructor(doc, score, type = 'keyword') {
    this.id = doc.id;
    this.title = doc.title || '';
    this.description = doc.description || '';
    this.content = doc.content || '';
    this.score = score;
    this.type = type; // keyword, semantic
    this.timestamp = new Date().toISOString();
  }
}

/**
 * 搜索历史记录
 */
class SearchHistory {
  constructor(query, results, duration) {
    this.id = Math.random().toString(36).substr(2, 9);
    this.query = query;
    this.resultCount = results.length;
    this.topResult = results[0] || null;
    this.duration = duration;
    this.timestamp = new Date().toISOString();
  }
}

class SearchHub {
  constructor(options = {}) {
    this.documents = new Map(); // id -> document
    this.vectorizer = new TFIDFVectorizer();
    this.history = [];
    this.stats = {
      totalSearches: 0,
      totalResults: 0,
      avgDuration: 0,
      topQueries: [],
      byType: {}
    };
  }

  /**
   * 索引文档
   */
  index(doc) {
    this.documents.set(doc.id, doc);
    
    // 构建搜索文本：标题 + 描述 + 内容 + 标签
    const searchText = [
      doc.title || '',
      doc.description || '',
      doc.content || '',
      (doc.tags || []).join(' ')
    ].join(' ');

    this.vectorizer.addDocument(doc.id, searchText);
    return this;
  }

  /**
   * 删除索引
   */
  unindex(docId) {
    this.documents.delete(docId);
    // 注：简单实现中不删除向量，只移除文档
    return this;
  }

  /**
   * 全文搜索（关键词匹配）
   */
  searchKeyword(query, options = {}) {
    const results = [];
    const lowerQuery = query.toLowerCase();
    const startTime = Date.now();

    for (const doc of this.documents.values()) {
      // 计算匹配分数
      let score = 0;

      // 标题匹配（权重高）
      if (doc.title && doc.title.toLowerCase().includes(lowerQuery)) {
        score += 100;
      }

      // 描述匹配（权重中）
      if (
        doc.description &&
        doc.description.toLowerCase().includes(lowerQuery)
      ) {
        score += 50;
      }

      // 内容匹配（权重低）
      if (doc.content && doc.content.toLowerCase().includes(lowerQuery)) {
        const matches = (doc.content.match(new RegExp(lowerQuery, 'g')) ||
          []).length;
        score += matches * 10;
      }

      // 标签匹配
      if (doc.tags && doc.tags.some(t => t.toLowerCase().includes(lowerQuery))) {
        score += 25;
      }

      if (score > 0) {
        results.push(new SearchResult(doc, score, 'keyword'));
      }
    }

    // 排序和限制结果
    const sorted = results
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit || 10);

    this._recordSearch(query, sorted, Date.now() - startTime);

    return sorted;
  }

  /**
   * 语义搜索（向量相似度）
   */
  searchSemantic(query, options = {}) {
    const results = [];
    const startTime = Date.now();
    const queryVector = this.vectorizer.getVector(query);

    for (const doc of this.documents.values()) {
      const docSearchText = [
        doc.title || '',
        doc.description || '',
        doc.content || '',
        (doc.tags || []).join(' ')
      ].join(' ');

      const docVector = this.vectorizer.getVector(docSearchText);
      const similarity = this.vectorizer.cosineSimilarity(
        queryVector,
        docVector
      );

      if (similarity > 0) {
        results.push(new SearchResult(doc, similarity, 'semantic'));
      }
    }

    // 排序和限制结果
    const sorted = results
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit || 10);

    this._recordSearch(query, sorted, Date.now() - startTime);

    return sorted;
  }

  /**
   * 混合搜索（关键词 + 语义）
   */
  search(query, options = {}) {
    // 如果指定了类型，使用指定的搜索方式
    const type = options.type || 'hybrid';

    if (type === 'keyword') {
      return this.searchKeyword(query, options);
    }

    if (type === 'semantic') {
      return this.searchSemantic(query, options);
    }

    // 混合搜索：加权组合两种结果，需要手动获取结果而不触发 _recordSearch
    const startTime = Date.now();
    
    // 获取关键词搜索结果（不记录）
    const keywordResults = [];
    const lowerQuery = query.toLowerCase();

    for (const doc of this.documents.values()) {
      let score = 0;

      if (doc.title && doc.title.toLowerCase().includes(lowerQuery)) {
        score += 100;
      }

      if (doc.description && doc.description.toLowerCase().includes(lowerQuery)) {
        score += 50;
      }

      if (doc.content && doc.content.toLowerCase().includes(lowerQuery)) {
        const matches = (doc.content.match(new RegExp(lowerQuery, 'g')) || []).length;
        score += matches * 10;
      }

      if (doc.tags && doc.tags.some(t => t.toLowerCase().includes(lowerQuery))) {
        score += 25;
      }

      if (score > 0) {
        keywordResults.push(new SearchResult(doc, score, 'keyword'));
      }
    }

    // 获取语义搜索结果（不记录）
    const semanticResults = [];
    const queryVector = this.vectorizer.getVector(query);

    for (const doc of this.documents.values()) {
      const docSearchText = [
        doc.title || '',
        doc.description || '',
        doc.content || '',
        (doc.tags || []).join(' ')
      ].join(' ');

      const docVector = this.vectorizer.getVector(docSearchText);
      const similarity = this.vectorizer.cosineSimilarity(queryVector, docVector);

      if (similarity > 0) {
        semanticResults.push(new SearchResult(doc, similarity, 'semantic'));
      }
    }

    // 合并结果，根据类型和分数加权
    const merged = new Map();

    for (const result of keywordResults) {
      const weight = 0.6; // 关键词权重
      const key = result.id;
      const score = result.score * weight;

      if (!merged.has(key)) {
        merged.set(key, {
          ...result,
          combinedScore: 0,
          sources: []
        });
      }

      const item = merged.get(key);
      item.combinedScore += score;
      item.sources.push('keyword');
    }

    for (const result of semanticResults) {
      const weight = 0.4; // 语义权重
      const key = result.id;
      const score = result.score * weight;

      if (!merged.has(key)) {
        merged.set(key, {
          ...result,
          combinedScore: 0,
          sources: []
        });
      }

      const item = merged.get(key);
      item.combinedScore += score;
      item.sources.push('semantic');
    }

    // 排序
    const sorted = Array.from(merged.values())
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, options.limit || 10);

    // 记录搜索历史（只在混合搜索时记录一次）
    this._recordSearch(query, sorted, Date.now() - startTime);

    return sorted;
  }

  /**
   * 内部：记录搜索历史
   */
  _recordSearch(query, results, duration) {
    const history = new SearchHistory(query, results, duration);
    this.history.push(history);

    // 更新统计
    this.stats.totalSearches++;
    this.stats.totalResults += results.length;
    this.stats.avgDuration =
      (this.stats.avgDuration * (this.stats.totalSearches - 1) + duration) /
      this.stats.totalSearches;

    // 更新热门查询
    const existing = this.stats.topQueries.find(q => q.query === query);
    if (existing) {
      existing.count++;
    } else {
      this.stats.topQueries.push({ query, count: 1 });
    }

    this.stats.topQueries.sort((a, b) => b.count - a.count);
    this.stats.topQueries = this.stats.topQueries.slice(0, 10);
  }

  /**
   * 获取搜索历史
   */
  getHistory(limit = 10) {
    return this.history.slice(-limit).reverse();
  }

  /**
   * 清空搜索历史
   */
  clearHistory() {
    this.history = [];
    return this;
  }

  /**
   * 获取热门搜索
   */
  getTopQueries(limit = 5) {
    return this.stats.topQueries.slice(0, limit);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * 清空所有索引
   */
  clear() {
    this.documents.clear();
    this.vectorizer.documents = [];
    this.vectorizer.vocabulary.clear();
    this.vectorizer.idf.clear();
    return this;
  }

  /**
   * 获取索引的文档数
   */
  getIndexSize() {
    return this.documents.size;
  }
}

module.exports = {
  SearchHub,
  SearchResult,
  SearchHistory,
  TFIDFVectorizer
};
