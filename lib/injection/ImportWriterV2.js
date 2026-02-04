/**
 * ImportWriterV2 - 导入语句写入服务 V2
 * 
 * 职责：
 * - 负责把 import/#import 写入文件（并移除指令标记行）
 * - 负责判断"是否已引入同一头文件/模块头文件"，决定是否需要补充
 * - 负责依赖检查和通知提示
 * 
 * @class ImportWriterV2
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * 导入语句写入器 V2
 * 
 * 使用示例：
 * ```javascript
 * const writer = new ImportWriterV2({
 *   packageParser,
 *   directiveParser,
 *   cacheStore,
 *   notifier
 * });
 * 
 * // 处理模块头文件
 * await writer.handleModuleHeader(specFile, updateFile, header, importArray, isOuter);
 * 
 * // 添加头文件到文件
 * await writer.addHeaderToFile(updateFile, header, isOuter);
 * ```
 */
class ImportWriterV2 {
  constructor(dependencies) {
    this._validateDependencies(dependencies);
    
    this.packageParser = dependencies.packageParser;
    this.directiveParser = dependencies.directiveParser;
    this.cacheStore = dependencies.cacheStore;
    this.notifier = dependencies.notifier;
    this.config = this._parseConfig(dependencies.config || {});
    this.logger = this._createLogger();
    
    // 常量
    this.IMPORT_MARK = '#import';
    this.IMPORT_SWIFT_MARK = 'import';
    this.IMPORT_PATTERN = /^\#import\s*<[A-Za-z0-9_]+\/[A-Za-z0-9_+.-]+\.h>$/;
    this.CURRENT_IMPORT_PATTERN = /^\#import\s*(<.+>|".+")$/;
  }

  // ============ Public API ============

  /**
   * 处理模块头文件
   * 
   * @param {string} specFile - spec 文件路径
   * @param {string} updateFile - 要更新的文件路径
   * @param {Object} header - header 对象
   * @param {string[]} importArray - 已有的 import 列表
   * @param {boolean} isOuter - 是否为外部模块
   */
  async handleModuleHeader(specFile, updateFile, header, importArray, isOuter) {
    try {
      // 读取当前文件的 import 列表
      const currentImportArray = await this._getCurrentImports(updateFile, importArray);
      
      // 确定要检查的头文件名
      const headNameToCheck = this._getHeadNameToCheck(header, isOuter);
      const moduleName = isOuter ? header.specName : header.moduleStrName;
      
      // 检查是否已导入
      const importStatus = this._checkImportStatus(
        currentImportArray,
        headNameToCheck,
        moduleName,
        header.headerName
      );
      
      if (importStatus.hasHeader) {
        await this._handleExistingHeader(specFile, updateFile, header, false, false, isOuter);
        return;
      }
      
      if (importStatus.hasModule) {
        await this._handleExistingHeader(specFile, updateFile, header, false, true, isOuter);
        return;
      }
      
      if (importStatus.hasSimilarHeader) {
        await this._handleExistingHeader(specFile, updateFile, header, true, false, isOuter);
        return;
      }
      
      // 都没有，添加头文件
      await this.addHeaderToFile(updateFile, header, isOuter);
    } catch (e) {
      this.logger.error('处理模块头文件失败', { updateFile, error: e.message });
    }
  }

  /**
   * 添加头文件到文件
   * 
   * @param {string} updateFile - 要更新的文件路径
   * @param {Object} header - header 对象
   * @param {boolean} isOuter - 是否为外部模块
   */
  async addHeaderToFile(updateFile, header, isOuter) {
    try {
      const importLine = this._buildImportLine(header, isOuter);
      await this._writeImportLine(updateFile, importLine, this.IMPORT_MARK);
      await this._checkAndNotify(updateFile, header.moduleName, '自动注入头文件完成。');
    } catch (e) {
      this.logger.error('添加头文件失败', { updateFile, error: e.message });
    }
  }

  /**
   * 移除标记行
   * 
   * @param {string} updateFile - 要更新的文件路径
   * @param {Object} header - header 对象
   * @param {string} message - 提示消息
   */
  async removeMarkFromFile(updateFile, header, message) {
    try {
      await this._writeImportLine(updateFile, null, this.IMPORT_MARK);
      await this._checkAndNotify(updateFile, header.moduleName, message);
    } catch (e) {
      this.logger.error('移除标记行失败', { updateFile, error: e.message });
    }
  }

  /**
   * 处理 Swift 的 import（添加）
   * 
   * @param {string} updateFile - 要更新的文件路径
   * @param {string} moduleName - 模块名
   * @param {string} message - 提示消息
   */
  async addImportToFileSwift(updateFile, moduleName, message) {
    try {
      const importLine = `${this.IMPORT_SWIFT_MARK} ${moduleName}`;
      await this._writeImportLine(updateFile, importLine, this.IMPORT_SWIFT_MARK);
      await this._checkAndNotify(updateFile, moduleName, message);
    } catch (e) {
      this.logger.error('添加 Swift import 失败', { updateFile, error: e.message });
    }
  }

