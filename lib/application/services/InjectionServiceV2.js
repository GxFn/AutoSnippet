/**
 * InjectionService V2 - 代码注入服务升级版本
 * 
 * 职责：
 * - 解析代码中的注入指令
 * - 管理导入语句
 * - 解析和处理模块路径
 * - 验证和执行代码注入
 * 
 * @class InjectionServiceV2
 * @example
 * const service = new InjectionServiceV2(projectRoot);
 * await service.injectImport(filePath, { 'lodash': 'import _ from "lodash"' });
 */

const fs = require('fs');
const path = require('path');

// 懒加载，避免循环依赖
let ImportWriter, ModuleResolver, DirectiveParser;

class InjectionServiceV2 {
  constructor(projectRoot, config = {}) {
  this._validateProjectRoot(projectRoot);
  
  this.projectRoot = projectRoot;
  this.config = this._parseConfig(config);
  this.logger = this._createLogger();
  
  // 延迟加载依赖
  this._initDependencies();
  }

  /**
   * 初始化依赖
   * @private
   */
  _initDependencies() {
  try {
    if (!ImportWriter) ImportWriter = require('../../injection/ImportWriterV2');
    if (!ModuleResolver) ModuleResolver = require('../../injection/ModuleResolverV2');
    if (!DirectiveParser) DirectiveParser = require('../../injection/DirectiveParserV2');

    this.importWriter = new ImportWriter(this.config.importConfig);
    this.moduleResolver = new ModuleResolver(this.projectRoot, this.config.resolverConfig);
    this.directiveParser = new DirectiveParser(this.config.parserConfig);
  } catch (e) {
    if (this.logger) {
    this.logger.warn('Failed to load dependencies', { error: e.message });
    }
    // 继续运行，在需要时才报错
  }
  }

  // ============ Public API ============

  /**
   * 在文件中注入导入语句
   * 
   * @param {string} filePath - 目标文件路径
   * @param {Object} imports - 导入对象 { 'module': 'import statement' }
   * @param {Object} options - 选项
   * @returns {Promise<boolean>} 是否成功
   */
  async injectImport(filePath, imports, options = {}) {
  try {
    this._validateFilePath(filePath);

    const code = fs.readFileSync(filePath, 'utf8');

    // 处理每个导入
    let updated = code;
    for (const [moduleName, statement] of Object.entries(imports)) {
    // 解析导入语句
    const parsed = this._parseImportStatement(statement);
    
    // 检查是否已存在
    if (!this._importExists(updated, parsed)) {
      // 找到合适的插入位置
      const position = this._findImportInsertPosition(updated);
      updated = this._insertImport(updated, statement, position);
    }
    }

    // 验证修改后的代码
    if (!this._validateSyntax(updated)) {
    throw new Error('Modified code has syntax errors');
    }

    // 写回文件
    fs.writeFileSync(filePath, updated, 'utf8');
    this.logger.log('Import injected', { filePath, count: Object.keys(imports).length });

    return true;
  } catch (e) {
    this.logger.error('Inject import failed', { filePath, error: e.message });
    return false;
  }
  }

  /**
   * 在文件中注入代码
   * 
   * @param {string} filePath - 目标文件路径
   * @param {string} code - 要注入的代码
   * @param {Object} options - 选项
   *   @param {number} options.line - 注入行号
   *   @param {string} options.position - 注入位置（before, after）
   *   @param {string} options.marker - 标记（注释）
   * 
   * @returns {Promise<boolean>} 是否成功
   */
  async injectCode(filePath, code, options = {}) {
  try {
    this._validateFilePath(filePath);

    let content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    // 确定注入位置
    const insertLine = options.line || lines.length;
    const marker = options.marker ? `// ${options.marker}\n` : '';

    // 构建注入内容
    const injectedCode = `${marker}${code}`;

    // 插入代码
    if (options.position === 'before') {
    lines.splice(insertLine, 0, injectedCode);
    } else {
    lines.splice(insertLine + 1, 0, injectedCode);
    }

    const updated = lines.join('\n');

    // 验证
    if (!this._validateSyntax(updated)) {
    throw new Error('Modified code has syntax errors');
    }

    // 写回
    fs.writeFileSync(filePath, updated, 'utf8');
    this.logger.log('Code injected', { filePath, line: insertLine });

    return true;
  } catch (e) {
    this.logger.error('Inject code failed', { filePath, error: e.message });
    return false;
  }
  }

  /**
   * 注入 Snippet
   * 
   * @param {string} filePath - 目标文件路径
   * @param {Object} snippet - Snippet 对象 { completion, body 等 }
   * @param {Object} options - 选项
   * @returns {Promise<boolean>} 是否成功
   */
  async injectSnippet(filePath, snippet, options = {}) {
  try {
    const code = Array.isArray(snippet.body) 
    ? snippet.body.join('\n') 
    : snippet.body;

    // 如果有依赖，先注入导入
    if (snippet.imports) {
    await this.injectImport(filePath, snippet.imports, options);
    }

    // 注入代码
    return await this.injectCode(filePath, code, {
    marker: `Snippet: ${snippet.completion}`,
    ...options
    });
  } catch (e) {
    this.logger.error('Inject snippet failed', { filePath, error: e.message });
    return false;
  }
  }

