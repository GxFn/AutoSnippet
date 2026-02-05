/**
 * Guard Rule 学习系统：追踪规则准确度，学习误报/漏报模式
 * 
 * - 记录每条规则的触发、应用、反馈
 * - 计算规则精准度（精确度、召回率、F1）
 * - 识别高误报规则并降权或禁用
 * - 支持基于反馈的自动学习
 */

const fs = require('fs');
const path = require('path');
const Paths = require('../infrastructure/config/Paths');

class GuardRuleLearner {
  constructor(projectRoot) {
  this.projectRoot = projectRoot;
  this.learnerPath = path.join(Paths.getProjectInternalDataPath(projectRoot), 'guard-learner.json');
  this.stats = this._loadStats();
  }

  /**
   * 记录规则触发事件
   * @param {string} ruleId 规则ID
   * @param {object} context { file, line, severity, isApplied, isFalsePositive }
   */
  recordTrigger(ruleId, context) {
  if (!this.stats.rules[ruleId]) {
    this.stats.rules[ruleId] = {
    triggeredCount: 0,
    appliedCount: 0,
    feedbackCount: 0,
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    lastUpdated: null
    };
  }

  const rule = this.stats.rules[ruleId];
  rule.triggeredCount += 1;
  if (context.isApplied) {
    rule.appliedCount += 1;
  }
  rule.lastUpdated = new Date().toISOString();

  this._save();
  }

  /**
   * 记录用户反馈（规则是否正确）
   * @param {string} ruleId
   * @param {string} verdict 'correct' | 'falsePositive' | 'falseNegative'
   */
  recordFeedback(ruleId, verdict) {
  if (!this.stats.rules[ruleId]) {
    return;
  }

  const rule = this.stats.rules[ruleId];
  rule.feedbackCount += 1;

  if (verdict === 'correct') {
    rule.truePositives += 1;
  } else if (verdict === 'falsePositive') {
    rule.falsePositives += 1;
  } else if (verdict === 'falseNegative') {
    rule.falseNegatives += 1;
  }

  rule.lastUpdated = new Date().toISOString();
  this._save();
  }

  /**
   * 计算规则的质量指标
   * @param {string} ruleId
   * @returns {{precision: number, recall: number, f1: number, isHighError: boolean}}
   */
  getMetrics(ruleId) {
  const rule = this.stats.rules[ruleId];
  if (!rule || rule.feedbackCount === 0) {
    return { precision: 0.5, recall: 0.5, f1: 0.5, isHighError: false };
  }

  // 精确度 = TP / (TP + FP)
  const precision = rule.truePositives / (rule.truePositives + rule.falsePositives + 1);

  // 召回率 = TP / (TP + FN)
  const recall = rule.truePositives / (rule.truePositives + rule.falseNegatives + 1);

  // F1 = 2 * (精确度 * 召回率) / (精确度 + 召回率)
  const f1 = 2 * (precision * recall) / (precision + recall + 0.0001);

  // 高误报：FP > 误报阈值（如 feedback 的 30%）
  const isHighError = rule.falsePositives > rule.feedbackCount * 0.3;

  return { precision, recall, f1, isHighError };
  }

  /**
   * 获取需要改进的规则（准确度低或误报多）
   * @param {number} threshold F1 分数阈值（默认 0.6）
   * @returns {Array} [{ruleId, metrics, recommendation}]
   */
  getProblematicRules(threshold = 0.6) {
  return Object.entries(this.stats.rules)
    .filter(([_, rule]) => rule.feedbackCount > 5)
    .map(([ruleId, rule]) => ({
    ruleId,
    metrics: this.getMetrics(ruleId),
    feedback: rule
    }))
    .filter(item => item.metrics.f1 < threshold)
    .map(item => ({
    ruleId: item.ruleId,
    metrics: item.metrics,
    recommendation:
      item.metrics.precision < 0.5
      ? 'disable' // 误报太多，禁用
      : item.metrics.recall < 0.5
      ? 'expand' // 漏报太多，扩展规则
      : 'tune' // 调整参数
    }));
  }

  /**
   * 批量获取所有规则的统计
   * @returns {{ruleId: {stats, metrics}}}
   */
  getAllStats() {
  return Object.entries(this.stats.rules).reduce((acc, [ruleId, rule]) => {
    acc[ruleId] = {
    stats: rule,
    metrics: this.getMetrics(ruleId)
    };
    return acc;
  }, {});
  }

  /**
   * 重置某个规则的统计
   * @param {string} ruleId
   */
  resetStats(ruleId) {
  if (this.stats.rules[ruleId]) {
    this.stats.rules[ruleId] = {
    triggeredCount: 0,
    appliedCount: 0,
    feedbackCount: 0,
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    lastUpdated: null
    };
    this._save();
  }
  }

  _loadStats() {
  try {
    if (fs.existsSync(this.learnerPath)) {
    const raw = fs.readFileSync(this.learnerPath, 'utf8');
    return JSON.parse(raw);
    }
  } catch (_) {
    // 忽略解析错误，使用默认值
  }
  return { version: 1, rules: {} };
  }

  _save() {
  const dir = path.dirname(this.learnerPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(this.learnerPath, JSON.stringify(this.stats, null, 2), 'utf8');
  }
}

module.exports = GuardRuleLearner;
