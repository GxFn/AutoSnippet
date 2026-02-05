/**
 * Guard 规则排除策略管理器
 * 
 * 支持三个排除级别：
 * 1. 路径排除（path）：按目录/文件模式排除
 * 2. 规则排除（rule）：对特定文件禁用特定规则
 * 3. 违反排除（violation）：标记具体违反为不处理
 */

const fs = require('fs');
const path = require('path');
const Paths = require('../infrastructure/config/Paths');

/**
 * 简单的 glob 模式匹配（支持 * 和 ** ）
 */
function isPatternMatch(filePath, pattern) {
  const regexPattern = pattern
  .replace(/\./g, '\\.')
  .replace(/\*\*/g, '(.*)') // ** 匹配任意字符（包括 /）
  .replace(/\*/g, '([^/]*)'); // * 匹配非 / 的字符
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
}

class GuardExclusionManager {
  constructor(projectRoot) {
  this.projectRoot = projectRoot;
  this.exclusionPath = path.join(Paths.getProjectInternalDataPath(projectRoot), 'guard-exclusions.json');
  this.config = this._loadConfig();
  }

  /**
   * 添加路径排除（如整个目录不检查Guard）
   * @param {string} pattern glob 模式，如 'Pods/**' 或 'build/**'
   * @param {string} reason 排除原因
   */
  addPathExclusion(pattern, reason = '') {
  if (!this.config.pathExclusions) {
    this.config.pathExclusions = [];
  }

  const existing = this.config.pathExclusions.find(e => e.pattern === pattern);
  if (!existing) {
    this.config.pathExclusions.push({
    pattern,
    reason,
    addedAt: new Date().toISOString()
    });
    this._save();
  }
  }

  /**
   * 检查文件是否在排除路径中
   * @param {string} relativePath 相对于 projectRoot 的路径
   * @returns {boolean}
   */
  isPathExcluded(relativePath) {
  if (!this.config.pathExclusions) {
    return false;
  }

  return this.config.pathExclusions.some(e => isPatternMatch(relativePath, e.pattern));
  }

  /**
   * 为特定文件添加规则排除
   * @param {string} filePath 相对路径
   * @param {string} ruleId 规则ID
   * @param {string} reason 排除原因
   */
  addRuleExclusion(filePath, ruleId, reason = '') {
  if (!this.config.ruleExclusions) {
    this.config.ruleExclusions = [];
  }

  const key = `${filePath}:${ruleId}`;
  const existing = this.config.ruleExclusions.find(e => e.key === key);
  if (!existing) {
    this.config.ruleExclusions.push({
    key,
    filePath,
    ruleId,
    reason,
    addedAt: new Date().toISOString()
    });
    this._save();
  }
  }

  /**
   * 检查规则是否被排除（对于特定文件）
   * @param {string} filePath 相对路径
   * @param {string} ruleId 规则ID
   * @returns {boolean}
   */
  isRuleExcluded(filePath, ruleId) {
  // 先检查路径排除
  if (this.isPathExcluded(filePath)) {
    return true;
  }

  if (!this.config.ruleExclusions) {
    return false;
  }

  const key = `${filePath}:${ruleId}`;
  return this.config.ruleExclusions.some(e => e.key === key);
  }

  /**
   * 添加全局规则排除（对所有文件禁用此规则）
   * @param {string} ruleId
   * @param {string} reason
   */
  addGlobalRuleExclusion(ruleId, reason = '') {
  if (!this.config.globalRuleExclusions) {
    this.config.globalRuleExclusions = [];
  }

  const existing = this.config.globalRuleExclusions.find(e => e.ruleId === ruleId);
  if (!existing) {
    this.config.globalRuleExclusions.push({
    ruleId,
    reason,
    addedAt: new Date().toISOString()
    });
    this._save();
  }
  }

  /**
   * 检查规则是否全局禁用
   * @param {string} ruleId
   * @returns {boolean}
   */
  isRuleGloballyDisabled(ruleId) {
  if (!this.config.globalRuleExclusions) {
    return false;
  }
  return this.config.globalRuleExclusions.some(e => e.ruleId === ruleId);
  }

  /**
   * 获取所有排除配置
   * @returns {object}
   */
  getExclusions() {
  return {
    pathExclusions: this.config.pathExclusions || [],
    ruleExclusions: this.config.ruleExclusions || [],
    globalRuleExclusions: this.config.globalRuleExclusions || []
  };
  }

  /**
   * 批量应用排除（从另一个配置导入）
   * @param {object} exclusions {pathExclusions, ruleExclusions, globalRuleExclusions}
   */
  applyExclusions(exclusions) {
  if (exclusions.pathExclusions) {
    exclusions.pathExclusions.forEach(e => {
    this.addPathExclusion(e.pattern, e.reason);
    });
  }
  if (exclusions.ruleExclusions) {
    exclusions.ruleExclusions.forEach(e => {
    this.addRuleExclusion(e.filePath, e.ruleId, e.reason);
    });
  }
  if (exclusions.globalRuleExclusions) {
    exclusions.globalRuleExclusions.forEach(e => {
    this.addGlobalRuleExclusion(e.ruleId, e.reason);
    });
  }
  }

  /**
   * 移除排除规则
   * @param {string} type 'path' | 'rule' | 'globalRule'
   * @param {string} key 排除的标识符
   */
  removeExclusion(type, key) {
  if (type === 'path') {
    this.config.pathExclusions = (this.config.pathExclusions || []).filter(e => e.pattern !== key);
  } else if (type === 'rule') {
    this.config.ruleExclusions = (this.config.ruleExclusions || []).filter(e => e.key !== key);
  } else if (type === 'globalRule') {
    this.config.globalRuleExclusions = (this.config.globalRuleExclusions || []).filter(e => e.ruleId !== key);
  }
  this._save();
  }

  _loadConfig() {
  try {
    if (fs.existsSync(this.exclusionPath)) {
    const raw = fs.readFileSync(this.exclusionPath, 'utf8');
    return JSON.parse(raw);
    }
  } catch (_) {
    // 忽略错误，使用默认值
  }
  return { version: 1 };
  }

  _save() {
  const dir = path.dirname(this.exclusionPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(this.exclusionPath, JSON.stringify(this.config, null, 2), 'utf8');
  }
}

module.exports = GuardExclusionManager;
