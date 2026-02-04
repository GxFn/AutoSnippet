const { computeBM25 } = require('./bm25');

class RecallEngine {
  constructor({ keywordSearch, semanticSearch } = {}) {
    this.keywordSearch = keywordSearch;
    this.semanticSearch = semanticSearch;
  }

  async recall(projectRoot, query, options = {}) {
    const { semantic = false, limit = 100, filter = {} } = options;

    const keywordResults = this.keywordSearch ? this.keywordSearch(projectRoot, query) : [];

    const semanticResults = semantic && this.semanticSearch
      ? await this.semanticSearch(projectRoot, query, limit, filter)
      : [];

    const merged = this._mergeResults(keywordResults, semanticResults);
    return this._attachScores(query, merged);
  }

  _mergeResults(keywordResults, semanticResults) {
    const merged = [];
    const seen = new Set();

    const add = (item, source) => {
      const id = `${item.type}:${item.name || item.title || ''}`;
      if (seen.has(id)) return;
      seen.add(id);
      merged.push({
        ...item,
        id,
        source
      });
    };

    keywordResults.forEach((item) => add(item, 'keyword'));
    semanticResults.forEach((item) => add(item, 'semantic'));

    return merged;
  }

  _attachScores(query, candidates) {
    const documents = candidates.map((c) => `${c.title || ''}\n${c.content || ''}`);
    const bm25Scores = computeBM25(query, documents);

    return candidates.map((candidate, index) => ({
      ...candidate,
      scores: {
        bm25: bm25Scores[index] || 0,
        semantic: this._extractSemanticScore(candidate)
      }
    }));
  }

  _extractSemanticScore(candidate) {
    if (candidate.similarity !== undefined) return candidate.similarity;
    if (candidate.title) {
      const match = candidate.title.match(/^\((\d+)%\)/);
      if (match) return Number(match[1]) / 100;
    }
    return 0;
  }
}

module.exports = RecallEngine;