  /**
   * 处理 Swift 的 import（移除标记）
   * 
   * @param {string} updateFile - 要更新的文件路径
   * @param {string} moduleName - 模块名
   * @param {string} message - 提示消息
   */
  async removeMarkFromFileSwift(updateFile, moduleName, message) {
    try {
      await this._writeImportLine(updateFile, null, this.IMPORT_SWIFT_MARK);
      await this._checkAndNotify(updateFile, moduleName, message);
    } catch (e) {
      this.logger.error('移除 Swift 标记失败', { updateFile, error: e.message });
    }
  }

  /**
   * 检查依赖
   * 
   * @param {string} updateFile - 文件路径
   * @param {string} moduleName - 模块名
   * @param {string} message - 基础消息
   */
  async checkDependency(updateFile, moduleName, message) {
    try {
      const slashIndex = updateFile.lastIndexOf('/');
      const thePath = updateFile.substring(0, slashIndex + 1);
      const projectRoot = path.dirname(thePath);
      
      const packagePath = await this.packageParser.findPackageSwiftPath(thePath);
      if (!packagePath) {
        this._notify(message);
        return;
      }
      
      const packageInfo = await this.packageParser.parsePackageSwift(packagePath);
      if (!packageInfo) {
        this._notify(message);
        return;
      }
      
      const packageContent = await fs.promises.readFile(packagePath, 'utf8');
      const hasDependency = this._checkPackageDependency(packageContent, packageInfo, moduleName);
      
      if (hasDependency) {
        this._notify(message);
      } else {
        this._notify(`${message}\nPackage.swift 未发现依赖项，请检查模块是否引入。`);
      }
    } catch (e) {
      this.logger.error('检查依赖失败', { updateFile, error: e.message });
      this._notify(message);
    }
  }

  // ============ Private Methods ============

  /**
   * 获取当前文件的 import 列表
   */
  async _getCurrentImports(updateFile, fallbackArray) {
    try {
      const fileContent = await fs.promises.readFile(updateFile, 'utf8');
      const lineArray = fileContent.split('\n');
      const imports = [];
      
      lineArray.forEach(line => {
        const trimmed = line.trim();
        if (this.CURRENT_IMPORT_PATTERN.test(trimmed)) {
          imports.push(trimmed);
        }
      });
      
      return imports;
    } catch (e) {
      this.logger.warn('读取文件失败，使用备用列表', { updateFile, error: e.message });
      return fallbackArray;
    }
  }

  /**
   * 获取要检查的头文件名
   */
  _getHeadNameToCheck(header, isOuter) {
    if (isOuter) {
      return header.name; // <ModuleName/Header.h>
    }
    
    if (header.relativePathToCurrentFile) {
      return `"${header.relativePathToCurrentFile}"`;
    }
    
    return header.headerStrName;
  }

  /**
   * 检查导入状态
   */
  _checkImportStatus(importArray, headNameToCheck, moduleName, headerName) {
    let hasHeader = false;
    let hasModule = false;
    let hasSimilarHeader = false;
    
    const headerFileNameLower = String(headerName || '').toLowerCase();
    
    for (const importLine of importArray) {
      const importHeader = importLine.split(this.IMPORT_MARK)[1]?.trim() || '';
      
      // 精确匹配头文件
      if (importHeader === headNameToCheck) {
        hasHeader = true;
        break;
      }
      
      // 匹配模块
      if (importHeader === moduleName) {
        hasModule = true;
        break;
      }
      
      // 相似头文件匹配（不区分大小写）
      if (headerFileNameLower) {
        let importedFileName = null;
        
        const angleMatch = importHeader.match(/<([^>]+)>/);
        if (angleMatch) {
          importedFileName = path.basename(angleMatch[1]).toLowerCase();
        }
        
        const quoteMatch = importHeader.match(/"([^"]+)"/);
        if (quoteMatch) {
          importedFileName = path.basename(quoteMatch[1]).toLowerCase();
        }
        
        if (!importedFileName && !importHeader.includes('<') && !importHeader.includes('"')) {
          importedFileName = path.basename(importHeader).toLowerCase();
        }
        
        if (importedFileName === headerFileNameLower) {
          hasSimilarHeader = true;
          break;
        }
      }
    }
    
