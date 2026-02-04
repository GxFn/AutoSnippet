class FormatDimension {
  constructor(config = {}) {
    this.config = config;
  }

  calculate(candidate) {
    let score = 1;
    if (candidate.trigger && !/^@?[\w-]+$/.test(String(candidate.trigger).trim())) {
      score -= 0.2;
    }
    if (candidate.language && !['objc', 'swift', 'oc', 'javascript', 'typescript', 'json'].includes(String(candidate.language).toLowerCase())) {
      score -= 0.1;
    }
    return Math.max(0, score);
  }
}

module.exports = FormatDimension;
