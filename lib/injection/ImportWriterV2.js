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
const { spawnSync } = require('child_process');
const ClipboardManager = require('../infrastructure/notification/ClipboardManager');

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
    const importLineWithNote = this._withAutoSnippetNote(importLine);
    console.log('[ImportWriterV2] addHeaderToFile:', {
    isOuter,
    importLine,
    headerName: header.headerName,
    relativePathToCurrentFile: header.relativePathToCurrentFile,
    headerStrName: header.headerStrName
    });
    const directiveReplacement = header && header.dependencyNote ? header.dependencyNote : null;
    await this._writeImportLine(updateFile, importLineWithNote, this.IMPORT_MARK, { directiveReplacement });
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
    const importLineWithNote = this._withAutoSnippetNote(importLine);
    await this._writeImportLine(updateFile, importLineWithNote, this.IMPORT_SWIFT_MARK);
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
  // 判断原始格式：引号格式 vs 尖括号格式
  // 引号格式：moduleName 为空
  // 尖括号格式：moduleName 有值
  const isOriginalQuoted = !header.moduleName || header.moduleName === '';
  
  // 外部模块（跨 target）：始终使用尖括号格式
  if (isOuter) {
    if (header.moduleName && header.headerName) {
    return `${this.IMPORT_MARK} <${header.moduleName}/${header.headerName}>`;
    }
    return `${this.IMPORT_MARK} ${header.name}`;
  }
  
  // 内部引用（同一 target）
  // 如果有相对路径：使用引号格式
  if (header.relativePathToCurrentFile) {
    return `${this.IMPORT_MARK} "${header.relativePathToCurrentFile}"`;
  }
  
  // 原始就是引号格式：使用引号格式
  if (isOriginalQuoted) {
    return `${this.IMPORT_MARK} "${header.headerName}"`;
  }
  
  // 原始是尖括号格式但没找到路径：回退到尖括号格式
  // 这样至少能保持原始格式的语义
  if (header.moduleName && header.headerName) {
    return `${this.IMPORT_MARK} <${header.moduleName}/${header.headerName}>`;
  }
  
  // 最后的后备方案
  if (header.headerName) {
    return `${this.IMPORT_MARK} "${header.headerName}"`;
  }
  
  return `${this.IMPORT_MARK} ${header.headerStrName}`;
  }

  /**
   * 写入 import 行
   */
  async _writeImportLine(filePath, headerName, currImportMark, options = {}) {
  if (process.platform === 'darwin') {
    try {
    const ok = this._writeImportLineXcode(filePath, headerName, currImportMark, options);
    if (ok) return;
    } catch (e) {
    this.logger.warn('Xcode 自动插入失败，回退到文件写入', { filePath, error: e.message });
    }
  }
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
      const directiveReplacement = options && options.directiveReplacement
      ? String(options.directiveReplacement)
      : null;
      const data = fs.readFileSync(filePath, 'utf8');
      const lineArray = data.split('\n');
      
      if (headerName) {
      if (markCount !== 0) {
        if (directiveReplacement) {
        lineArray.splice(markCount, 1, directiveReplacement);
        } else {
        lineArray.splice(markCount, 1);
        }
        if (markCount < lineCount) {
        lineCount = lineCount - 1;
        }
      }
      lineArray.splice(lineCount, 0, headerName);
      } else {
      if (markCount !== 0) {
        if (directiveReplacement) {
        lineArray.splice(markCount, 1, directiveReplacement);
        } else {
        lineArray.splice(markCount, 1);
        }
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

  _writeImportLineXcode(filePath, headerName, currImportMark, options = {}) {
  console.log('[_writeImportLineXcode] 开始执行:', {
    filePath,
    headerName,
    currImportMark
  });
  
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  let lastImportIdx = -1;
  let markLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = String(lines[i] || '').trim();
    if (this.directiveParser.isDirective(trimmed)) {
    markLine = i;
    }
    if (currImportMark === this.IMPORT_SWIFT_MARK) {
    if (trimmed.startsWith(this.IMPORT_SWIFT_MARK + ' ')) {
      lastImportIdx = i;
    }
    } else {
    if (trimmed.startsWith('#import ') || trimmed.startsWith('#include ') || trimmed.startsWith('@import ')) {
      lastImportIdx = i;
    }
    }
  }

  let insertLine = lastImportIdx >= 0 ? lastImportIdx + 2 : 1; // 1-based
  const directiveLine = markLine >= 0 ? markLine + 1 : 0;

  console.log('[_writeImportLineXcode] 行号信息:', {
    lastImportIdx,
    markLine,
    insertLine,
    directiveLine,
    hasHeaderName: !!headerName
  });

  if (!headerName && directiveLine <= 0) return true;

  const directiveReplacement = options && options.directiveReplacement
    ? String(options.directiveReplacement)
    : null;

  // 删除 directive 行后，插入行需要 -1（替换不需要）
  if (!directiveReplacement && headerName && directiveLine > 0 && directiveLine <= insertLine) {
    insertLine = Math.max(1, insertLine - 1);
  }

  const previousClipboard = ClipboardManager.read();

  const args = [
    '-e', 'tell application "Xcode" to activate',
    '-e', 'delay 0.5',
    '-e', 'tell application "System Events"'
  ];

  // 步骤1：处理 directive 行（替换或删除）
  if (directiveLine > 0) {
    args.push('-e', 'keystroke "l" using command down');
    args.push('-e', 'delay 0.3');
    args.push('-e', `keystroke "${this._escapeAppleScriptString(String(directiveLine))}"`);
    args.push('-e', 'delay 0.3');
    args.push('-e', 'key code 36');
    args.push('-e', 'delay 0.3');
    args.push('-e', 'key code 123 using command down');
    args.push('-e', 'delay 0.2');
    args.push('-e', 'key code 124 using {command down, shift down}');
    args.push('-e', 'delay 0.2');
    if (directiveReplacement) {
    const noteToWrite = String(directiveReplacement).trim() + '\n';
    ClipboardManager.write(noteToWrite);
    args.push('-e', 'keystroke "v" using command down');
    args.push('-e', 'delay 0.3');
    } else {
    args.push('-e', 'key code 51'); // Delete 键删除选中内容
    args.push('-e', 'delay 0.3');
    }
  }

  args.push('-e', 'end tell');

  // 先执行删除 directive 的操作
  console.log('[_writeImportLineXcode] 执行处理 directive...');
  const deleteRes = spawnSync('osascript', args, { stdio: 'ignore' });
  if (deleteRes.status !== 0) {
    console.log('[_writeImportLineXcode] 处理 directive 失败');
    return false;
  }

  // 步骤2：插入 import 语句
  if (headerName) {
    // 在两次 AppleScript 调用之间设置剪贴板（此时 directive 已删除）
    const contentToWrite = String(headerName).trim() + '\n';
    console.log('[_writeImportLineXcode] 写入剪贴板内容:', JSON.stringify(contentToWrite));
    ClipboardManager.write(contentToWrite);
    
    const insertArgs = [
    '-e', 'tell application "Xcode" to activate',
    '-e', 'delay 0.3',
    '-e', 'tell application "System Events"',
    '-e', 'keystroke "l" using command down',
    '-e', 'delay 0.3',
    '-e', `keystroke "${this._escapeAppleScriptString(String(insertLine))}"`,
    '-e', 'delay 0.3',
    '-e', 'key code 36',
    '-e', 'delay 0.3',
    '-e', 'key code 123 using command down',
    '-e', 'delay 0.2',
    '-e', 'keystroke "v" using command down',
    '-e', 'delay 0.3',
    '-e', 'end tell'
    ];

    console.log('[_writeImportLineXcode] 执行插入 import...');
    const insertRes = spawnSync('osascript', insertArgs, { stdio: 'ignore' });
    console.log('[_writeImportLineXcode] AppleScript 结果:', {
    status: insertRes.status,
    success: insertRes.status === 0
    });
    
    if (insertRes.status !== 0) {
    if (typeof previousClipboard === 'string') {
      ClipboardManager.write(previousClipboard);
    }
    return false;
    }
  }

  if (typeof previousClipboard === 'string') {
    ClipboardManager.write(previousClipboard);
  }
  return true;
  }

  _escapeAppleScriptString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  _withAutoSnippetNote(importLine) {
  if (!importLine) return importLine;
  const note = '// AutoSnippet: 自动插入';
  if (importLine.includes(note)) return importLine;
  return `${importLine} ${note}`;
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
