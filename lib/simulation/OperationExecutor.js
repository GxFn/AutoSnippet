/**
 * OperationExecutor
 * 
 * 职责：
 * - 执行模拟操作（搜索、创建、审查）
 * - 管理操作序列
 * - 记录操作历史
 * - 处理权限检查
 */

class OperationExecutor {
  constructor(options = {}) {
    this.apiClient = options.apiClient;
    this.vfs = options.vfs;  // VirtualFileSystem
    this.editorState = options.editorState;  // EditorState
    this.directiveEmulator = options.directiveEmulator;  // DirectiveEmulator
    this.logger = options.logger || console;
    
    this.operationHistory = [];
    this.currentOperation = null;
  }

  /**
   * 执行搜索操作
   * @param {object} params - { keyword, filePath, lineNumber, insertMode }
   * @returns {Promise<{status, results, selectedIndex, insertedText}>}
   */
  async executeSearch(params) {
    const {
      keyword,
      filePath,
      lineNumber,
      insertMode = 'replace'  // 'replace', 'insert', 'append'
    } = params;

    if (!keyword) {
      throw new Error('Keyword is required');
    }

    const operation = {
      type: 'SEARCH',
      params,
      startTime: Date.now(),
      status: 'running'
    };

    this.currentOperation = operation;

    try {
      // 1. 调用搜索 API
      this.logger.log(`[OperationExecutor] Searching for: ${keyword}`);
      const searchResult = await this.apiClient.search(keyword);

      if (!searchResult.results || searchResult.results.length === 0) {
        operation.status = 'completed';
        operation.result = {
          status: 'no-results',
          results: [],
          message: `No results found for "${keyword}"`
        };
        this.operationHistory.push(operation);
        return operation.result;
      }

      // 2. 选择第一个结果（模拟用户自动选择）
      const selectedResult = searchResult.results[0];
      const selectedIndex = 0;

      // 3. 获取完整 Recipe 信息
      let insertedText = selectedResult.code || selectedResult.description;
      
      // 4. 在编辑器中插入内容（如果指定了行号）
      if (filePath && lineNumber !== undefined && this.editorState) {
        const currentFile = this.editorState.getCurrentFile();
        
        if (currentFile && currentFile.path === filePath) {
          switch (insertMode) {
            case 'replace':
              // 替换指定行
              this.editorState.replaceText(
                { startLine: lineNumber, startCol: 0, endLine: lineNumber, endCol: Infinity },
                insertedText
              );
              break;
            case 'insert':
              this.editorState.insertText(lineNumber, insertedText);
              break;
            case 'append':
              const content = this.editorState.getContent();
              const lines = content.split('\n');
              this.editorState.insertText(lines.length, '\n' + insertedText);
              break;
          }
        }
      }

      operation.status = 'completed';
      operation.result = {
        status: 'success',
        results: searchResult.results,
        selectedIndex,
        selectedRecipe: selectedResult,
        insertedText,
        insertMode,
        insertedLines: (insertedText.match(/\n/g) || []).length + 1
      };

      this.operationHistory.push(operation);
      return operation.result;
    } catch (error) {
      operation.status = 'failed';
      operation.error = error.message;
      operation.result = {
        status: 'error',
        message: error.message,
        error: error
      };
      
      this.operationHistory.push(operation);
      throw error;
    }
  }

  /**
   * 执行创建操作
   * @param {object} params - { filePath, lineNumber, code, clipboardContent, description }
   * @returns {Promise<{status, candidateId, message}>}
   */
  async executeCreate(params) {
    const {
      filePath,
      lineNumber,
      code = null,
      clipboardContent = null,
      description = ''
    } = params;

    if (!filePath) {
      throw new Error('filePath is required');
    }

    const operation = {
      type: 'CREATE',
      params,
      startTime: Date.now(),
      status: 'running'
    };

    this.currentOperation = operation;

    try {
      // 1. 确定要提交的代码
      let codeToSubmit = code || clipboardContent;
      
      if (!codeToSubmit && this.editorState) {
        const currentFile = this.editorState.getCurrentFile();
        if (currentFile && currentFile.path === filePath) {
          // 使用编辑器中的选中内容或全部内容
          codeToSubmit = this.editorState.getSelectedText() || currentFile.content;
        }
      }

      if (!codeToSubmit) {
        throw new Error('No code content provided');
      }

      // 2. 检测语言
      const language = this._detectLanguage(filePath);

      // 3. 调用创建 Candidate API
      this.logger.log(`[OperationExecutor] Creating candidate from ${filePath}`);
      const createResult = await this.apiClient.createCandidate({
        code: codeToSubmit,
        filePath,
        language,
        description
      });

      operation.status = 'completed';
      operation.result = {
        status: 'success',
        candidateId: createResult.candidateId,
        message: createResult.message,
        codeLength: codeToSubmit.length,
        language
      };

      this.operationHistory.push(operation);
      return operation.result;
    } catch (error) {
      operation.status = 'failed';
      operation.error = error.message;
      operation.result = {
        status: 'error',
        message: error.message,
        error: error
      };
      
      this.operationHistory.push(operation);
      throw error;
    }
  }

