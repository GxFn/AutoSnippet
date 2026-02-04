/**
 * FileWatchConfig - 文件监听配置
 */

const path = require('path');

const CMD_PATH = process.cwd();

const FileWatchConfig = {
  CMD_PATH,
  
  // 监听后缀
  DEFAULT_EXTS: ['.m', '.h', '.swift', '.md'],
  
  // 忽略的路径
  IGNORED: [
    '**/node_modules/**',
    '**/.git/**',
    '**/.mgit/**',
    '**/.easybox/**',
    '**/xcuserdata/**',
    '**/.build/**',
    '**/*.swp',
    '**/*.tmp',
    '**/*~.m',
    '**/*~.h',
  ],
  
  // 默认模式
  DEFAULT_FILE_PATTERN: ['**/*.m', '**/*.h', '**/*.swift', '**/_draft_*.md'],
  
  // 防抖延迟
  DEBOUNCE_DELAY: 300,
  
  // Chokidar 配置
  CHOKIDAR_OPTIONS: {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100
    },
    usePolling: process.env.ASD_WATCH_POLLING === 'true',
    interval: 100,
    binaryInterval: 300
  }
};

module.exports = FileWatchConfig;
