#!/usr/bin/env node

/**
 * 职责：
 * - chokidar 文件监听封装（过滤、debounce、summary、事件回调）
 * - 这是对原 `bin/watch.js` 的下沉实现，保持对外入口 watchFileChange 不变
 */

const FileWatchService = require('./FileWatchService');

function watchFileChange(specFile, watchRootPath, options = {}) {
  return FileWatchService.watch(specFile, watchRootPath, options);
}

module.exports = {
  watchFileChange
};

