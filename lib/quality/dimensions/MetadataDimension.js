class MetadataDimension {
  constructor(config = {}) {
    this.config = config;
  }

  calculate(candidate) {
    let score = 0.5;
    if (candidate.category) score += 0.2;
    if (candidate.headers && Array.isArray(candidate.headers) && candidate.headers.length > 0) score += 0.2;
    if (candidate.summary && String(candidate.summary).length > 10) score += 0.1;
    return Math.min(1, score);
  }
}

module.exports = MetadataDimension;
