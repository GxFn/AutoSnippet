import winston from 'winston';
import path from 'path';
import fs from 'fs';

// ChatAgent 相关标签 — 终端高亮显示
const AGENT_TAGS = ['ChatAgent', 'ToolRegistry', 'SignalCollector', 'SkillAdvisor', 'CircuitBreaker', 'EventAggregator'];
const MUTED_PREFIXES = ['HTTP Request', 'Tool registered:'];

/**
 * 精简 Console 格式
 * - ChatAgent 相关日志: 高亮 cyan/magenta，显示完整信息
 * - 其他 info/debug: 一行精简格式
 * - warn/error: 完整显示
 */
const compactConsoleFormat = winston.format.printf(({ level, message, timestamp, ...meta }) => {
  const ts = new Date(timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const rawLevel = level.replace(/\u001b\[\d+m/g, ''); // 去 ANSI

  // 静音高频噪音日志
  if (rawLevel === 'info' && MUTED_PREFIXES.some(p => message.startsWith(p))) {
    return ''; // 返回空字符串会被 winston 跳过
  }

  // 判断是否为 Agent 相关日志
  const isAgentLog = AGENT_TAGS.some(tag => message.includes(tag) || message.startsWith(`[${tag}]`));

  if (isAgentLog) {
    // ChatAgent 日志 — 高亮显示
    const metaStr = Object.keys(meta).length > 0
      ? ' ' + JSON.stringify(meta, null, 0).replace(/"/g, '').replace(/,/g, ', ')
      : '';
    return `\x1b[36m${ts}\x1b[0m \x1b[35m⚡ ${message}\x1b[0m${metaStr ? `\x1b[90m${metaStr}\x1b[0m` : ''}`;
  }

  if (rawLevel === 'warn' || rawLevel === 'error') {
    const metaStr = Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : '';
    return `${ts} ${level} ${message}${metaStr}`;
  }

  // 普通 info/debug — 精简一行
  return `\x1b[90m${ts}\x1b[0m ${level} ${message}`;
});

/**
 * Logger - 统一日志系统
 *
 * 环境变量:
 *   ASD_LOG_LEVEL — 覆盖日志级别 (debug/info/warn/error)
 *   ASD_MCP_MODE=1 — MCP 模式下禁用 Console transport
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
      const logLevel = process.env.ASD_LOG_LEVEL || config.level || 'info';
      const transports = [];

      // Console transport — MCP 模式下完全禁用（任何 stderr 输出都会被 Cursor 标记为 [error]）
      if (config.console !== false && !isMcpMode) {
        transports.push(
          new winston.transports.Console({
            stderrLevels: ['error', 'warn', 'info', 'debug'],
            format: winston.format.combine(
              winston.format.timestamp(),
              compactConsoleFormat,
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
        level: logLevel,
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
