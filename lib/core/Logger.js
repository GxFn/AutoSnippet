/**
 * Logger - 日志系统
 * 支持多个日志级别和事件通知
 */

const fs = require('fs');
const path = require('path');

class Logger {
  constructor(eventBus = null, options = {}) {
  this.eventBus = eventBus;
  this.level = options.level || 'info';
  this.logFile = options.file || null;
  this.format = options.format || this.defaultFormat;
  this.enableConsole = options.enableConsole !== false;

  // 日志级别
  this.levels = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4
  };

  this.currentLevel = this.levels[this.level] || this.levels.info;

  // 初始化日志文件
  if (this.logFile) {
    this.ensureLogFile();
  }
  }

  /**
   * 日志级别检查
   * @private
   */
  shouldLog(level) {
  return this.levels[level] >= this.currentLevel;
  }

  /**
   * 默认日志格式
   * @private
   */
  defaultFormat(level, message, data) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  if (data) {
    return `${prefix} ${message} ${JSON.stringify(data, null, 2)}`;
  }
  return `${prefix} ${message}`;
  }

  /**
   * 写入日志
   * @private
   */
  writeLog(level, message, data) {
  if (!this.shouldLog(level)) {
    return;
  }

  const formatted = this.format(level, message, data);

  // 写入控制台
  if (this.enableConsole) {
    const consoleMethod = this.getConsoleMethod(level);
    console[consoleMethod](formatted);
  }

  // 写入文件
  if (this.logFile) {
    this.appendToFile(formatted);
  }

  // 发射事件
  if (this.eventBus) {
    this.eventBus.emit(`log:${level}`, {
    level,
    message,
    data,
    timestamp: Date.now()
    });
  }
  }

  /**
   * 获取控制台方法
   * @private
   */
  getConsoleMethod(level) {
  const methods = {
    debug: 'log',
    info: 'info',
    warn: 'warn',
    error: 'error',
    fatal: 'error'
  };
  return methods[level] || 'log';
  }

  /**
   * 确保日志文件存在
   * @private
   */
  ensureLogFile() {
  const dir = path.dirname(this.logFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(this.logFile)) {
    fs.writeFileSync(this.logFile, '');
  }
  }

  /**
   * 添加内容到日志文件
   * @private
   */
  appendToFile(message) {
  try {
    fs.appendFileSync(this.logFile, message + '\n');
  } catch (error) {
    console.error(`Failed to write to log file: ${error.message}`);
  }
  }

  /**
   * Debug 日志
   */
  debug(message, data) {
  this.writeLog('debug', message, data);
  }

  /**
   * Info 日志
   */
  info(message, data) {
  this.writeLog('info', message, data);
  }

  /**
   * Warn 日志
   */
  warn(message, data) {
  this.writeLog('warn', message, data);
  }

  /**
   * Error 日志
   */
  error(message, data) {
  this.writeLog('error', message, data);
  }

  /**
   * Fatal 日志
   */
  fatal(message, data) {
  this.writeLog('fatal', message, data);
  }

  /**
   * 设置日志级别
   */
  setLevel(level) {
  if (!this.levels.hasOwnProperty(level)) {
    throw new Error(`Invalid log level: ${level}`);
  }
  this.level = level;
  this.currentLevel = this.levels[level];
  }

  /**
   * 获取日志级别
   */
  getLevel() {
  return this.level;
  }

  /**
   * 清空日志文件
   */
  clear() {
  if (this.logFile) {
    try {
    fs.writeFileSync(this.logFile, '');
    this.info('Log file cleared');
    } catch (error) {
    this.error(`Failed to clear log file: ${error.message}`);
    }
  }
  }
}

module.exports = Logger;
