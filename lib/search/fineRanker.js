const FeatureExtractor = require('./featureExtractor');

class FineRanker {
  constructor(model) {
  this.model = model;
  this.extractor = new FeatureExtractor();
  }

  async rank(query, candidates, context = {}) {
  if (!this.model || typeof this.model.predict !== 'function') {
    return candidates;
  }

  const features = candidates.map((candidate) => this.extractor.extract(query, candidate, context));
  const scores = await this.model.predict(features);

  return candidates
    .map((candidate, index) => ({
    ...candidate,
    fineScore: scores[index] || 0
    }))
    .sort((a, b) => b.fineScore - a.fineScore);
  }
}

module.exports = FineRanker;
