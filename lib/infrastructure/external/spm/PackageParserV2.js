/**
 * PackageParserV2 - 包解析服务 V2 版本
 * 
 * 职责：
 * - 解析 Package.swift 文件
 * - 查找项目根目录中的 Package.swift
 * - 提取 target 块和依赖信息
 * 
 * @class PackageParserV2
 */

const fs = require('fs');
const path = require('path');

class PackageParserV2 {
  constructor(projectRoot, config = {}) {
  this._validateProjectRoot(projectRoot);
  
  this.projectRoot = projectRoot;
  this.config = this._parseConfig(config);
  this.cache = new Map();
  this.logger = this._createLogger();
  }

  // ============ Public API ============

  /**
   * 查找 Package.swift 文件路径
   * @param {string} startPath - 起始路径
   * @returns {Promise<string|null>} Package.swift 路径
   */
  async findPackageSwiftPath(startPath = this.projectRoot) {
  try {
    return await this._findPackageSwift(startPath);
  } catch (e) {
    this.logger.error('Find package swift failed', { startPath, error: e.message });
    throw e;
  }
  }

  /**
   * 解析 Package.swift 文件
   * @param {string} packagePath - Package.swift 文件路径
   * @returns {Promise<Object>} 解析结果
   */
  async parsePackageSwift(packagePath) {
  try {
    if (!packagePath || !fs.existsSync(packagePath)) {
    throw new Error(`Package.swift not found: ${packagePath}`);
    }

    const content = fs.readFileSync(packagePath, 'utf8');
    const result = {
    path: packagePath,
    name: this._extractPackageName(content),
    version: this._extractVersion(content),
    targets: this._extractTargets(content),
    dependencies: this._extractDependencies(content),
    products: this._extractProducts(content),
    platforms: this._extractPlatforms(content)
    };

    this.logger.log('Package parsed', { path: packagePath, targets: result.targets.length });
    return result;
  } catch (e) {
    this.logger.error('Parse package swift failed', { packagePath, error: e.message });
    throw e;
  }
  }

  /**
   * 提取 target 块
   * @param {string} content - Package.swift 内容
   * @returns {Array<Object>} target 列表
   */
  extractTargetBlocksFromPackageSwift(content) {
  try {
    return this._extractTargets(content);
  } catch (e) {
    this.logger.error('Extract targets failed', { error: e.message });
    return [];
  }
  }

  /**
   * 获取包信息摘要
   * @param {string} packagePath - Package.swift 路径
   * @returns {Promise<Object>} 摘要信息
   */
  async getPackageSummary(packagePath) {
  try {
    const parsed = await this.parsePackageSwift(packagePath);
    return {
    name: parsed.name,
    version: parsed.version,
    targetCount: parsed.targets.length,
    dependencyCount: parsed.dependencies.length,
    platforms: parsed.platforms
    };
  } catch (e) {
    this.logger.error('Get package summary failed', { error: e.message });
    return null;
  }
  }

  /**
   * 清空缓存
   */
  clearCache() {
  this.cache.clear();
  }

  // ============ Private Methods ============

  /**
   * 验证项目根目录
   * @private
   */
  _validateProjectRoot(projectRoot) {
  if (!projectRoot || !fs.existsSync(projectRoot)) {
    throw new Error(`Invalid projectRoot: ${projectRoot}`);
  }
  }

  /**
   * 解析配置
   * @private
   */
  _parseConfig(config) {
  return {
    cacheSize: config.cacheSize || 100,
    cacheTTL: config.cacheTTL || 5 * 60 * 1000,
    ...config
  };
  }

  /**
   * 创建日志器
   * @private
   */
  _createLogger() {
  const debug = process.env.DEBUG && process.env.DEBUG.includes('PackageParserV2');
  return {
    log: (msg, data) => debug && console.log(`[PackageParserV2] ✓ ${msg}`, data || ''),
    warn: (msg, data) => console.warn(`[PackageParserV2] ⚠️ ${msg}`, data || ''),
    error: (msg, data) => console.error(`[PackageParserV2] ❌ ${msg}`, data || '')
  };
  }

