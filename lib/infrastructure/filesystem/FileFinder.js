const fs = require('fs').promises;
const path = require('path');

/**
 * 调优后的文件查找工具类
 * 优化点：
 * 1. 全异步 I/O (fs.promises)
 * 2. 内存缓存 (TTL + 目录快照)
 * 3. 并行遍历 (BFS)
 * 4. 深度控制与提前终止
 */
class FileFinder {
  constructor(options = {}) {
  this.cache = new Map();
  this.cacheTTL = options.cacheTTL || 60000; // 默认 1 分钟
  this.stats = {
    hits: 0,
    misses: 0,
    diskReads: 0
  };
  }

  /**
   * 获取目录内容（带缓存）
   */
  async getDirectoryEntries(dirPath) {
  const absPath = path.resolve(dirPath);
  const cached = this.cache.get(absPath);
  
  if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
    this.stats.hits++;
    return cached.entries;
  }

  this.stats.misses++;
  this.stats.diskReads++;
  try {
    const entries = await fs.readdir(absPath, { withFileTypes: true });
    this.cache.set(absPath, {
    entries,
    timestamp: Date.now()
    });
    return entries;
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EACCES' || err.code === 'ENOTDIR') return [];
    throw err;
  }
  }

  /**
   * 向上查找文件 (findUp)
   */
  async findUp(startPath, fileName, stopPaths = ['/', '/Users']) {
  let current = path.resolve(startPath);
  const stopSet = new Set(stopPaths.map(p => path.resolve(p)));

  while (current) {
    if (stopSet.has(current)) break;

    const entries = await this.getDirectoryEntries(current);
    const found = entries.find(e => e.isFile() && e.name === fileName);
    if (found) return path.join(current, found.name);

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
  }

  /**
   * 向下查找文件 (findDown)
   * 使用 BFS 确保先找到较浅的文件
   */
  async findDown(startPath, matcher, { maxDepth = 10, firstMatch = true } = {}) {
  const queue = [{ p: path.resolve(startPath), d: 0 }];
  const results = [];

  while (queue.length > 0) {
    const { p: curPath, d: depth } = queue.shift();
    if (depth > maxDepth) continue;

    const entries = await this.getDirectoryEntries(curPath);
    for (const entry of entries) {
    const fullPath = path.join(curPath, entry.name);
    
    let isMatch = false;
    if (typeof matcher === 'string') isMatch = entry.name === matcher;
    else if (matcher instanceof RegExp) isMatch = matcher.test(entry.name);
    else if (typeof matcher === 'function') isMatch = await matcher(entry, fullPath);

    if (isMatch) {
      if (firstMatch) return fullPath;
      results.push(fullPath);
    }

    if (entry.isDirectory()) {
      queue.push({ p: fullPath, d: depth + 1 });
    }
    }
  }
  return firstMatch ? null : results;
  }

  clearCache() {
  this.cache.clear();
  }
}

// 导出单例，方便全局复用缓存
module.exports = new FileFinder();
