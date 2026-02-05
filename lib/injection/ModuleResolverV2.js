/**
 * ModuleResolverV2 - 模块解析服务 V2
 * 
 * 职责：
 * - 推断当前文件所属 target/module（基于 Package.swift 解析结果）
 * - 推断头文件所属 module（基于 headRelativePath + 向上查找 Package.swift）
 * 
 * @class ModuleResolverV2
 */

const fs = require('fs');
const path = require('path');

/**
 * 模块解析器 V2
 * 
 * 使用示例：
 * ```javascript
 * const resolver = new ModuleResolverV2(packageParser);
 * 
 * // 推断当前模块
 * const moduleName = resolver.determineCurrentModule(filePath, packageInfo);
 * 
 * // 推断头文件信息
 * const headerInfo = await resolver.determineHeaderInfo(specFile, header, headRelativePath);
 * ```
 */
class ModuleResolverV2 {
  constructor(packageParser, config = {}) {
  if (!packageParser) {
    throw new Error('ModuleResolverV2 requires packageParser instance');
  }
  
  this.packageParser = packageParser;
  this.config = this._parseConfig(config);
  this.logger = this._createLogger();
  }

  // ============ Public API ============

  /**
   * 推断当前文件所属模块名
   * 
   * @param {string} filePath - 文件路径
   * @param {Object} packageInfo - Package.swift 解析结果
   *   @param {string} packageInfo.path - package 路径
   *   @param {string[]} packageInfo.targets - target 列表
   *   @param {string} packageInfo.name - package 名称
   * @returns {string} 模块名
   */
  determineCurrentModule(filePath, packageInfo) {
  try {
    const relativePath = path.relative(packageInfo.path, filePath);
    const segments = relativePath.split(path.sep);
    
    // 从路径段中查找匹配的 target
    for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    // targets 是对象数组，需要检查 name 属性
    const matchedTarget = packageInfo.targets.find(t => t.name === segment);
    if (matchedTarget) {
      this.logger.log('找到匹配 target', { segment, filePath });
      return segment;
    }
    }
    
    // 如果没找到，返回第一个 target 的 name 或 package 名称
    const fallback = (packageInfo.targets[0] && packageInfo.targets[0].name) || packageInfo.name;
    this.logger.warn('未找到匹配 target，使用默认', { fallback, filePath });
    return fallback;
  } catch (e) {
    this.logger.error('推断当前模块失败', { filePath, error: e.message });
    return packageInfo.name || 'Unknown';
  }
  }

  /**
   * 推断头文件信息
   * 
   * @param {string} specFile - spec 文件路径
   * @param {Object} header - header 对象
   *   @param {string} header.moduleName - 模块名
   * @param {string|null} headRelativePath - 头文件相对路径
   * @returns {Promise<Object>} 头文件信息
   *   @returns {string} moduleName - 推断的模块名
   *   @returns {string|null} headRelativePath - 头文件相对路径
   *   @returns {string|null} relativePathToCurrentFile - 相对于当前文件的路径
   */
  async determineHeaderInfo(specFile, header, headRelativePath) {
  try {
    let moduleName = header.moduleName;
    
    // 如果没有相对路径，直接返回
    if (!headRelativePath) {
    this.logger.log('没有相对路径，使用原模块名', { moduleName });
    return {
      moduleName,
      headRelativePath: null,
      relativePathToCurrentFile: null
    };
    }
    
    const rootSpecDir = path.dirname(specFile);
    const projectRoot = this.config.projectRoot || path.dirname(rootSpecDir) || rootSpecDir;
    let headPath = this._resolveHeadPath(rootSpecDir, projectRoot, headRelativePath);
    
    if (!fs.existsSync(headPath)) {
    this.logger.warn('头文件不存在，尝试查找', { headPath });
    const matchedPath = this._findHeaderPathByRelative(projectRoot, headRelativePath);
    if (matchedPath) {
      headPath = matchedPath;
      this.logger.log('在项目中匹配到头文件', { headPath });
    }
    }
    
    // 查找头文件所属的 package
    const headerSearchDir = path.dirname(headPath);
    const headerPackagePath = await this.packageParser.findPackageSwiftPath(headerSearchDir);
    if (!headerPackagePath) {
    this.logger.warn('未找到头文件所属 package', { headPath });
    return {
      moduleName,
      headRelativePath,
      relativePathToCurrentFile: null
    };
    }
    
    // 解析 package 信息
    const headerPackageInfo = await this.packageParser.parsePackageSwift(headerPackagePath);
    if (!headerPackageInfo) {
    this.logger.warn('解析头文件 package 失败', { headerPackagePath });
    return {
      moduleName,
      headRelativePath,
      relativePathToCurrentFile: null
    };
    }
    
    // 推断模块名
    moduleName = this.determineCurrentModule(headPath, headerPackageInfo);
    this.logger.log('推断出头文件模块', { moduleName, headPath });
    
    return {
    moduleName,
    headRelativePath,
    relativePathToCurrentFile: null
    };
  } catch (e) {
    this.logger.error('推断头文件信息失败', { specFile, error: e.message });
    return {
    moduleName: header.moduleName,
    headRelativePath,
    relativePathToCurrentFile: null
    };
  }
  }

  // ============ Private Methods ============

  /**
   * 解析 headRelativePath 为绝对路径（优先 spec 目录，其次 projectRoot）
   */
  _resolveHeadPath(rootSpecDir, projectRoot, headRelativePath) {
  if (!headRelativePath) return headRelativePath;
  if (path.isAbsolute(headRelativePath)) return headRelativePath;

  const candidates = [
    path.join(rootSpecDir, headRelativePath)
  ];
  if (projectRoot && projectRoot !== rootSpecDir) {
    candidates.push(path.join(projectRoot, headRelativePath));
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  return candidates[0];
  }

  /**
   * 在项目中按相对路径后缀查找头文件
   */
  _findHeaderPathByRelative(projectRoot, headRelativePath) {
  try {
    if (!projectRoot || !headRelativePath) return null;
    const normalizedSuffix = path.normalize(headRelativePath);
    const fileName = path.basename(headRelativePath);
    const ignoreDirs = new Set([
    '.git', '.build', '.swiftpm', '.autosnippet', 'node_modules', 'Pods',
    'Carthage', 'DerivedData', 'build', 'AutoSnippet'
    ]);

    const stack = [projectRoot];
    const maxDepth = this.config.searchDepth ?? 8;

    while (stack.length) {
    const dir = stack.pop();
    const rel = path.relative(projectRoot, dir);
    const depth = rel ? rel.split(path.sep).length : 0;
    if (depth > maxDepth) continue;

    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }

    for (const name of entries) {
      const fullPath = path.join(dir, name);
      let stat;
      try {
      stat = fs.statSync(fullPath);
      } catch {
      continue;
      }

      if (stat.isDirectory()) {
      if (ignoreDirs.has(name)) continue;
      stack.push(fullPath);
      continue;
      }

      if (stat.isFile() && name === fileName) {
      if (path.normalize(fullPath).endsWith(normalizedSuffix)) {
        return fullPath;
      }
      }
    }
    }
  } catch (e) {
    this.logger.warn('项目内匹配头文件失败', { error: e.message });
  }
  return null;
  }

  /**
   * 解析配置
   */
  _parseConfig(config) {
  return {
    debug: config.debug || false,
    ...config
  };
  }

  /**
   * 创建日志记录器
   */
  _createLogger() {
  const debug = process.env.DEBUG && process.env.DEBUG.includes('ModuleResolverV2');
  return {
    log: (msg, data) => debug && console.log(`[ModuleResolverV2] ✓ ${msg}`, data || ''),
    warn: (msg, data) => console.warn(`[ModuleResolverV2] ⚠️ ${msg}`, data || ''),
    error: (msg, data) => console.error(`[ModuleResolverV2] ❌ ${msg}`, data || '')
  };
  }
}

module.exports = ModuleResolverV2;