  /**
   * 执行审查操作
   * @param {object} params - { filePath, fileContent, keyword, scope }
   * @returns {Promise<{status, violations, suggestions, score}>}
   */
  async executeAudit(params) {
    const {
      filePath,
      fileContent = null,
      keyword = '',
      scope = 'file'  // 'file', 'target', 'project'
    } = params;

    if (!filePath && !fileContent) {
      throw new Error('filePath or fileContent is required');
    }

    const operation = {
      type: 'AUDIT',
      params,
      startTime: Date.now(),
      status: 'running'
    };

    this.currentOperation = operation;

    try {
      // 1. 获取要审查的代码
      let contentToAudit = fileContent;

      if (!contentToAudit && this.editorState) {
        const currentFile = this.editorState.getCurrentFile();
        if (currentFile && currentFile.path === filePath) {
          contentToAudit = currentFile.content;
        }
      }

      if (!contentToAudit && filePath && this.vfs) {
        contentToAudit = this.vfs.readFile(filePath);
      }

      if (!contentToAudit) {
        throw new Error('Unable to get file content');
      }

      // 2. 检测语言
      const language = this._detectLanguage(filePath);

      // 3. 调用审查 API
      this.logger.log(`[OperationExecutor] Auditing ${filePath} with scope: ${scope}`);
      const auditResult = await this.apiClient.executeAudit({
        fileContent: contentToAudit,
        filePath: filePath || '',
        keyword,
        scope,
        language
      });

      operation.status = 'completed';
      operation.result = {
        status: 'success',
        violations: auditResult.violations,
        suggestions: auditResult.suggestions,
        score: auditResult.score,
        violationCount: auditResult.violations.length,
        suggestionCount: auditResult.suggestions.length
      };

      this.operationHistory.push(operation);
      return operation.result;
    } catch (error) {
      operation.status = 'failed';
      operation.error = error.message;
      operation.result = {
        status: 'error',
        message: error.message,
        error: error
      };
      
      this.operationHistory.push(operation);
      throw error;
    }
  }

  /**
   * 执行指令（自动识别类型）
   * @param {object} directive - DirectiveEmulator 返回的指令对象
   * @returns {Promise<object>}
   */
  async executeDirective(directive) {
    const { type, keyword, lineNumber, filePath, fullLine } = directive;

    this.logger.log(`[OperationExecutor] Executing directive: ${type} at line ${lineNumber}`);

    switch (type) {
      case 'SEARCH':
        return this.executeSearch({
          keyword,
          filePath,
          lineNumber,
          insertMode: 'replace'
        });

      case 'CREATE':
        return this.executeCreate({
          filePath,
          lineNumber,
          clipboardContent: this.editorState?.getClipboard()
        });

      case 'AUDIT':
        return this.executeAudit({
          filePath,
          keyword,
          scope: 'file'
        });

      default:
        throw new Error(`Unknown directive type: ${type}`);
    }
  }

  /**
   * 获取操作历史
   */
  getHistory() {
    return [...this.operationHistory];
  }

  /**
   * 获取操作统计
   */
  getStats() {
    const stats = {
      total: this.operationHistory.length,
      SEARCH: 0,
      CREATE: 0,
      AUDIT: 0,
      succeeded: 0,
      failed: 0,
      totalDuration: 0
    };

    this.operationHistory.forEach(op => {
      if (op.type in stats) {
        stats[op.type]++;
      }
      if (op.status === 'completed') {
        stats.succeeded++;
      } else if (op.status === 'failed') {
        stats.failed++;
      }
      if (op.startTime && op.endTime) {
        stats.totalDuration += op.endTime - op.startTime;
      }
    });

    return stats;
  }

  /**
   * 清空历史
   */
  reset() {
    this.operationHistory = [];
    this.currentOperation = null;
  }

  /**
   * 检测文件语言
   */
  _detectLanguage(filePath) {
    if (!filePath) return 'unknown';

    const ext = filePath.split('.').pop().toLowerCase();
    
    const languageMap = {
      'swift': 'swift',
      'h': 'objc',
      'm': 'objc',
      'mm': 'objc',
      'java': 'java',
      'kt': 'kotlin',
      'py': 'python',
      'js': 'javascript',
      'ts': 'typescript',
      'c': 'c',
      'cpp': 'cpp',
      'cc': 'cpp',
      'cxx': 'cpp'
    };

    return languageMap[ext] || 'unknown';
  }

  /**
   * 获取当前操作
   */
  getCurrentOperation() {
    return this.currentOperation ? { ...this.currentOperation } : null;
  }

  /**
   * 等待操作完成
   */
  async waitForCompletion(timeoutMs = 30000) {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (!this.currentOperation || 
            this.currentOperation.status === 'completed' ||
            this.currentOperation.status === 'failed') {
          clearInterval(checkInterval);
          resolve(this.currentOperation?.result);
        }

        if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          reject(new Error('Operation timeout'));
        }
      }, 100);
    });
  }
}

module.exports = OperationExecutor;
