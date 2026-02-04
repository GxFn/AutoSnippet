const RecallEngine = require('./recallEngine');
const CoarseRanker = require('./coarseRanker');
const FineRanker = require('./fineRanker');

class RankingEngine {
  constructor({ keywordSearch, semanticSearch, weights, model } = {}) {
    this.recallEngine = new RecallEngine({ keywordSearch, semanticSearch });
    this.coarseRanker = new CoarseRanker(weights);
    this.fineRanker = new FineRanker(model);
  }

  async search(projectRoot, query, options = {}) {
    const { limit = 20, fineRanking = false, context = {} } = options;
    const candidates = await this.recallEngine.recall(projectRoot, query, options);
    const coarseRanked = this.coarseRanker.rank(candidates);
    const ranked = fineRanking
      ? await this.fineRanker.rank(query, coarseRanked, context)
      : coarseRanked;

    return ranked.slice(0, limit).map((item) => ({
      title: item.title,
      name: item.name,
      content: item.content,
      code: item.code,
      type: item.type,
      trigger: item.trigger,
      score: item.score,
      breakdown: item.scores,
      fineScore: item.fineScore,
      usageCount: item.usageCount  // 保留使用统计
    }));
  }
}

module.exports = RankingEngine;