    return { hasHeader, hasModule, hasSimilarHeader };
  }

  /**
   * 处理已存在的头文件
   */
  async _handleExistingHeader(specFile, updateFile, header, isAddedHeader, isAddedSpecHeader, isOuter) {
    if (isAddedHeader) {
      await this.removeMarkFromFile(updateFile, header, '依赖头文件已存在，不需要额外引入。');
    } else if (isAddedSpecHeader) {
      const isSpecEnough = await this._checkSpecHeader(specFile, header);
      if (isSpecEnough) {
        await this.removeMarkFromFile(updateFile, header, '依赖模块头文件已存在，不需要额外引入。');
      } else {
        await this.addHeaderToFile(updateFile, header, isOuter);
      }
    } else {
      await this.addHeaderToFile(updateFile, header, isOuter);
    }
  }

  /**
   * 检查 spec 头文件
   */
  async _checkSpecHeader(specFile, header) {
    try {
      const headCache = await this.cacheStore.getHeadCache(specFile);
      if (!headCache) {
        return false;
      }
      
      const moduleRootDir = path.dirname(specFile);
      const headRelativePath = headCache[header.headerName];
      
      if (!headRelativePath) {
        return false;
      }
      
      const headPath = path.join(moduleRootDir, headRelativePath);
      const data = await fs.promises.readFile(headPath, 'utf8');
      const lineArray = data.split('\n');
      
      for (const line of lineArray) {
        const trimmed = line.trim();
        if (this.IMPORT_PATTERN.test(trimmed)) {
          const importHeader = trimmed.split(this.IMPORT_MARK)[1]?.trim() || '';
          if (importHeader === header.name) {
            return true;
          }
        }
      }
      
      return false;
    } catch (e) {
      this.logger.warn('检查 spec 头文件失败', { specFile, error: e.message });
      return false;
    }
  }

  /**
   * 构建 import 行
   */
  _buildImportLine(header, isOuter) {
    if (isOuter) {
      return `${this.IMPORT_MARK} ${header.name}`;
    }
    
    if (header.relativePathToCurrentFile) {
      return `${this.IMPORT_MARK} "${header.relativePathToCurrentFile}"`;
    }
    
    return `${this.IMPORT_MARK} ${header.headerStrName}`;
  }

  /**
   * 写入 import 行
   */
  async _writeImportLine(filePath, headerName, currImportMark) {
    return new Promise((resolve, reject) => {
      const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity
      });
      
      let lineIndex = 0;
      let lineCount = 0;
      let markCount = 0;
      
      rl.on('line', (line) => {
        lineIndex++;
        const t = line.trim();
        
        if (t.startsWith(currImportMark)) {
          lineCount = lineIndex;
        }
        
        if (this.directiveParser.isDirective(t)) {
          markCount = lineIndex - 1;
        }
      });
      
      rl.on('close', () => {
        try {
          const data = fs.readFileSync(filePath, 'utf8');
          const lineArray = data.split('\n');
          
          if (headerName) {
            if (markCount !== 0) {
              lineArray.splice(markCount, 1);
              if (markCount < lineCount) {
                lineCount = lineCount - 1;
              }
            }
            lineArray.splice(lineCount, 0, headerName);
          } else {
            if (markCount !== 0) {
              lineArray.splice(markCount, 1);
            }
          }
          
          fs.writeFileSync(filePath, lineArray.join('\n'), 'utf8');
          resolve();
        } catch (err) {
          this.logger.error('写入文件失败', { filePath, error: err.message });
          reject(err);
        }
      });
      
      rl.on('error', (err) => {
        this.logger.error('读取流失败', { filePath, error: err.message });
        reject(err);
      });
    });
  }

  /**
   * 检查 Package 依赖
   */
  _checkPackageDependency(packageContent, packageInfo, moduleName) {
    const dependencyPattern = new RegExp(`\\.package\\([^)]*"([^"]*${moduleName}[^"]*)"`, 'g');
    const targetDependencyPattern = new RegExp(`\\.product\\([^)]*name:\\s*"([^"]*${moduleName}[^"]*)"`, 'g');
    
    return dependencyPattern.test(packageContent) ||
           targetDependencyPattern.test(packageContent) ||
           packageInfo.targets.includes(moduleName);
  }

  /**
   * 检查并通知
   */
  async _checkAndNotify(updateFile, moduleName, message) {
    await this.checkDependency(updateFile, moduleName, message);
  }

  /**
   * 发送通知
   */
  _notify(message) {
    if (this.notifier) {
      this.notifier.notify(message);
    }
  }

  /**
   * 验证依赖
   */
  _validateDependencies(deps) {
    if (!deps.packageParser) {
      throw new Error('ImportWriterV2 requires packageParser');
    }
    if (!deps.directiveParser) {
      throw new Error('ImportWriterV2 requires directiveParser');
    }
    if (!deps.cacheStore) {
      throw new Error('ImportWriterV2 requires cacheStore');
    }
    if (!deps.notifier) {
      throw new Error('ImportWriterV2 requires notifier');
    }
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
    const debug = process.env.DEBUG && process.env.DEBUG.includes('ImportWriterV2');
    return {
      log: (msg, data) => debug && console.log(`[ImportWriterV2] ✓ ${msg}`, data || ''),
      warn: (msg, data) => console.warn(`[ImportWriterV2] ⚠️ ${msg}`, data || ''),
      error: (msg, data) => console.error(`[ImportWriterV2] ❌ ${msg}`, data || '')
    };
  }
}

module.exports = ImportWriterV2;
