class CompletenessDimension {
  constructor(config = {}) {
  this.config = config;
  }

  calculate(candidate) {
  const hasTitle = !!String(candidate.title || '').trim();
  const hasTrigger = !!String(candidate.trigger || '').trim();
  const hasCode = !!String(candidate.code || '').trim();
  const hasUsageGuide = !!String(candidate.usageGuide || '').trim();

  return (
    (hasTitle ? 0.25 : 0) +
    (hasTrigger ? 0.25 : 0) +
    (hasCode ? 0.3 : 0) +
    (hasUsageGuide ? 0.2 : 0)
  );
  }
}

module.exports = CompletenessDimension;
