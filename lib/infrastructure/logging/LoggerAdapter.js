/**
 * LoggerAdapter - 统一的日志适配器
 * 包装现有的 Logger 类，提供标准接口
 */

const CoreLogger = require('../../core/Logger');

class LoggerAdapter {
  constructor(options = {}) {
  this.coreLogger = new CoreLogger(options.eventBus, {
    level: options.level || 'info',
    file: options.file || null,
    format: options.format,
    enableConsole: options.enableConsole !== false
  });
  
  this.context = options.context || {};
  }

  /**
   * 添加上下文信息
   * @param {Object} context - 上下文数据
   * @returns {LoggerAdapter} 新的 logger 实例
   */
  withContext(context) {
  return new LoggerAdapter({
    level: this.coreLogger.level,
    file: this.coreLogger.logFile,
    enableConsole: this.coreLogger.enableConsole,
    eventBus: this.coreLogger.eventBus,
    context: { ...this.context, ...context }
  });
  }

  /**
   * 合并消息和上下文
   * @private
   */
  _mergeData(data) {
  if (Object.keys(this.context).length === 0) {
    return data;
  }
  if (!data) {
    return this.context;
  }
  return { ...this.context, ...data };
  }

  /**
   * Debug 日志
   */
  debug(message, data) {
  this.coreLogger.debug(message, this._mergeData(data));
  }

  /**
   * Info 日志
   */
  info(message, data) {
  this.coreLogger.info(message, this._mergeData(data));
  }

  /**
   * Warn 日志
   */
  warn(message, data) {
  this.coreLogger.warn(message, this._mergeData(data));
  }

  /**
   * Error 日志
   */
  error(message, data) {
  this.coreLogger.error(message, this._mergeData(data));
  }

  /**
   * Fatal 日志
   */
  fatal(message, data) {
  this.coreLogger.fatal(message, this._mergeData(data));
  }

  /**
   * 设置日志级别
   */
  setLevel(level) {
  this.coreLogger.setLevel(level);
  }

  /**
   * 获取日志级别
   */
  getLevel() {
  return this.coreLogger.getLevel();
  }

  /**
   * 清空日志
   */
  clear() {
  this.coreLogger.clear();
  }

  /**
   * 创建子 logger
   * @param {string} name - 子 logger 名称
   */
  child(name) {
  return this.withContext({ component: name });
  }
}

module.exports = LoggerAdapter;
