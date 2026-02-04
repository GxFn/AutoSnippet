/**
 * 错误处理器 - 统一错误处理
 * 提供错误捕获、格式化和日志记录
 */

const BaseError = require('./BaseError');

class ErrorHandler {
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * 处理错误
   * @param {Error} error - 错误对象
   * @param {Object} context - 上下文信息
   * @returns {Object} 格式化的错误响应
   */
  handle(error, context = {}) {
    const errorResponse = this.formatError(error, context);
    
    if (this.logger) {
      this.logError(error, context);
    }
    
    return errorResponse;
  }

  /**
   * 格式化错误
   * @param {Error} error - 错误对象
   * @param {Object} context - 上下文信息
   * @returns {Object} 格式化的错误
   */
  formatError(error, context) {
    if (error instanceof BaseError) {
      return {
        code: error.code,
        message: error.message,
        details: error.details,
        context: context,
        timestamp: Date.now()
      };
    }

    // 未知错误
    return {
      code: 'UNKNOWN_ERROR',
      message: error.message || 'An unknown error occurred',
      details: {
        name: error.name,
        stack: error.stack
      },
      context: context,
      timestamp: Date.now()
    };
  }

  /**
   * 记录错误日志
   * @param {Error} error - 错误对象
   * @param {Object} context - 上下文信息
   */
  logError(error, context) {
    const level = error instanceof BaseError && error.code.startsWith('VALIDATION') 
      ? 'warn' 
      : 'error';

    this.logger[level]('Error occurred', {
      error: {
        name: error.name,
        message: error.message,
        code: error.code,
        stack: error.stack
      },
      context
    });
  }

  /**
   * 包装异步函数，自动处理错误
   * @param {Function} fn - 异步函数
   * @param {Object} context - 上下文信息
   * @returns {Function} 包装后的函数
   */
  wrapAsync(fn, context = {}) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        throw this.handle(error, context);
      }
    };
  }

  /**
   * 创建错误响应
   * @param {string} code - 错误码
   * @param {string} message - 错误消息
   * @param {Object} details - 详细信息
   * @returns {Object} 错误响应
   */
  static createErrorResponse(code, message, details = {}) {
    return {
      code,
      message,
      details,
      timestamp: Date.now()
    };
  }
}

module.exports = ErrorHandler;
