/**
 * Logging Infrastructure
 * 日志基础设施统一导出
 */

const LoggerAdapter = require('./LoggerAdapter');

module.exports = {
  LoggerAdapter,
  
  /**
   * 创建默认 logger
   * @param {Object} options - 选项
   */
  createLogger(options = {}) {
    return new LoggerAdapter(options);
  }
};
