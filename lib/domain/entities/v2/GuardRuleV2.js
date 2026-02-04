const { generateId } = require('./id');

class GuardRuleV2 {
  constructor(data = {}) {
    this.id = data.id || generateId('guard_rule');
    this.version = data.version || '1.0.0';
    this.title = data.title || '';
    this.description = data.description || '';
    this.category = data.category || '';
    this.severity = data.severity || 'warning';
    this.languages = Array.isArray(data.languages) ? data.languages : [];
    this.scope = data.scope || 'file';
    this.pattern = this._normalizePattern(data.pattern);
    this.message = data.message || '';
    this.enabled = data.enabled !== false;
    this.autoFix = data.autoFix || { enabled: false, strategy: '' };
    this.stats = data.stats || { totalMatches: 0, falsePositives: 0, accuracy: 1 };
    this.excludePaths = Array.isArray(data.excludePaths) ? data.excludePaths : [];
    this.suppressRules = Array.isArray(data.suppressRules) ? data.suppressRules : [];
    this.status = data.status || 'active';
    this.createdAt = data.createdAt || Date.now();
    this.updatedAt = data.updatedAt || Date.now();
    this.feedback = Array.isArray(data.feedback) ? data.feedback : [];
    this.retrainThreshold = data.retrainThreshold || 100;
  }

  isValid() {
    return !!(this.id && this.title && this.category && this.languages.length > 0);
  }

  validate() {
    if (!this.id) return 'Rule id is required';
    if (!this.title) return 'Rule title is required';
    if (!this.category) return 'Rule category is required';
    if (!this.languages || this.languages.length === 0) return 'Rule languages are required';
    if (!this.pattern) return 'Rule pattern is required';

    return null;
  }

  update(updates = {}) {
    Object.assign(this, updates);
    if (updates.pattern !== undefined) {
      this.pattern = this._normalizePattern(updates.pattern);
    }
    this.updatedAt = Date.now();
    return this;
  }

  recordMatch(isFalsePositive = false) {
    this.stats.totalMatches += 1;
    if (isFalsePositive) {
      this.stats.falsePositives += 1;
    }
    const total = this.stats.totalMatches || 1;
    const falsePositives = this.stats.falsePositives || 0;
    this.stats.accuracy = Math.max(0, (total - falsePositives) / total);
    this.updatedAt = Date.now();
    return this;
  }

  addFeedback(entry) {
    if (entry) {
      this.feedback.push({
        ...entry,
        timestamp: Date.now()
      });
      this.updatedAt = Date.now();
    }
    return this;
  }

  toJSON() {
    return {
      id: this.id,
      version: this.version,
      title: this.title,
      description: this.description,
      category: this.category,
      severity: this.severity,
      languages: this.languages,
      scope: this.scope,
      pattern: this.pattern,
      message: this.message,
      enabled: this.enabled,
      autoFix: this.autoFix,
      stats: this.stats,
      excludePaths: this.excludePaths,
      suppressRules: this.suppressRules,
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      feedback: this.feedback,
      retrainThreshold: this.retrainThreshold
    };
  }

  static fromJSON(json) {
    return new GuardRuleV2(json);
  }

  clone() {
    return new GuardRuleV2(this.toJSON());
  }

  _normalizePattern(pattern) {
    if (!pattern) return '';
    if (pattern instanceof RegExp) {
      return {
        source: pattern.source,
        flags: pattern.flags
      };
    }
    return pattern;
  }
}

module.exports = GuardRuleV2;
