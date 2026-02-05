/**
 * Guard 规则迁移工具：从原始规则格式迁移到增强系统
 * 
 * 功能：
 * 1. 导入现有Guard规则到v2实体
 * 2. 初始化学习系统基线数据
 * 3. 导入排除配置
 */

const fs = require('fs');
const path = require('path');
const Paths = require('../infrastructure/config/Paths');
const GuardRuleLearner = require('./GuardRuleLearner');
const GuardExclusionManager = require('./GuardExclusionManager');

class GuardRuleMigrator {
  constructor(projectRoot) {
  this.projectRoot = projectRoot;
  this.learner = new GuardRuleLearner(projectRoot);
  this.exclusionMgr = new GuardExclusionManager(projectRoot);
  }

  /**
   * 从旧格式规则导入到学习系统
   * @param {Array} rules 规则数组，格式: [{id, name, pattern, severity}]
   * @param {object} options {initializeBaseline: boolean}
   */
  importRules(rules, options = {}) {
  const { initializeBaseline = true } = options;

  const imported = rules.map(rule => {
    const ruleId = rule.id || rule.name;
    
    // 初始化基线数据（假设规则来自可信来源，初始准确度较高）
    if (initializeBaseline) {
    this.learner.stats.rules[ruleId] = {
      triggeredCount: 0,
      appliedCount: 0,
      feedbackCount: 0,
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      lastUpdated: new Date().toISOString(),
      // 元数据
      sourceFormat: 'legacy',
      ruleMetadata: {
      name: rule.name,
      pattern: rule.pattern,
      severity: rule.severity
      }
    };
    }

    return {
    ruleId,
    originalRule: rule,
    migratedAt: new Date().toISOString()
    };
  });

  this.learner._save();
  return {
    success: true,
    importedCount: imported.length,
    details: imported
  };
  }

  /**
   * 导入排除配置从团队共享或备份
   * @param {string} configPath 配置文件路径
   */
  importExclusions(configPath) {
  if (!fs.existsSync(configPath)) {
    return { success: false, error: 'Config file not found' };
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    this.exclusionMgr.applyExclusions(config);
    return { success: true, appliedCount: this._countExclusions(config) };
  } catch (e) {
    return { success: false, error: e.message };
  }
  }

  /**
   * 从Guard违反历史记录学习
   * @param {Array} violations 违反记录数组
   */
  learnFromViolations(violations) {
  const ruleStats = {};

  violations.forEach(v => {
    const ruleId = v.ruleId;
    if (!ruleStats[ruleId]) {
    ruleStats[ruleId] = { count: 0, applied: 0 };
    }
    ruleStats[ruleId].count += 1;
    if (v.applied) {
    ruleStats[ruleId].applied += 1;
    }
  });

  // 使用历史记录初始化触发统计
  Object.entries(ruleStats).forEach(([ruleId, stats]) => {
    if (!this.learner.stats.rules[ruleId]) {
    this.learner.stats.rules[ruleId] = {
      triggeredCount: 0,
      appliedCount: 0,
      feedbackCount: 0,
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      lastUpdated: null
    };
    }
    this.learner.stats.rules[ruleId].triggeredCount += stats.count;
    this.learner.stats.rules[ruleId].appliedCount += stats.applied;
  });

  this.learner._save();
  return { success: true, learnedRules: Object.keys(ruleStats).length };
  }

  /**
   * 导出学习系统当前状态为备份
   * @param {string} outputPath 输出路径
   */
  exportLearnerState(outputPath) {
  const state = {
    exportedAt: new Date().toISOString(),
    learnerStats: this.learner.stats,
    exclusions: this.exclusionMgr.getExclusions(),
    ruleMetrics: {}
  };

  // 计算所有规则的指标
  Object.keys(this.learner.stats.rules).forEach(ruleId => {
    state.ruleMetrics[ruleId] = this.learner.getMetrics(ruleId);
  });

  fs.writeFileSync(outputPath, JSON.stringify(state, null, 2), 'utf8');
  return { success: true, exportPath: outputPath };
  }

  /**
   * 从备份恢复学习系统状态
   * @param {string} backupPath 备份文件路径
   */
  restoreFromBackup(backupPath) {
  if (!fs.existsSync(backupPath)) {
    return { success: false, error: 'Backup file not found' };
  }

  try {
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    this.learner.stats = backup.learnerStats;
    this.learner._save();
    this.exclusionMgr.applyExclusions(backup.exclusions);
    return { success: true, restoredRules: Object.keys(backup.learnerStats.rules).length };
  } catch (e) {
    return { success: false, error: e.message };
  }
  }

  /**
   * 运行完整的迁移流程
   * @param {object} config {rulesFile?, violationsFile?, exclusionsFile?, outputDir?}
   */
  runFullMigration(config = {}) {
  const {
    rulesFile,
    violationsFile,
    exclusionsFile,
    outputDir = Paths.getProjectInternalDataPath(this.projectRoot)
  } = config;

  const results = {
    timestamp: new Date().toISOString(),
    steps: {}
  };

  // 第1步：导入规则
  if (rulesFile && fs.existsSync(rulesFile)) {
    try {
    const rules = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
    results.steps.importRules = this.importRules(Array.isArray(rules) ? rules : rules.rules);
    } catch (e) {
    results.steps.importRules = { success: false, error: e.message };
    }
  }

  // 第2步：从历史违反学习
  if (violationsFile && fs.existsSync(violationsFile)) {
    try {
    const violations = JSON.parse(fs.readFileSync(violationsFile, 'utf8'));
    const vArray = Array.isArray(violations) ? violations : violations.runs || [];
    results.steps.learnViolations = this.learnFromViolations(vArray);
    } catch (e) {
    results.steps.learnViolations = { success: false, error: e.message };
    }
  }

  // 第3步：导入排除配置
  if (exclusionsFile) {
    results.steps.importExclusions = this.importExclusions(exclusionsFile);
  }

  // 第4步：导出备份
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const backupPath = path.join(outputDir, `guard-migration-backup-${Date.now()}.json`);
  results.steps.exportBackup = this.exportLearnerState(backupPath);

  return results;
  }

  _countExclusions(config) {
  let count = 0;
  if (config.pathExclusions) count += config.pathExclusions.length;
  if (config.ruleExclusions) count += config.ruleExclusions.length;
  if (config.globalRuleExclusions) count += config.globalRuleExclusions.length;
  return count;
  }
}

module.exports = GuardRuleMigrator;
