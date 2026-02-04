/**
 * GuardService V2 - 安全规则检查和学习服务升级版本
 * 
 * 职责：
 * - 执行安全规则检查
 * - 学习和适应规则
 * - 管理排除规则
 * - 支持多平台规则（iOS、Android 等）
 * 
 * @class GuardServiceV2
 * @example
 * const service = new GuardServiceV2(projectRoot);
 * const violations = await service.checkCode(code);
 * const stats = service.getStats();
 */

const EnhancedGuardChecker = require('../../guard/EnhancedGuardChecker');
const GuardRuleLearner = require('../../guard/GuardRuleLearner');
const GuardExclusionManager = require('../../guard/GuardExclusionManager');

class GuardServiceV2 {
  constructor(projectRoot, config = {}) {
    this._validateProjectRoot(projectRoot);
    
    this.projectRoot = projectRoot;
    this.config = this._parseConfig(config);
    this.checker = new EnhancedGuardChecker(projectRoot, config.checkerConfig);
    this.learner = new GuardRuleLearner(projectRoot, config.learnerConfig);
    this.exclusionManager = new GuardExclusionManager(projectRoot, config.exclusionConfig);
    this.logger = this._createLogger();
  }

  // ============ Public API ============

  /**
   * 检查代码违规
   * 
   * @param {string} code - 要检查的代码
   * @param {Object} options - 检查选项
   *   @param {string} options.platform - 平台（ios, android, web 等）
   *   @param {string} options.context - 上下文（snippet, recipe 等）
   *   @param {boolean} options.applyExclusions - 是否应用排除规则
   * 
   * @returns {Promise<Object[]>} 违规列表
   */
  async checkCode(code, options = {}) {
    try {
      const { platform, context, applyExclusions = true } = options;

      // 执行检查
      let violations = await this.checker.check(code, { platform, context });

      // 应用排除规则
      if (applyExclusions) {
        violations = this._applyExclusions(violations);
      }

      return violations;
    } catch (e) {
      this.logger.error('Check code failed', { error: e.message });
      return [];
    }
  }

  /**
   * 检查文件中的违规
   * 
   * @param {string} filePath - 文件路径
   * @param {Object} options - 检查选项
   * @returns {Promise<Object[]>} 违规列表
   */
  async checkFile(filePath, options = {}) {
    try {
      const fs = require('fs');
      const code = fs.readFileSync(filePath, 'utf8');
      
      return await this.checkCode(code, {
        ...options,
        context: options.context || 'file'
      });
    } catch (e) {
      this.logger.error('Check file failed', { filePath, error: e.message });
      return [];
    }
  }

  /**
   * 检查目录中的所有文件
   * 
   * @param {string} dirPath - 目录路径
   * @param {Object} options - 检查选项
   * @returns {Promise<Object>} 检查结果
   */
  async checkDirectory(dirPath, options = {}) {
    try {
      const fs = require('fs');
      const path = require('path');

      const results = {
        directory: dirPath,
        filesChecked: 0,
        totalViolations: 0,
        fileResults: []
      };

      const files = this._getAllFiles(dirPath);

      for (const file of files) {
        if (!this._isCodeFile(file)) continue;

        const violations = await this.checkFile(file, options);
        if (violations.length > 0) {
          results.fileResults.push({
            file: path.relative(dirPath, file),
            violations
          });
          results.totalViolations += violations.length;
        }
        results.filesChecked++;
      }

      return results;
    } catch (e) {
      this.logger.error('Check directory failed', { dirPath, error: e.message });
      return { directory: dirPath, filesChecked: 0, totalViolations: 0, fileResults: [] };
    }
  }

