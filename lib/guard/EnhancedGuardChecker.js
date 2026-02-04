/**
 * 增强型 Guard 检查器：整合学习、排除、反馈机制
 * 
 * 改进点：
 * 1. 应用排除规则，减少误报
 * 2. 记录规则统计，用于学习
 * 3. 支持反馈循环，提高准确度
 * 4. 可配置规则权重，优先显示高信任度规则
 */

const GuardRuleLearner = require('./GuardRuleLearner');
const GuardExclusionManager = require('./GuardExclusionManager');

class EnhancedGuardChecker {
  constructor(projectRoot, baseGuardModule = null) {
    this.projectRoot = projectRoot;
    this.baseGuard = baseGuardModule; // 原有的 guardRules 模块
    this.learner = new GuardRuleLearner(projectRoot);
    this.exclusionMgr = new GuardExclusionManager(projectRoot);
  }

  /**
   * 运行静态检查，但应用排除和反馈权重
   * @param {string} code 代码
   * @param {string} language 语言
   * @param {string} filePath 文件相对路径
   * @param {string} ruleScope 规则作用域
   * @returns {Array<{ruleId, severity, message, line, isFiltered}>}
   */
  async runEnhancedStaticCheck(code, language, filePath, ruleScope = 'file') {
    if (!this.baseGuard) {
      return [];
    }

    // 检查文件是否被排除
    if (this.exclusionMgr.isPathExcluded(filePath)) {
      return [];
    }

    // 调用基础检查器
    let violations = [];
    if (this.baseGuard.runStaticCheck) {
      violations = this.baseGuard.runStaticCheck(this.projectRoot, code, language, ruleScope);
    } else if (this.baseGuard.runStaticCheckForScope) {
      violations = await this.baseGuard.runStaticCheckForScope(
        this.projectRoot,
        { code },
        filePath,
        ruleScope
      );
    }

    // 应用排除和评分
    const enhanced = violations
      .map(v => {
        const isExcluded = this.exclusionMgr.isRuleExcluded(filePath, v.ruleId) ||
                           this.exclusionMgr.isRuleGloballyDisabled(v.ruleId);
        
        if (isExcluded) {
          return { ...v, isFiltered: true, filterReason: 'excluded' };
        }

        // 获取规则的质量指标
        const metrics = this.learner.getMetrics(v.ruleId);
        
        // 根据精确度调整严重性
        let adjustedSeverity = v.severity || 'warning';
        let trustScore = metrics.f1 || 0.5; // F1 分数作为信任度
        
        if (trustScore < 0.4 && adjustedSeverity === 'error') {
          adjustedSeverity = 'warning'; // 低信任度的 error 降级为 warning
        }

        // 记录触发事件
        this.learner.recordTrigger(v.ruleId, {
          file: filePath,
          line: v.line,
          severity: v.severity,
          isApplied: true
        });

        return {
          ...v,
          severity: adjustedSeverity,
          trustScore,
          metrics
        };
      })
      .filter(v => !v.isFiltered);

    return enhanced;
  }

  /**
   * 标记一个违反为正确或误报
   * @param {string} ruleId
   * @param {string} verdict 'correct' | 'falsePositive'
   */
  feedbackViolation(ruleId, verdict = 'correct') {
    this.learner.recordFeedback(ruleId, verdict);
  }

  /**
   * 获取有问题的规则及建议
   * @param {number} threshold F1 阈值
   * @returns {Array}
   */
  getProblematicRules(threshold = 0.6) {
    return this.learner.getProblematicRules(threshold);
  }

  /**
   * 应用建议的改进（自动禁用或调整）
   * @param {string} ruleId
   * @param {string} recommendation 'disable' | 'expand' | 'tune'
   */
  applyRecommendation(ruleId, recommendation) {
    if (recommendation === 'disable') {
      this.exclusionMgr.addGlobalRuleExclusion(
        ruleId,
        `Auto-disabled due to high false positive rate`
      );
    } else if (recommendation === 'expand') {
      // 此处可以扩展规则逻辑或标记为待改进
      console.log(`[Guard Learner] Rule ${ruleId} needs expansion (high false negatives)`);
    } else if (recommendation === 'tune') {
      console.log(`[Guard Learner] Rule ${ruleId} needs parameter tuning`);
    }
  }

  /**
   * 导出学习报告
   * @returns {object} 包含所有规则的统计和建议
   */
  generateLearningReport() {
    const problematic = this.getProblematicRules();
    const allStats = this.learner.getAllStats();
    const exclusions = this.exclusionMgr.getExclusions();

    return {
      timestamp: new Date().toISOString(),
      totalRules: Object.keys(allStats).length,
      problematicRules: problematic,
      allStats,
      exclusions,
      recommendations: problematic.map(p => ({
        ruleId: p.ruleId,
        recommendation: p.recommendation,
        metrics: p.metrics
      }))
    };
  }

  /**
   * 批量应用排除（例如从配置文件）
   * @param {object} exclusions
   */
  applyExclusions(exclusions) {
    this.exclusionMgr.applyExclusions(exclusions);
  }
}

module.exports = EnhancedGuardChecker;
