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
  // limit 应该由调用方传入，而不是硬编码
  const { limit = 50, fineRanking = false, context = {} } = options;
  
  // 调用 recall 时不限制候选数量，获取所有候选以确保排序的完整性
  // 这样做与 keyword 模式一致：先获取所有结果，然后排序，最后截取
  const candidates = await this.recallEngine.recall(projectRoot, query, {
    ...options,
    limit: 10000  // 使用一个很大的值来禁用限制，获取所有候选
  });
  
  const coarseRanked = this.coarseRanker.rank(candidates);
  const ranked = fineRanking
    ? await this.fineRanker.rank(query, coarseRanked, context)
    : coarseRanked;

  // 按 limit 截取结果，逻辑与 keyword 模式一致
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