  /**
   * 获取活跃的规则列表
   * 
   * @param {Object} options - 过滤选项
   *   @param {string} options.platform - 过滤平台
   *   @param {string} options.severity - 过滤严重程度
   * 
   * @returns {Object[]} 规则列表
   */
  getActiveRules(options = {}) {
    try {
      let rules = this.checker.getRules() || [];

      if (options.platform) {
        rules = rules.filter(r => !r.platforms || r.platforms.includes(options.platform));
      }

      if (options.severity) {
        rules = rules.filter(r => r.severity === options.severity);
      }

      return rules;
    } catch (e) {
      this.logger.error('Get active rules failed', { error: e.message });
      return [];
    }
  }

  /**
   * 学习新的违规模式
   * 
   * @param {Object} violation - 违规对象
   * @param {Object} options - 学习选项
   * @returns {Promise<void>}
   */
  async learnFromViolation(violation, options = {}) {
    try {
      await this.learner.learn(violation, options);
      this.logger.log('Violation learned', { violationId: violation.id });
    } catch (e) {
      this.logger.error('Learn from violation failed', { error: e.message });
    }
  }

  /**
   * 获取排除规则模式
   * 
   * @returns {Object} 排除规则配置
   */
  getExclusionPatterns() {
    try {
      return this.exclusionManager.getPatterns();
    } catch (e) {
      this.logger.error('Get exclusion patterns failed', { error: e.message });
      return {};
    }
  }

  /**
   * 添加排除规则
   * 
   * @param {string|Object} pattern - 排除模式
   * @param {Object} options - 选项
   * @returns {void}
   */
  addExclusionPattern(pattern, options = {}) {
    try {
      this.exclusionManager.addPattern(pattern, options);
      this.logger.log('Exclusion pattern added', { pattern });
    } catch (e) {
      this.logger.error('Add exclusion pattern failed', { error: e.message });
    }
  }

  /**
   * 获取服务统计信息
   * 
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      activeRules: this.getActiveRules().length,
      exclusionPatterns: Object.keys(this.getExclusionPatterns()).length,
      learnerStats: this.learner.getStats?.() || {}
    };
  }

  // ============ Private Methods ============

  /**
   * 验证项目根目录
   * @private
   */
  _validateProjectRoot(projectRoot) {
    if (!projectRoot || typeof projectRoot !== 'string') {
      throw new Error('projectRoot must be a non-empty string');
    }
  }

  /**
   * 解析配置
   * @private
   */
  _parseConfig(config) {
    return {
      enableLearning: config.enableLearning !== false,
      enableExclusions: config.enableExclusions !== false,
      platforms: config.platforms || ['ios', 'android', 'web'],
      ...config
    };
  }

  /**
   * 应用排除规则
   * @private
   */
  _applyExclusions(violations) {
    if (!this.config.enableExclusions) return violations;

    return violations.filter(v => !this.exclusionManager.isExcluded(v));
  }

  /**
   * 递归获取所有文件
   * @private
   */
  _getAllFiles(dirPath, list = []) {
    try {
      const fs = require('fs');
      const path = require('path');

      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          this._getAllFiles(fullPath, list);
        } else if (entry.isFile()) {
          list.push(fullPath);
        }
      }
    } catch (_) {
      // Ignore errors
    }

    return list;
  }

  /**
   * 检查是否为代码文件
   * @private
   */
  _isCodeFile(filePath) {
    const extensions = ['.js', '.ts', '.tsx', '.jsx', '.swift', '.kotlin', '.java', '.py'];
    return extensions.some(ext => filePath.endsWith(ext));
  }

  /**
   * 创建 logger
   * @private
   */
  _createLogger() {
    return {
      log: (msg, data) => {
        if (process.env.DEBUG) {
          console.log(`[GuardServiceV2] ${msg}`, data ? JSON.stringify(data) : '');
        }
      },
      warn: (msg, data) => {
        console.warn(`[GuardServiceV2] ⚠️ ${msg}`, data ? JSON.stringify(data) : '');
      },
      error: (msg, data) => {
        console.error(`[GuardServiceV2] ❌ ${msg}`, data ? JSON.stringify(data) : '');
      }
    };
  }
}

module.exports = GuardServiceV2;