  /**
   * 递归查找 Package.swift
   * @private
   */
  async _findPackageSwift(dirPath) {
  const cacheKey = `find:${dirPath}`;
  if (this.cache.has(cacheKey)) {
    return this.cache.get(cacheKey);
  }

  try {
    const entries = await fs.promises.readdir(dirPath);
    if (entries.includes('Package.swift')) {
    const packagePath = path.join(dirPath, 'Package.swift');
    this.cache.set(cacheKey, packagePath);
    return packagePath;
    }

    const parentDir = path.dirname(dirPath);
    if (parentDir === dirPath) {
    return null; // 已到达根目录
    }

    return await this._findPackageSwift(parentDir);
  } catch (e) {
    return null;
  }
  }

  /**
   * 提取包名
   * @private
   */
  _extractPackageName(content) {
  const match = content.match(/name\s*:\s*"([^"]+)"/);
  return match ? match[1] : 'unknown';
  }

  /**
   * 提取版本
   * @private
   */
  _extractVersion(content) {
  const match = content.match(/version\s*:\s*"([^"]+)"/);
  return match ? match[1] : '0.0.0';
  }

  /**
   * 提取 target 列表
   * @private
   */
  _extractTargets(content) {
  const targets = [];
  
  // 找到所有 .target( 的位置
  const targetStarts = [];
  const targetPattern = /\.target\s*\(/g;
  let match;
  
  while ((match = targetPattern.exec(content)) !== null) {
    targetStarts.push(match.index + match[0].length);
  }
  
  // 对每个 .target( 使用括号平衡来找到结束位置
  for (const startPos of targetStarts) {
    // 从 startPos 开始匹配括号
    let depth = 1;
    let endPos = startPos;
    
    while (depth > 0 && endPos < content.length) {
    const char = content[endPos];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    endPos++;
    }
    
    if (depth === 0) {
    // 成功匹配到完整的 target 定义
    const targetContent = content.substring(startPos, endPos - 1);
    
    // 提取 name
    const nameMatch = targetContent.match(/name\s*:\s*"([^"]+)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    
    // 提取 path
    let targetPath = null;
    const pathMatch = targetContent.match(/path\s*:\s*"([^"]+)"/);
    if (pathMatch) {
      targetPath = pathMatch[1];
    }
    
    // 提取 sources
    let sources = null;
    const sourcesMatch = targetContent.match(/sources\s*:\s*\[([^\]]+)\]/);
    if (sourcesMatch) {
      const sourcesStr = sourcesMatch[1];
      const sourceItems = sourcesStr.match(/"([^"]+)"/g);
      if (sourceItems) {
      sources = sourceItems.map(s => s.replace(/"/g, ''));
      }
    }
    
    targets.push({
      name,
      type: 'target',
      path: targetPath,
      sources: sources
    });
    }
  }

  return targets;
  }

  /**
   * 提取依赖
   * @private
   */
  _extractDependencies(content) {
  const deps = [];
  const depRegex = /\.package\s*\(\s*url\s*:\s*"([^"]+)"[^)]*\)/g;
  let match;

  while ((match = depRegex.exec(content)) !== null) {
    deps.push({
    url: match[1],
    type: 'package'
    });
  }

  return deps;
  }

  /**
   * 提取产品
   * @private
   */
  _extractProducts(content) {
  const products = [];
  const productRegex = /\.product\s*\(\s*name\s*:\s*"([^"]+)"[^)]*\)/g;
  let match;

  while ((match = productRegex.exec(content)) !== null) {
    products.push({
    name: match[1],
    type: 'product'
    });
  }

  return products;
  }

  /**
   * 提取平台
   * @private
   */
  _extractPlatforms(content) {
  const platforms = [];
  const platformRegex = /\.iOS\s*\(\s*\.v([0-9.]+)\s*\)|\.macOS\s*\(\s*\.v([0-9.]+)\s*\)|\.tvOS\s*\(\s*\.v([0-9.]+)\s*\)/g;
  let match;

  while ((match = platformRegex.exec(content)) !== null) {
    if (match[1]) platforms.push({ name: 'iOS', version: match[1] });
    if (match[2]) platforms.push({ name: 'macOS', version: match[2] });
    if (match[3]) platforms.push({ name: 'tvOS', version: match[3] });
  }

  return platforms;
  }
}

module.exports = PackageParserV2;
