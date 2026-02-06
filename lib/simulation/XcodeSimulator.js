/**
 * XcodeSimulator
 * 
 * 职责：
 * - 虚拟 Xcode 模拟器主入口
 * - 集成所有子模块
 * - 提供高级 API 用于场景测试
 * - 管理模拟器生命周期
 */

const VirtualFileSystem = require('./VirtualFileSystem');
const EditorState = require('./EditorState');
const DirectiveEmulator = require('./DirectiveEmulator');
const XcodeSimulatorAPIClient = require('./XcodeSimulatorAPIClient');
const OperationExecutor = require('./OperationExecutor');
const PermissionManager = require('./PermissionManager');

class XcodeSimulator {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.dashboardUrl = options.dashboardUrl || 'http://localhost:3000';
    this.autoWait = options.autoWait !== false;
    this.logger = options.logger || console;

    // 初始化各个子模块
    this.vfs = new VirtualFileSystem({
      projectRoot: this.projectRoot,
      syncToDisk: options.syncToDisk || false,
      logger: this.logger
    });

    this.editor = new EditorState({
      logger: this.logger
    });

    this.detector = new DirectiveEmulator({
      logger: this.logger
    });

    this.apiClient = new XcodeSimulatorAPIClient(this.dashboardUrl, {
      timeout: options.apiTimeout || 10000,
      retryAttempts: options.retryAttempts || 3,
      logger: this.logger
    });

    this.executor = new OperationExecutor({
      apiClient: this.apiClient,
      vfs: this.vfs,
      editorState: this.editor,
      directiveEmulator: this.detector,
      logger: this.logger
    });

    this.permissionManager = new PermissionManager({
      projectRoot: this.projectRoot,
      dashboardUrl: this.dashboardUrl,
      apiClient: this.apiClient,
      logger: this.logger
    });

