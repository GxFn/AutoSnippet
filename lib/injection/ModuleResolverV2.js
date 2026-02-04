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
        if (packageInfo.targets.includes(segment)) {
          this.logger.log('找到匹配 target', { segment, filePath });
          return segment;
        }
      }
      
      // 如果没找到，返回第一个 target 或 package 名称
      const fallback = packageInfo.targets[0] || packageInfo.name;
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
      const projectRoot = rootSpecDir;
      let headPath = path.join(rootSpecDir, headRelativePath);
      
      // 如果文件不存在，尝试通过 package 查找
      if (!fs.existsSync(headPath)) {
        this.logger.warn('头文件不存在，尝试查找', { headPath });
        const headerPackagePath = await this.packageParser.findPackageSwiftPath(headPath);
        if (headerPackagePath) {
          const headerPackageInfo = await this.packageParser.parsePackageSwift(headerPackagePath);
          if (headerPackageInfo) {
            const headerModuleRootDir = path.dirname(headerPackagePath);
            headPath = path.join(headerModuleRootDir, headRelativePath);
            this.logger.log('通过 package 找到路径', { headPath });
          }
        }
      }
      
      // 查找头文件所属的 package
      const headerPackagePath = await this.packageParser.findPackageSwiftPath(headPath);
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
