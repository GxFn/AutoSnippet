/**
 * 错误追踪系统
 * 捕获、记录和分析应用程序错误
 */

import Logger from '../logging/Logger.js';
import fs from 'fs';
import path from 'path';

export class ErrorTracker {
  constructor(options = {}) {
    this.config = {
      logDirectory: options.logDirectory || path.join(process.cwd(), 'logs', 'errors'),
      maxErrorsInMemory: options.maxErrorsInMemory || 500,
      enableFileLogging: options.enableFileLogging !== false,
      enableConsoleLogging: options.enableConsoleLogging !== false,
      alertThreshold: options.alertThreshold || 10, // 每分钟错误数阈值
    };

    this.errors = [];
    this.errorCounts = new Map(); // 错误类型计数
    this.recentErrors = []; // 最近错误
    this.criticalErrors = []; // 关键错误

    // 确保日志目录存在
    if (this.config.enableFileLogging) {
      this._ensureLogDirectory();
    }

    // 定期生成错误报告（unref 避免阻止进程退出）
    this.reportInterval = setInterval(() => this._generateReport(), 60000);
    if (this.reportInterval.unref) this.reportInterval.unref();
  }

  /**
   * 确保日志目录存在
   */
  _ensureLogDirectory() {
    try {
      if (!fs.existsSync(this.config.logDirectory)) {
        fs.mkdirSync(this.config.logDirectory, { recursive: true });
      }
    } catch (error) {
      Logger.error('创建错误日志目录失败', { error: error.message });
    }
  }

  /**
   * Express 错误处理中间件
   */
  errorHandler() {
    return (err, req, res, next) => {
      const errorData = {
        message: err.message,
        stack: err.stack,
        type: err.name || 'UnknownError',
        statusCode: err.statusCode || 500,
        route: `${req.method} ${req.path}`,
        method: req.method,
        path: req.path,
        query: req.query,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        timestamp: new Date().toISOString(),
        severity: err.statusCode >= 500 ? 'critical' : 'error',
      };

      this.trackError(errorData);

      // 发送响应
      res.status(errorData.statusCode).json({
        success: false,
        error: {
          code: err.code || 'INTERNAL_ERROR',
          message: err.message,
          ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
        },
      });
    };
  }

  /**
   * 记录错误
   */
  trackError(errorData) {
    // 添加到内存
    this.errors.push(errorData);
    if (this.errors.length > this.config.maxErrorsInMemory) {
      this.errors.shift();
    }

    // 最近错误
    this.recentErrors.unshift(errorData);
    if (this.recentErrors.length > 50) {
      this.recentErrors.pop();
    }

    // 关键错误
    if (errorData.severity === 'critical') {
      this.criticalErrors.unshift(errorData);
      if (this.criticalErrors.length > 100) {
        this.criticalErrors.pop();
      }
    }

    // 错误类型计数
    const errorType = errorData.type;
    this.errorCounts.set(errorType, (this.errorCounts.get(errorType) || 0) + 1);

    // 控制台日志
    if (this.config.enableConsoleLogging) {
      if (errorData.severity === 'critical') {
        Logger.error(`🔴 关键错误: ${errorData.message}`, {
          route: errorData.route,
          statusCode: errorData.statusCode,
        });
      } else {
        Logger.warn(`⚠️  错误: ${errorData.message}`, {
          route: errorData.route,
        });
      }
    }

    // 文件日志
    if (this.config.enableFileLogging) {
      this._writeToFile(errorData);
    }

    // 检查是否需要告警
    this._checkAlertThreshold();
  }

  /**
   * 写入文件
   */
  _writeToFile(errorData) {
    try {
      const date = new Date().toISOString().split('T')[0];
      const fileName = `errors-${date}.log`;
      const filePath = path.join(this.config.logDirectory, fileName);

      const logEntry = JSON.stringify({
        ...errorData,
        _timestamp: Date.now(),
      }) + '\n';

      fs.appendFileSync(filePath, logEntry, 'utf8');
    } catch (error) {
      Logger.error('写入错误日志文件失败', { error: error.message });
    }
  }

  /**
   * 检查告警阈值
   */
  _checkAlertThreshold() {
    const oneMinuteAgo = Date.now() - 60000;
    const recentErrorCount = this.errors.filter(
      (err) => new Date(err.timestamp).getTime() > oneMinuteAgo
    ).length;

    if (recentErrorCount >= this.config.alertThreshold) {
      Logger.error(`🚨 告警: 最近1分钟错误数过高 (${recentErrorCount} 个)`);
      // 这里可以集成通知服务（邮件、Slack 等）
    }
  }

