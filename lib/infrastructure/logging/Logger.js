import winston from 'winston';
import path from 'path';
import fs from 'fs';

/**
 * Logger - 统一日志系统
 *
 * MCP 模式（ASD_MCP_MODE=1）下 Console transport 输出到 stderr 并禁用彩色，
 * 避免污染 stdout JSON-RPC 通道。
 */
export class Logger {
  static instance = null;

  static getInstance(config = {}) {
    if (!this.instance) {
      const logsDir = config.file?.path || './logs';
      
      // 确保日志目录存在
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const isMcpMode = process.env.ASD_MCP_MODE === '1';
      const transports = [];

      // Console transport — MCP 模式下完全禁用（任何 stderr 输出都会被 Cursor 标记为 [error]）
      if (config.console !== false && !isMcpMode) {
        transports.push(
          new winston.transports.Console({
            stderrLevels: ['error', 'warn', 'info', 'debug'],
            format: winston.format.combine(
              winston.format.colorize(),
              winston.format.simple()
            ),
          })
        );
      }

      // File transports
      if (config.file?.enabled !== false) {
        transports.push(
          new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            format: winston.format.json(),
          })
        );

        transports.push(
          new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            format: winston.format.json(),
          })
        );
      }

      this.instance = winston.createLogger({
        level: config.level || 'info',
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
        transports,
      });
    }

    return this.instance;
  }

  static debug(message, meta = {}) {
    this.getInstance().debug(message, meta);
  }

  static info(message, meta = {}) {
    this.getInstance().info(message, meta);
  }

  static warn(message, meta = {}) {
    this.getInstance().warn(message, meta);
  }

  static error(message, meta = {}) {
    this.getInstance().error(message, meta);
  }
}

export default Logger;
