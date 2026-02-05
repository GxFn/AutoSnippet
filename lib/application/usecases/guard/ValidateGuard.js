/**
 * ValidateGuard Use Case
 * Guard 规则验证的业务用例
 */

const { ValidationError, GuardError } = require('../../../infrastructure/errors');

class ValidateGuard {
  constructor(guardService, logger) {
  this.guardService = guardService;
  this.logger = logger;
  }

  /**
   * 验证代码
   * @param {Object} params - 验证参数
   * @param {string} params.code - 待验证的代码
   * @param {string} params.language - 编程语言
   * @param {Object} [params.options] - 选项
   * @returns {Promise<Object>} 验证结果
   */
  async execute(params) {
  this._validate(params);

  try {
    const violations = await this.guardService.validate(
    params.code,
    params.language,
    params.options || {}
    );

    const result = {
    valid: violations.length === 0,
    violationCount: violations.length,
    violations: violations.map(v => ({
      rule: v.rule,
      message: v.message,
      severity: v.severity,
      line: v.line
    }))
    };

    if (this.logger) {
    this.logger.info('Guard validation completed', {
      language: params.language,
      violationCount: violations.length
    });
    }

    return result;
  } catch (error) {
    if (this.logger) {
    this.logger.error('Guard validation failed', {
      error: error.message,
      language: params.language
    });
    }
    throw new GuardError('Failed to validate code', {
    language: params.language,
    originalError: error.message
    });
  }
  }

  /**
   * 验证参数
   * @private
   */
  _validate(params) {
  if (!params.code || typeof params.code !== 'string') {
    throw new ValidationError('Code is required and must be a string', {
    field: 'code'
    });
  }

  if (!params.language || typeof params.language !== 'string') {
    throw new ValidationError('Language is required and must be a string', {
    field: 'language'
    });
  }
  }
}

module.exports = ValidateGuard;