  /**
   * 生成错误报告
   */
  _generateReport() {
    const now = Date.now();
    const oneHourAgo = now - 3600000;

    const recentErrorsCount = this.errors.filter(
      (err) => new Date(err.timestamp).getTime() > oneHourAgo
    ).length;

    if (recentErrorsCount > 0) {
      Logger.info('📋 错误报告 (最近1小时)', {
        totalErrors: recentErrorsCount,
        criticalErrors: this.criticalErrors.filter(
          (err) => new Date(err.timestamp).getTime() > oneHourAgo
        ).length,
        topErrorTypes: this._getTopErrorTypes(5),
      });
    }
  }

  /**
   * 获取最常见错误类型
   */
  _getTopErrorTypes(limit = 10) {
    return Array.from(this.errorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([type, count]) => ({ type, count }));
  }

  /**
   * 获取错误统计
   */
  getStats() {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const oneDayAgo = now - 86400000;

    const lastHourErrors = this.errors.filter(
      (err) => new Date(err.timestamp).getTime() > oneHourAgo
    );

    const last24HoursErrors = this.errors.filter(
      (err) => new Date(err.timestamp).getTime() > oneDayAgo
    );

    return {
      summary: {
        totalErrors: this.errors.length,
        criticalErrors: this.criticalErrors.length,
        lastHourErrors: lastHourErrors.length,
        last24HoursErrors: last24HoursErrors.length,
        uniqueErrorTypes: this.errorCounts.size,
      },
      topErrorTypes: this._getTopErrorTypes(10),
      recentErrors: this.recentErrors.slice(0, 10).map((err) => ({
        type: err.type,
        message: err.message,
        route: err.route,
        statusCode: err.statusCode,
        severity: err.severity,
        timestamp: err.timestamp,
      })),
      criticalErrors: this.criticalErrors.slice(0, 10).map((err) => ({
        type: err.type,
        message: err.message,
        route: err.route,
        timestamp: err.timestamp,
      })),
      errorsByRoute: this._getErrorsByRoute(),
    };
  }

  /**
   * 按路由统计错误
   */
  _getErrorsByRoute() {
    const routeErrors = new Map();

    this.errors.forEach((err) => {
      const route = err.route;
      routeErrors.set(route, (routeErrors.get(route) || 0) + 1);
    });

    return Array.from(routeErrors.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([route, count]) => ({ route, count }));
  }

  /**
   * 清除错误记录
   */
  clearErrors() {
    this.errors = [];
    this.recentErrors = [];
    this.criticalErrors = [];
    this.errorCounts.clear();
    Logger.info('错误追踪记录已清除');
  }

  /**
   * 搜索错误
   */
  searchErrors(options = {}) {
    let results = [...this.errors];

    if (options.type) {
      results = results.filter((err) => err.type === options.type);
    }

    if (options.route) {
      results = results.filter((err) => err.route.includes(options.route));
    }

    if (options.severity) {
      results = results.filter((err) => err.severity === options.severity);
    }

    if (options.startDate) {
      const startTime = new Date(options.startDate).getTime();
      results = results.filter((err) => new Date(err.timestamp).getTime() >= startTime);
    }

    if (options.endDate) {
      const endTime = new Date(options.endDate).getTime();
      results = results.filter((err) => new Date(err.timestamp).getTime() <= endTime);
    }

    return results.slice(0, options.limit || 100);
  }

  /**
   * 停止错误追踪
   */
  shutdown() {
    if (this.reportInterval) {
      clearInterval(this.reportInterval);
    }
    Logger.info('错误追踪已停止');
  }
}

// 单例实例
let errorTrackerInstance = null;

/**
 * 初始化错误追踪
 */
export function initErrorTracker(options) {
  if (errorTrackerInstance) {
    return errorTrackerInstance;
  }

  errorTrackerInstance = new ErrorTracker(options);
  Logger.info('✅ 错误追踪已启用');
  return errorTrackerInstance;
}

/**
 * 获取错误追踪实例
 */
export function getErrorTracker() {
  if (!errorTrackerInstance) {
    throw new Error('错误追踪未初始化，请先调用 initErrorTracker()');
  }
  return errorTrackerInstance;
}

export default ErrorTracker;
