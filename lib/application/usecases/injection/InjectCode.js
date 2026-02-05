/**
 * InjectCode Use Case
 * 代码注入的业务用例
 */

const { ValidationError, InjectionError } = require('../../../infrastructure/errors');

class InjectCode {
  constructor(injectionService, logger) {
  this.injectionService = injectionService;
  this.logger = logger;
  }

  /**
   * 注入代码
   * @param {Object} params - 注入参数
   * @param {string} params.filePath - 目标文件路径
   * @param {Object} params.imports - 导入语句映射
   * @param {Object} [params.options] - 选项
   * @returns {Promise<Object>} 注入结果
   */
  async execute(params) {
  this._validate(params);

  try {
    const result = await this.injectionService.injectImport(
    params.filePath,
    params.imports,
    params.options || {}
    );

    if (this.logger) {
    this.logger.info('Code injection completed', {
      filePath: params.filePath,
      importCount: Object.keys(params.imports).length
    });
    }

    return {
    success: true,
    filePath: params.filePath,
    injectedCount: result.injectedCount || 0,
    skippedCount: result.skippedCount || 0
    };
  } catch (error) {
    if (this.logger) {
    this.logger.error('Code injection failed', {
      error: error.message,
      filePath: params.filePath
    });
    }
    throw new InjectionError('Failed to inject code', {
    filePath: params.filePath,
    originalError: error.message
    });
  }
  }

  /**
   * 验证参数
   * @private
   */
  _validate(params) {
  if (!params.filePath || typeof params.filePath !== 'string') {
    throw new ValidationError('File path is required and must be a string', {
    field: 'filePath'
    });
  }

  if (!params.imports || typeof params.imports !== 'object') {
    throw new ValidationError('Imports must be an object', {
    field: 'imports'
    });
  }
  }
}

module.exports = InjectCode;