    this.isInitialized = false;
    this.simulatorState = 'created';  // created, initialized, running, stopped
  }

  /**
   * 初始化模拟器
   * @param {object} options - { loadExisting, autoHealthCheck }
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async init(options = {}) {
    const { loadExisting = false, autoHealthCheck = true } = options;

    try {
      this.logger.log('[XcodeSimulator] Initializing...');
      this.simulatorState = 'initializing';

      // 1. 初始化虚拟文件系统
      await this.vfs.init({ loadExisting, rootPath: this.projectRoot });

      // 2. 如果启用，检查 Dashboard 健康状态
      if (autoHealthCheck) {
        const health = await this.apiClient.healthCheck();
        if (!health.healthy) {
          throw new Error(
            `Dashboard not healthy: ${health.error || 'Unknown error'}`
          );
        }
        this.logger.log('[XcodeSimulator] Dashboard health check passed');

        // 3. 发现 asd ui 运行的项目位置
        try {
          await this.permissionManager.discoverDashboard();
          this.logger.log('[XcodeSimulator] Project discovery passed');
        } catch (discoverError) {
          this.logger.warn(`[XcodeSimulator] Project discovery failed: ${discoverError.message}`);
          // 不中断初始化，继续使用默认项目根
        }
      }

      this.isInitialized = true;
      this.simulatorState = 'ready';
      this.logger.log('[XcodeSimulator] Initialization completed');

      return { success: true, message: 'Simulator initialized successfully' };
    } catch (error) {
      this.logger.error(`[XcodeSimulator] Initialization failed: ${error.message}`);
      this.simulatorState = 'failed';
      throw error;
    }
  }

  /**
   * 打开虚拟文件
   * @param {string} filePath - 文件路径
   * @param {string} content - 文件内容
   * @returns {object}
   */
  openFile(filePath, content) {
    this._checkInitialized();
    
    // 同时在虚拟文件系统和编辑器中打开
    this.vfs.writeFile(filePath, content, { createIfNotExists: true });
    this.editor.openFile(filePath, content);
    
    this.logger.log(`[XcodeSimulator] Opened file: ${filePath}`);
    return this.editor.getCurrentState();
  }

  /**
   * 关闭当前文件
   */
  closeFile() {
    this._checkInitialized();
    
    const filePath = this.editor.getCurrentFile()?.path;
    
    // 同时在编辑器和虚拟文件系统中关闭
    const currentContent = this.editor.getContent();
    if (filePath && currentContent) {
      this.vfs.writeFile(filePath, currentContent);
    }
    
    this.editor.closeFile();
    
    if (filePath) {
      this.logger.log(`[XcodeSimulator] Closed file: ${filePath}`);
    }
  }

  /**
   * 保存当前文件
   * @returns {boolean}
   */
  saveFile() {
    this._checkInitialized();
    
    const currentFile = this.editor.getCurrentFile();
    if (!currentFile) return false;
    
    this.vfs.writeFile(
      currentFile.path,
      this.editor.getContent(),
      { overwrite: true }
    );
    
    this.editor.currentFile.unsaved = false;
    this.logger.log(`[XcodeSimulator] Saved file: ${currentFile.path}`);
    
    return true;
  }

  /**
   * 检测当前文件中的指令
   * @returns {array}
   */
  detectDirectives() {
    this._checkInitialized();
    
    const currentFile = this.editor.getCurrentFile();
    if (!currentFile) return [];
    
    return this.detector.scan(currentFile.content, currentFile.path);
  }

  /**
   * 处理单个指令
   * @param {object} directive
   * @returns {Promise<object>}
   */
  async handleDirective(directive) {
    this._checkInitialized();
    return this.executor.executeDirective(directive);
  }

  /**
   * 搜索 Recipe 并插入
   * @param {string} keyword
   * @param {number} lineNumber - 可选，指定插入位置
   * @returns {Promise<object>}
   */
  async search(keyword, lineNumber) {
    this._checkInitialized();
    
    const currentFile = this.editor.getCurrentFile();
    return this.executor.executeSearch({
      keyword,
      filePath: currentFile?.path,
      lineNumber: lineNumber ?? currentFile?.lineCount,
      insertMode: 'replace'
    });
  }

  /**
   * 创建 Candidate
   * @param {string} code - 代码内容
   * @param {string} description - 描述
   * @returns {Promise<object>}
   */
  async createCandidate(code, description = '') {
    this._checkInitialized();
    
    const currentFile = this.editor.getCurrentFile();
    return this.executor.executeCreate({
      filePath: currentFile?.path,
      code,
      description
    });
  }

  /**
   * 执行代码审查
   * @param {string} keyword - 可选的关键字
   * @returns {Promise<object>}
   */
  async audit(keyword = '') {
    this._checkInitialized();
    
    const currentFile = this.editor.getCurrentFile();
    return this.executor.executeAudit({
      filePath: currentFile?.path,
      keyword,
      scope: 'file'
    });
  }

  /**
   * 验证断言 - 文件内容
   */
  assertFileContent(filePath, expectedContent) {
    const actual = this.vfs.readFile(filePath);
    
    if (typeof expectedContent === 'string') {
      if (actual !== expectedContent) {
        throw new Error(`File content mismatch at ${filePath}`);
      }
    } else if (expectedContent instanceof RegExp) {
      if (!expectedContent.test(actual)) {
        throw new Error(`File content doesn't match pattern at ${filePath}`);
      }
    } else if (typeof expectedContent === 'function') {
      if (!expectedContent(actual)) {
        throw new Error(`File content validation failed at ${filePath}`);
      }
    }
    
    return true;
  }

  /**
   * 验证断言 - 搜索结果
   */
  assertSearchResult(result, expectations) {
    if (expectations.hasResults && (!result.results || result.results.length === 0)) {
      throw new Error('Expected search results but none found');
    }

    if (expectations.resultCount && result.results.length !== expectations.resultCount) {
      throw new Error(`Expected ${expectations.resultCount} results, got ${result.results.length}`);
    }

    if (expectations.hasKeyword && !result.selectedRecipe?.keyword) {
      throw new Error('Expected recipe to have keyword');
    }

    return true;
  }

  /**
   * 验证断言 - 操作成功
   */
  assertOperationSuccess(result, type) {
    if (!result || result.status !== 'success') {
      throw new Error(`${type} operation failed: ${result?.message || 'Unknown error'}`);
    }
    return true;
  }

  /**
   * 获取模拟器状态
   */
  getState() {
    return {
      simulatorState: this.simulatorState,
      isInitialized: this.isInitialized,
      projectRoot: this.projectRoot,
      dashboardUrl: this.dashboardUrl,
      vfs: this.vfs.getStats(),
      currentFile: this.editor.getCurrentFile(),
      caret: this.editor.getCaret(),
      clipboard: this.editor.getClipboard()
    };
  }

  /**
   * 获取完整信息（包括历史）
   */
  getFullState() {
    return {
      ...this.getState(),
      operationHistory: this.executor.getHistory(),
      fileSystemHistory: this.vfs.getChangeHistory(),
      editorHistory: this.editor.getHistory()
    };
  }

  /**
   * 重置模拟器
   */
  reset() {
    this.vfs.clear();
    this.editor.currentFile = null;
    this.editor.history = [];
    this.executor.reset();
    
    this.logger.log('[XcodeSimulator] Reset completed');
  }

  /**
   * 停止模拟器
   */
  stop() {
    this.closeFile();
    this.reset();
    this.simulatorState = 'stopped';
    
    this.logger.log('[XcodeSimulator] Stopped');
  }

  /**
   * 获取操作历史
   */
  getOperationHistory() {
    return this.executor.getHistory();
  }

  /**
   * 获取操作统计
   */
  getOperationStats() {
    return this.executor.getStats();
  }

  /**
   * 检查是否已初始化
   */
  _checkInitialized() {
    if (!this.isInitialized) {
      throw new Error('Simulator not initialized. Call init() first.');
    }
  }

  /**
   * 申请文件权限（真实环境）
   * @param {string} targetPath - 目标文件或目录路径
   * @returns {Promise<{ok, message, projectRoot, reason}>}
   */
  async requestPermission(targetPath) {
    this._checkInitialized();
    return this.permissionManager.requestPermission(targetPath);
  }

  /**
   * 获取权限检查历史
   */
  getPermissionHistory() {
    return this.permissionManager.getHistory();
  }

  /**
   * 获取权限统计
   */
  getPermissionStats() {
    return this.permissionManager.getStats();
  }

  /**
   * 获取发现的项目根目录
   */
  async getDiscoveredProjectRoot() {
    return this.permissionManager.getProjectRoot();
  }

  /**
   * 禁用权限检查（测试模式）
   */
  disablePermissionChecks() {
    this.permissionManager.disableChecks();
  }

  /**
   * 启用权限检查
   */
  enablePermissionChecks() {
    this.permissionManager.enableChecks();
  }

  /**
   * 导出模拟器数据（用于报告）
   */
  export() {
    return {
      timestamp: new Date().toISOString(),
      projectRoot: this.projectRoot,
      discoveredProjectRoot: this.permissionManager.dashboardProjectRoot,
      permissions: this.getPermissionStats(),
      state: this.getFullState()
    };
  }
}

module.exports = XcodeSimulator;
