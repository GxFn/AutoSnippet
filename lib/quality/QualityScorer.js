const defaultConfig = require('./config/default');
const CompletenessDimension = require('./dimensions/CompletenessDimension');
const FormatDimension = require('./dimensions/FormatDimension');
const CodeQualityDimension = require('./dimensions/CodeQualityDimension');
const MetadataDimension = require('./dimensions/MetadataDimension');
const EngagementDimension = require('./dimensions/EngagementDimension');

const DIMENSION_CLASSES = {
  completeness: CompletenessDimension,
  format: FormatDimension,
  codeQuality: CodeQualityDimension,
  metadata: MetadataDimension,
  engagement: EngagementDimension
};

class QualityScorer {
  constructor(config = defaultConfig) {
  this.config = config;
  this.weights = { ...defaultConfig.weights, ...(config.weights || {}) };
  this.dimensions = this._loadDimensions(config.dimensions || {});
  }

  score(candidate, context = {}) {
  if (!candidate || typeof candidate !== 'object') {
    return { overall: 0, dimensions: {} };
  }

  let weightedSum = 0;
  let weightSum = 0;
  const dimensionScores = {};

  for (const [name, dimension] of Object.entries(this.dimensions)) {
    const weight = this.weights[name] ?? 0;
    const score = dimension.calculate(candidate, context);
    dimensionScores[name] = score;
    weightedSum += score * weight;
    weightSum += weight;
  }

  const overall = weightSum === 0 ? 0 : weightedSum / weightSum;
  return {
    overall: Math.round(Math.min(1, Math.max(0, overall)) * 100) / 100,
    dimensions: dimensionScores
  };
  }

  updateWeights(weights = {}) {
  this.weights = { ...this.weights, ...weights };
  }

  _loadDimensions(config) {
  const instances = {};
  for (const [name, DimensionClass] of Object.entries(DIMENSION_CLASSES)) {
    const settings = config[name] || {};
    if (settings.enabled === false) continue;
    instances[name] = new DimensionClass(settings);
  }
  return instances;
  }
}

module.exports = QualityScorer;
