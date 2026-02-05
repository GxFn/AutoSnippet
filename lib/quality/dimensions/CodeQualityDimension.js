class CodeQualityDimension {
  constructor(config = {}) {
  this.config = config;
  }

  calculate(candidate) {
  let score = 1;
  const code = String(candidate.code || '');

  if (code) {
    const codeLen = code.length;
    if (codeLen < 20) score -= 0.3;
    else if (codeLen > 5000) score -= 0.2;

    if (/TODO|FIXME|xxx|\.\.\.|\[\]|___/i.test(code)) score -= 0.15;
  } else {
    score -= 0.5;
  }

  return Math.max(0, score);
  }
}

module.exports = CodeQualityDimension;
