/**
 * LogFactory - 统一日志工厂
 * 
 * 提供：
 * - 结构化日志（JSON 格式）
 * - 性能计时
 * - 环境控制（DEBUG 模式）
 * - 日志级别（debug, info, warn, error）
 */

const DEBUG = process.env.DEBUG === '*' || process.env.DEBUG?.includes('asd');

class Logger {
  constructor(name, options = {}) {
  this.name = name;
  this.level = options.level || 'info';
  this.enableTimer = options.enableTimer !== false;
  this.enableMemoryStats = options.enableMemoryStats !== false;
  this.context = {};
  this.timers = new Map();
  }

  /**
   * 设置日志上下文（会附加到所有日志）
   */
  setContext(key, value) {
  this.context[key] = value;
  return this;
  }

  /**
   * 清空上下文
   */
  clearContext() {
  this.context = {};
  return this;
  }

  /**
   * 发出日志（内部方法）
   */
  _log(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    logger: this.name,
    message,
    ...this.context,
    ...meta
  };

  // 只有在 DEBUG 模式或日志级别足够高时才输出
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  const currentLevel = levels[this.level] || 1;
  const logLevel = levels[level] || 1;

  if (logLevel >= currentLevel || DEBUG) {
    console.log(JSON.stringify(logEntry));
  }
  }

  debug(message, meta) {
  if (DEBUG) this._log('DEBUG', message, meta);
  }

  info(message, meta) {
  this._log('INFO', message, meta);
  }

  warn(message, meta) {
  this._log('WARN', message, meta);
  }

  error(message, meta) {
  this._log('ERROR', message, meta);
  }

  /**
   * 性能计时
   * 
   * 使用方式：
   * const timer = logger.startTimer('operation-name');
   * // ... 业务逻辑
   * const duration = timer.end();  // 自动记录，返回耗时（ms）
   */
  startTimer(operationName) {
  const startTime = Date.now();
  const startMemory = this.enableMemoryStats ? process.memoryUsage().heapUsed : 0;

  return {
    end: () => {
    const duration = Date.now() - startTime;
    const meta = { operationName, duration };

    if (this.enableMemoryStats) {
      const endMemory = process.memoryUsage().heapUsed;
      meta.memoryUsed = Math.round((endMemory - startMemory) / 1024); // KB
    }

    this.info(`Operation completed: ${operationName}`, meta);
    return duration;
    }
  };
  }

  /**
   * 快捷计时（如果已经有 startTime，直接计算）
   */
  recordDuration(operationName, startTime) {
  const duration = Date.now() - startTime;
  this.info(`Operation completed: ${operationName}`, {
    operationName,
    duration
  });
  return duration;
  }
}

/**
 * LogFactory - 创建 Logger 实例
 */
class LogFactory {
  constructor(options = {}) {
  this.options = {
    level: options.level || 'info',
    enableTimer: options.enableTimer !== false,
    enableMemoryStats: options.enableMemoryStats !== false
  };
  this.loggers = new Map();
  }

  /**
   * 创建或获取 Logger 实例
   */
  createLogger(name, options = {}) {
  const key = name;
  if (!this.loggers.has(key)) {
    const mergedOptions = { ...this.options, ...options };
    this.loggers.set(key, new Logger(name, mergedOptions));
  }
  return this.loggers.get(key);
  }

  /**
   * 获取所有 Logger 实例
   */
  getLoggers() {
  return Array.from(this.loggers.values());
  }

  /**
   * 清空所有 Logger
   */
  clear() {
  this.loggers.clear();
  }
}

module.exports = { LogFactory, Logger };