  /**
   * 解析文件中的注入指令
   * 
   * @param {string} filePath - 文件路径
   * @returns {Promise<Object[]>} 指令列表
   */
  async parseDirectives(filePath) {
  try {
    const code = fs.readFileSync(filePath, 'utf8');
    return this.directiveParser.parse(code);
  } catch (e) {
    this.logger.error('Parse directives failed', { filePath, error: e.message });
    return [];
  }
  }

  /**
   * 解析模块路径
   * 
   * @param {string} moduleName - 模块名称
   * @param {string} fromFile - 来自哪个文件（用于相对路径解析）
   * @returns {Promise<string>} 解析后的模块路径
   */
  async resolveModulePath(moduleName, fromFile) {
  try {
    return await this.moduleResolver.resolve(moduleName, fromFile);
  } catch (e) {
    this.logger.error('Resolve module path failed', { moduleName, error: e.message });
    throw e;
  }
  }

  /**
   * 验证代码是否能注入
   * 
   * @param {string} code - 代码
   * @returns {boolean} 是否有效
   */
  validateCode(code) {
  return this._validateSyntax(code);
  }

  /**
   * 获取可注入的位置
   * 
   * @param {string} filePath - 文件路径
   * @returns {Object} 位置信息
   */
  getInjectablePositions(filePath) {
  try {
    const code = fs.readFileSync(filePath, 'utf8');
    const lines = code.split('\n');

    return {
    totalLines: lines.length,
    importEnd: this._findImportInsertPosition(code),
    endOfFile: lines.length,
    suggestedPosition: this._findBestPosition(code)
    };
  } catch (e) {
    this.logger.error('Get injectable positions failed', { filePath, error: e.message });
    return {};
  }
  }

  // ============ Private Methods ============

  /**
   * 验证项目根目录
   * @private
   */
  _validateProjectRoot(projectRoot) {
  if (!projectRoot || typeof projectRoot !== 'string') {
    throw new Error('projectRoot must be a non-empty string');
  }
  }

  /**
   * 验证文件路径
   * @private
   */
  _validateFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('filePath must be a non-empty string');
  }

  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.projectRoot, filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }
  }

  /**
   * 解析配置
   * @private
   */
  _parseConfig(config) {
  return {
    language: config.language || 'javascript',
    validateSyntax: config.validateSyntax !== false,
    ...config
  };
  }

  /**
   * 解析导入语句
   * @private
   */
  _parseImportStatement(statement) {
  // 简单的正则匹配，可扩展支持更复杂的语法
  const match = statement.match(/import\s+(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/);
  if (match) {
    return {
    type: 'import',
    imports: match[1] || match[2],
    from: match[3]
    };
  }
  return { type: 'unknown' };
  }

  /**
   * 检查导入是否存在
   * @private
   */
  _importExists(code, parsed) {
  if (parsed.type !== 'import') return false;

  const importRegex = new RegExp(
    `import\\s+.*from\\s+['"]${parsed.from}['"]`,
    'g'
  );

  return importRegex.test(code);
  }

  /**
   * 找到最佳的导入插入位置
   * @private
   */
  _findImportInsertPosition(code) {
  const lines = code.split('\n');
  let lastImportLine = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^\s*(?:import|require)/)) {
    lastImportLine = i;
    } else if (lastImportLine !== -1 && lines[i].trim() !== '') {
    break;
    }
  }

  return lastImportLine + 1;
  }

  /**
   * 插入导入语句
   * @private
   */
  _insertImport(code, statement, position) {
  const lines = code.split('\n');
  lines.splice(position, 0, statement);
  return lines.join('\n');
  }

  /**
   * 验证代码语法
   * @private
   */
  _validateSyntax(code) {
  if (!this.config.validateSyntax) return true;

  try {
    // 简单的语法检查
    new Function(code);
    return true;
  } catch (e) {
    return false;
  }
  }

  /**
   * 找到最佳的代码插入位置
   * @private
   */
  _findBestPosition(code) {
  const lines = code.split('\n');
  
  // 找到最后一个顶级函数或类的结尾
  let bestLine = lines.length - 1;
  
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].match(/^(class|function|const|let|var)\s+/)) {
    bestLine = i;
    break;
    }
  }

  return bestLine;
  }

  /**
   * 创建 logger
   * @private
   */
  _createLogger() {
  return {
    log: (msg, data) => {
    if (process.env.DEBUG) {
      console.log(`[InjectionServiceV2] ${msg}`, data ? JSON.stringify(data) : '');
    }
    },
    warn: (msg, data) => {
    console.warn(`[InjectionServiceV2] ⚠️ ${msg}`, data ? JSON.stringify(data) : '');
    },
    error: (msg, data) => {
    console.error(`[InjectionServiceV2] ❌ ${msg}`, data ? JSON.stringify(data) : '');
    }
  };
  }
}

module.exports = InjectionServiceV2;
