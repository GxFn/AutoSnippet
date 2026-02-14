import winston from 'winston';
import path from 'path';
import fs from 'fs';

// ChatAgent 相关标签 — 终端高亮显示
const AGENT_TAGS = ['ChatAgent', 'ToolRegistry', 'SignalCollector', 'SkillAdvisor', 'CircuitBreaker', 'EventAggregator'];
const MUTED_PREFIXES = ['HTTP Request', 'Tool registered:', '📊 性能统计已更新'];

// ANSI 颜色常量 — 保证深色终端可读性
const C = {
  reset:   '\x1b[0m',
  dim:     '\x1b[2m',       // 真正的 dim（用于次要信息）
  bold:    '\x1b[1m',
  // 前景色 — 使用亮色变体，深色终端更清晰
  gray:    '\x1b[37m',      // 白色（替代 90 暗灰）
  cyan:    '\x1b[96m',      // 亮青
  green:   '\x1b[92m',      // 亮绿
  yellow:  '\x1b[93m',      // 亮黄
  red:     '\x1b[91m',      // 亮红
  magenta: '\x1b[95m',      // 亮洋红
  blue:    '\x1b[94m',      // 亮蓝
  dimGray: '\x1b[2;37m',    // dim 白色 — 比 90 在深色背景上更可读
};

const LEVEL_COLORS = {
  error: C.red,
  warn:  C.yellow,
  info:  C.green,
  debug: C.blue,
};

/**
 * 精简 Console 格式
 * - ChatAgent 相关日志: 高亮 cyan/magenta，显示完整信息
 * - warn/error: 醒目颜色完整显示
 * - HTTP 日志: 精简并降低视觉权重
 * - 其他 info/debug: 一行精简格式
 */
const compactConsoleFormat = winston.format.printf(({ level, message, timestamp, ...meta }) => {
  const ts = new Date(timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const rawLevel = level.replace(/\u001b\[\d+m/g, ''); // 去 ANSI
  const lc = LEVEL_COLORS[rawLevel] || C.gray;

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
    return `${C.cyan}${ts}${C.reset} ${C.magenta}⚡ ${message}${C.reset}${metaStr ? `${C.dimGray}${metaStr}${C.reset}` : ''}`;
  }

  // HTTP 请求日志 — 精简格式，降低视觉权重
  if (message === 'HTTP' && meta.method) {
    const { method, path: reqPath, statusCode, duration } = meta;
    const status = Number(statusCode);
    const sc = status >= 500 ? C.red : status >= 400 ? C.yellow : C.dimGray;
    const dur = parseInt(duration) > 1000 ? `${C.yellow}${duration}${C.reset}` : `${C.dimGray}${duration}${C.reset}`;
    return `${C.dimGray}${ts}${C.reset} ${lc}${rawLevel}${C.reset} ${C.dimGray}${method}${C.reset} ${C.gray}${reqPath}${C.reset} ${sc}${statusCode}${C.reset} ${dur}`;
  }

  if (rawLevel === 'warn') {
    const metaStr = Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : '';
    return `${C.gray}${ts}${C.reset} ${C.yellow}${C.bold}warn${C.reset} ${C.yellow}${message}${C.reset}${metaStr ? `${C.dimGray}${metaStr}${C.reset}` : ''}`;
  }

  if (rawLevel === 'error') {
    const metaStr = Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : '';
    return `${C.gray}${ts}${C.reset} ${C.red}${C.bold}error${C.reset} ${C.red}${message}${C.reset}${metaStr ? `${C.dimGray}${metaStr}${C.reset}` : ''}`;
  }

  // 普通 info/debug — 精简一行，但保证可读
  return `${C.dimGray}${ts}${C.reset} ${lc}${rawLevel}${C.reset} ${C.gray}${message}${C.reset}`;
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
