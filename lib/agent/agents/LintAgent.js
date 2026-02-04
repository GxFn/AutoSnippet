/**
 * LintAgent - 代码检查和验证Agent
 * 集成现有的lint系统，提供代码质量分析
 */

const { EventEmitter } = require('events');
const path = require('path');

class LintAgent extends EventEmitter {
  constructor(options = {}) {
    super();
    this.name = 'lint';
    this.version = '1.0.0';
    this.capabilities = [
      'code-validation',
      'quality-check',
      'guard-violations',
      'metrics'
    ];
    
    // 配置
    this.config = {
      timeout: options.timeout || 5000,
      maxViolations: options.maxViolations || 100,
      severity: options.severity || 'all', // 'all', 'error', 'warning'
      ...options
    };
    
    // 依赖注入
    this.guardRules = options.guardRules;
    this.qualityRules = options.qualityRules;
    this.logger = options.logger || console;
    
    // 统计
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalViolations: 0,
      avgExecutionTime: 0,
      lastExecution: null
    };
  }

  /**
   * 执行代码检查
   * @param {Object} context - 执行上下文
   * @param {string} context.code - 要检查的代码
   * @param {string} context.filePath - 文件路径
   * @param {string} context.fileType - 文件类型 (js, ts, ios, etc)
   * @param {Object} context.sessionContext - 会话上下文
   * @returns {Promise<Object>} 检查结果
   */
  async execute(context) {
    const startTime = Date.now();
    this.stats.totalExecutions++;

    try {
      // 参数验证
      if (!context || !context.code) {
        throw new Error('Missing required context.code');
      }

      const code = context.code;
      const filePath = context.filePath || 'unknown.js';
      const fileType = context.fileType || this._detectFileType(filePath);
      
      // 运行检查
      const violations = await this._checkCode(code, filePath, fileType);
      const metrics = this._calculateMetrics(code, violations);
      
      // 生成建议
      const recommendations = this._generateRecommendations(violations, metrics);
      
      const executionTime = Date.now() - startTime;
      this.stats.successfulExecutions++;
      this._updateStats(violations, executionTime);
      
      const result = {
        agentId: this.name,
        success: violations.length === 0 || violations.some(v => v.severity !== 'error'),
        violations: violations.slice(0, this.config.maxViolations),
        violationCount: violations.length,
        metrics,
        analysis: {
          lines: code.split('\n').length,
          hasComments: /\/\/|\/\*|\*\//.test(code),
          hasErrorHandling: /try|catch|throw/.test(code),
          hasTypeAnnotations: /:\s*(string|number|boolean|any|void|object)/.test(code),
          complexity: this._estimateComplexity(code),
          score: Math.max(50 - violations.filter(v => v.severity === 'error').length * 10, 0),
          issues: violations.filter(v => v.severity === 'error').map(v => v.message),
          improvements: []
        },
        recommendations,
        executionTime,
        filePath,
        fileType,
        timestamp: new Date().toISOString()
      };

      this.emit('execution_complete', { context, result });
      return result;
    } catch (error) {
      this.stats.failedExecutions++;
      const executionTime = Date.now() - startTime;
      this._updateStats([], executionTime, true);

      const errorResult = {
        agentId: this.name,
        success: false,
        error: error.message,
        violations: [],
        violationCount: 0,
        executionTime,
        timestamp: new Date().toISOString()
      };

      this.emit('execution_error', { context, error, result: errorResult });
      throw error;
    }
  }

  /**
   * 检查代码
   * @private
   */
  async _checkCode(code, filePath, fileType) {
    const violations = [];

    // 1. Guard规则检查（如果可用）
    if (this.guardRules && this.guardRules.check) {
      try {
        const guardViolations = await this.guardRules.check(code, { fileType, filePath });
        violations.push(
          ...guardViolations.map(v => ({
            ...v,
            source: 'guard',
            ruleId: v.ruleId || 'guard_violation',
            severity: v.severity || 'warning'
          }))
        );
      } catch (err) {
        this.logger.warn('[LintAgent] Guard check failed:', err.message);
      }
    }

    // 2. 质量规则检查（如果可用）
    if (this.qualityRules && this.qualityRules.check) {
      try {
        const qualityViolations = await this.qualityRules.check(code, { fileType, filePath });
        violations.push(
          ...qualityViolations.map(v => ({
            ...v,
            source: 'quality',
            ruleId: v.ruleId || 'quality_check',
            severity: v.severity || 'info'
          }))
        );
      } catch (err) {
        this.logger.warn('[LintAgent] Quality check failed:', err.message);
      }
    }

    // 3. 基础语法检查（内置）
    const syntaxIssues = this._checkSyntax(code, fileType);
    violations.push(...syntaxIssues);

    // 4. 最佳实践检查（内置）
    const bestPracticeIssues = this._checkBestPractices(code, fileType);
    violations.push(...bestPracticeIssues);

    // 按严重程度排序
    violations.sort((a, b) => {
      const severityRank = { error: 0, warning: 1, info: 2 };
      return severityRank[a.severity] - severityRank[b.severity];
    });

    // 根据配置过滤
    if (this.config.severity !== 'all') {
      const severityRanks = {
        error: ['error'],
        warning: ['error', 'warning'],
        all: ['error', 'warning', 'info']
      };
      const allowedSeverities = severityRanks[this.config.severity] || ['error', 'warning', 'info'];
      return violations.filter(v => allowedSeverities.includes(v.severity));
    }

    return violations;
  }

  /**
   * 基础语法检查
   * @private
   */
  _checkSyntax(code, fileType) {
    const issues = [];

    // JavaScript/TypeScript 基础检查
    if (['js', 'ts', 'jsx', 'tsx'].includes(fileType)) {
      // 检查括号匹配
      if (!this._checkBrackets(code)) {
        issues.push({
          type: 'syntax_error',
          message: 'Unmatched brackets or parentheses',
          severity: 'error',
          ruleId: 'syntax_brackets',
          source: 'builtin'
        });
      }

      // 检查未使用的变量（简单检查）
      const unusedVars = this._findUnusedVariables(code);
      issues.push(
        ...unusedVars.map(varName => ({
          type: 'unused_variable',
          message: `Unused variable: ${varName}`,
          severity: 'warning',
          ruleId: 'unused_variable',
          source: 'builtin',
          variable: varName
        }))
      );

      // 检查console语句
      if (code.includes('console.log') || code.includes('console.debug')) {
        const logLines = code.split('\n').filter(line => /console\.(log|debug)/.test(line));
        if (logLines.length > 5) {
          issues.push({
            type: 'debug_code',
            message: `Too many console statements (${logLines.length})`,
            severity: 'warning',
            ruleId: 'console_statements',
            source: 'builtin',
            count: logLines.length
          });
        }
      }

      // 检查debugger语句
      if (code.includes('debugger')) {
        issues.push({
          type: 'debug_statement',
          message: 'Found debugger statement in code',
          severity: 'error',
          ruleId: 'debugger_statement',
          source: 'builtin'
        });
      }
    }

    return issues;
  }

  /**
   * 最佳实践检查
   * @private
   */
  _checkBestPractices(code, fileType) {
    const issues = [];

    if (['js', 'ts', 'jsx', 'tsx'].includes(fileType)) {
      // 检查 == vs ===
      const looseComparison = /[^=!]==[^=]/.test(code);
      if (looseComparison) {
        issues.push({
          type: 'best_practice',
          message: 'Use === instead of == for comparisons',
          severity: 'warning',
          ruleId: 'loose_equality',
          source: 'builtin'
        });
      }

      // 检查 var 声明
      const hasVar = /\bvar\s+/.test(code);
      if (hasVar) {
        issues.push({
          type: 'best_practice',
          message: 'Avoid using var; use const or let instead',
          severity: 'warning',
          ruleId: 'var_usage',
          source: 'builtin'
        });
      }

      // 检查函数复杂度（行数）
      const functions = code.match(/function\s+\w+|const\s+\w+\s*=\s*\(.*?\)\s*=>/g) || [];
      if (functions.length > 10) {
        issues.push({
          type: 'code_complexity',
          message: `High number of functions (${functions.length}); consider breaking into modules`,
          severity: 'info',
          ruleId: 'function_count',
          source: 'builtin',
          count: functions.length
        });
      }

      // 检查代码重复（简单检查）
      const lines = code.split('\n').filter(l => l.trim());
      const duplicates = lines.filter((line, idx) => lines.indexOf(line) !== idx);
      if (duplicates.length > 3) {
        issues.push({
          type: 'code_duplication',
          message: `Potential code duplication detected (${duplicates.length} lines)`,
          severity: 'info',
          ruleId: 'duplication',
          source: 'builtin',
          duplicateCount: duplicates.length
        });
      }
    }

    return issues;
  }

  /**
   * 检查括号匹配
   * @private
   */
  _checkBrackets(code) {
    const pairs = { '(': ')', '[': ']', '{': '}' };
    const stack = [];

    for (const char of code) {
      if (pairs[char]) {
        stack.push(char);
      } else if (Object.values(pairs).includes(char)) {
        const last = stack.pop();
        if (!last || pairs[last] !== char) {
          return false;
        }
      }
    }

    return stack.length === 0;
  }

  /**
   * 查找未使用的变量
   * @private
   */
  _findUnusedVariables(code) {
    const unused = [];
    const declared = new Set();
    const used = new Set();

    // 简单的变量声明和使用检测
    const varPattern = /(?:const|let|var)\s+(\w+)\s*=/g;
    const usagePattern = /\b(\w+)\b/g;

    let match;
    while ((match = varPattern.exec(code)) !== null) {
      declared.add(match[1]);
    }

    while ((match = usagePattern.exec(code)) !== null) {
      used.add(match[1]);
    }

    declared.forEach(varName => {
      if (!used.has(varName) && varName !== 'async' && varName !== 'await') {
        unused.push(varName);
      }
    });

    return unused.slice(0, 5); // 最多返回5个
  }

  /**
   * 计算代码指标
   * @private
   */
  _calculateMetrics(code, violations) {
    const lines = code.split('\n');
    const codeLines = lines.filter(l => l.trim() && !l.trim().startsWith('//'));
    
    return {
      totalLines: lines.length,
      codeLines: codeLines.length,
      commentLines: lines.filter(l => l.trim().startsWith('//')).length,
      emptyLines: lines.filter(l => !l.trim()).length,
      complexity: this._estimateComplexity(code),
      violations: violations.length,
      errors: violations.filter(v => v.severity === 'error').length,
      warnings: violations.filter(v => v.severity === 'warning').length,
      infos: violations.filter(v => v.severity === 'info').length
    };
  }

  /**
   * 估算代码复杂度
   * @private
   */
  _estimateComplexity(code) {
    let complexity = 1;
    
    // 计算条件分支数
    const branches = (code.match(/if\s*\(|else|switch|case/g) || []).length;
    complexity += branches;

    // 计算循环
    const loops = (code.match(/for|while|do\s+while/g) || []).length;
    complexity += loops;

    // 计算catch块
    const catches = (code.match(/catch\s*\(/g) || []).length;
    complexity += catches;

    return Math.min(complexity, 10); // 最多10分
  }

  /**
   * 生成建议
   * @private
   */
  _generateRecommendations(violations, metrics) {
    const recommendations = [];

    // 根据错误数生成建议
    const errorCount = violations.filter(v => v.severity === 'error').length;
    if (errorCount > 0) {
      recommendations.push({
        priority: 'critical',
        message: `Fix ${errorCount} error(s) before deploying`,
        actions: ['Review error violations', 'Apply fixes', 'Run lint again']
      });
    }

    // 根据警告数生成建议
    const warningCount = violations.filter(v => v.severity === 'warning').length;
    if (warningCount > 5) {
      recommendations.push({
        priority: 'high',
        message: `${warningCount} warnings found; consider refactoring`,
        actions: ['Review warning violations', 'Apply improvements', 'Test thoroughly']
      });
    }

    // 根据复杂度生成建议
    if (metrics.complexity > 7) {
      recommendations.push({
        priority: 'medium',
        message: 'Code complexity is high; consider breaking into smaller functions',
        actions: ['Identify large functions', 'Extract helper functions', 'Test refactored code']
      });
    }

    // 根据代码行数生成建议
    if (metrics.codeLines > 300) {
      recommendations.push({
        priority: 'medium',
        message: 'File is large; consider splitting into multiple files',
        actions: ['Identify logical sections', 'Create separate modules', 'Update imports']
      });
    }

    // 如果没有问题
    if (recommendations.length === 0 && errorCount === 0 && warningCount === 0) {
      recommendations.push({
        priority: 'info',
        message: '✓ Code looks good! No major issues detected',
        actions: ['Code is ready for review', 'Consider performance optimization']
      });
    }

    return recommendations;
  }

  /**
   * 检测文件类型
   * @private
   */
  _detectFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase().substring(1);
    const typeMap = {
      'js': 'js',
      'mjs': 'js',
      'cjs': 'js',
      'ts': 'ts',
      'tsx': 'tsx',
      'jsx': 'jsx',
      'm': 'ios',
      'swift': 'swift',
      'py': 'python',
      'java': 'java',
      'go': 'go'
    };
    return typeMap[ext] || 'js';
  }

  /**
   * 更新统计信息
   * @private
   */
  _updateStats(violations, executionTime, isError = false) {
    this.stats.totalViolations += violations.length;
    this.stats.lastExecution = {
      timestamp: new Date().toISOString(),
      executionTime,
      violationCount: violations.length,
      success: !isError
    };

    // 更新平均执行时间
    const totalTime = this.stats.avgExecutionTime * (this.stats.totalExecutions - 1) + executionTime;
    this.stats.avgExecutionTime = totalTime / this.stats.totalExecutions;
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    return {
      ...this.stats,
      name: this.name,
      version: this.version,
      capabilities: this.capabilities
    };
  }

  /**
   * 获取Agent配置
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 重置统计信息
   */
  resetStatistics() {
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalViolations: 0,
      avgExecutionTime: 0,
      lastExecution: null
    };
  }
}

module.exports = LintAgent;
