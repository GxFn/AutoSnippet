/**
 * EditorState
 * 
 * 职责：
 * - 模拟编辑器状态（打开文件、光标位置、选中内容）
 * - 提供编辑操作（插入、删除、替换）
 * - 触发编辑事件
 */

const EventEmitter = require('events');

class EditorState extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.currentFile = null;  // { path, content, unsaved }
    this.caret = { line: 0, column: 0 };  // 光标位置（0-based）
    this.selection = null;  // { startLine, startCol, endLine, endCol }
    this.history = [];  // 编辑历史
    this.clipboard = options.clipboard || '';  // 剪贴板内容
    
    this.logger = options.logger || console;
  }

  /**
   * 打开文件
   * @param {string} filePath - 文件路径
   * @param {string} content - 文件内容
   */
  openFile(filePath, content) {
    this.currentFile = {
      path: filePath,
      content,
      unsaved: false
    };
    
    // 重置光标和选择
    this.caret = { line: 0, column: 0 };
    this.selection = null;
    
    this.emit('fileOpened', { filePath, lines: content.split('\n').length });
    return this.getCurrentState();
  }

  /**
   * 关闭文件
   */
  closeFile() {
    const previousFile = this.currentFile;
    this.currentFile = null;
    this.caret = { line: 0, column: 0 };
    this.selection = null;
    
    this.emit('fileClosed', previousFile);
  }

  /**
   * 获取当前打开的文件信息
   */
  getCurrentFile() {
    if (!this.currentFile) return null;
    
    return {
      path: this.currentFile.path,
      content: this.currentFile.content,
      unsaved: this.currentFile.unsaved,
      lineCount: this.currentFile.content.split('\n').length
    };
  }

  /**
   * 获取编辑器当前完整状态
   */
  getCurrentState() {
    return {
      file: this.getCurrentFile(),
      caret: this.caret,
      selection: this.selection,
      clipboard: this.clipboard
    };
  }

  /**
   * 在指定位置插入文本
   * @param {number|{line, column}} position - 位置 (行号, 列号) 或对象
   * @param {string} text - 要插入的文本
   */
  insertText(position, text) {
    const { line, column } = this._parsePosition(position);
    
    if (!this._validatePosition(line, column)) {
      throw new Error(`Invalid position: line=${line}, column=${column}`);
    }
    
    const lines = this.currentFile.content.split('\n');
    const targetLine = lines[line] || '';
    
    // 在指定列位置插入文本
    const before = targetLine.slice(0, column);
    const after = targetLine.slice(column);
    
    // 处理换行符
    if (text.includes('\n')) {
      const textLines = text.split('\n');
      const firstLine = before + textLines[0];
      const lastLine = textLines[textLines.length - 1] + after;
      
      lines[line] = firstLine;
      lines.splice(line + 1, 0, ...textLines.slice(1, -1), lastLine);
    } else {
      lines[line] = before + text + after;
    }
    
    this.currentFile.content = lines.join('\n');
    this.currentFile.unsaved = true;
    
    this._recordHistory('insert', { line, column, text });
    this.emit('contentChanged', { type: 'insert', position: { line, column }, text });
    
    return this.getCurrentState();
  }

  /**
   * 删除指定范围的文本
   * @param {object} range - { startLine, startCol, endLine, endCol }
   */
  deleteText(range) {
    const { startLine, startCol, endLine, endCol } = range;
    
    if (!this._validatePosition(startLine, startCol) || !this._validatePosition(endLine, endCol)) {
      throw new Error('Invalid range');
    }
    
    const lines = this.currentFile.content.split('\n');
    
    if (startLine === endLine) {
      // 单行删除
      const line = lines[startLine];
      lines[startLine] = line.slice(0, startCol) + line.slice(endCol);
    } else {
      // 多行删除
      const firstLine = lines[startLine].slice(0, startCol);
      const lastLine = lines[endLine].slice(endCol);
      lines.splice(startLine, endLine - startLine + 1, firstLine + lastLine);
    }
    
    this.currentFile.content = lines.join('\n');
    this.currentFile.unsaved = true;
    
    this._recordHistory('delete', range);
    this.emit('contentChanged', { type: 'delete', range });
    
    return this.getCurrentState();
  }

  /**
   * 替换指定范围的文本
   * @param {object} range - { startLine, startCol, endLine, endCol }
   * @param {string} text - 替换内容
   */
  replaceText(range, text) {
    this.deleteText(range);
    this.insertText({ line: range.startLine, column: range.startCol }, text);
    
    this.emit('contentChanged', { type: 'replace', range, text });
  }

  /**
   * 替换选中内容
   * @param {string} text - 替换内容
   */
  replaceSelection(text) {
    if (!this.selection) {
      throw new Error('No text selected');
    }
    
    this.replaceText({
      startLine: this.selection.startLine,
      startCol: this.selection.startCol,
      endLine: this.selection.endLine,
      endCol: this.selection.endCol
    }, text);
    
    return this.getCurrentState();
  }

  /**
   * 获取文件完整内容
   */
  getContent() {
    if (!this.currentFile) return null;
    return this.currentFile.content;
  }

  /**
   * 获取指定行的内容
   */
  getLine(lineNumber) {
    if (!this.currentFile) return null;
    const lines = this.currentFile.content.split('\n');
    return lines[lineNumber] || null;
  }

  /**
   * 获取多行内容
   */
  getLines(startLine, endLine) {
    if (!this.currentFile) return null;
    const lines = this.currentFile.content.split('\n');
    return lines.slice(startLine, endLine + 1);
  }

  /**
   * 设置光标位置
   */
  setCaret(line, column) {
    if (!this._validatePosition(line, column)) {
      throw new Error(`Invalid caret position: line=${line}, column=${column}`);
    }
    
    const oldCaret = { ...this.caret };
    this.caret = { line, column };
    
    this.emit('caretMoved', { from: oldCaret, to: this.caret });
  }

  /**
   * 获取光标位置
   */
  getCaret() {
    return { ...this.caret };
  }

  /**
   * 设置选中范围
   */
  setSelection(startLine, startCol, endLine, endCol) {
    if (!this._validatePosition(startLine, startCol) || !this._validatePosition(endLine, endCol)) {
      throw new Error('Invalid selection range');
    }
    
    this.selection = { startLine, startCol, endLine, endCol };
    this.emit('selectionChanged', this.selection);
  }

  /**
   * 获取选中范围
   */
  getSelection() {
    if (!this.selection) return null;
    return { ...this.selection };
  }

  /**
   * 获取选中的文本
   */
  getSelectedText() {
    if (!this.selection) return null;
    
    const { startLine, startCol, endLine, endCol } = this.selection;
    const lines = this.currentFile.content.split('\n');
    
    if (startLine === endLine) {
      return lines[startLine].slice(startCol, endCol);
    }
    
    const selectedLines = [];
    selectedLines.push(lines[startLine].slice(startCol));
    for (let i = startLine + 1; i < endLine; i++) {
      selectedLines.push(lines[i]);
    }
    selectedLines.push(lines[endLine].slice(0, endCol));
    
    return selectedLines.join('\n');
  }

  /**
   * 清除选择
   */
  clearSelection() {
    this.selection = null;
    this.emit('selectionCleared');
  }

  /**
   * 设置剪贴板内容
   */
  setClipboard(content) {
    this.clipboard = content;
    this.emit('clipboardChanged', content);
  }

  /**
   * 获取剪贴板内容
   */
  getClipboard() {
    return this.clipboard;
  }

  /**
   * 复制选中内容到剪贴板
   */
  copy() {
    const text = this.getSelectedText();
    if (text) {
      this.clipboard = text;
      this.emit('copied', text);
      return text;
    }
    return null;
  }

  /**
   * 从剪贴板粘贴
   */
  paste() {
    if (!this.clipboard) {
      throw new Error('Clipboard is empty');
    }
    
    this.insertText(this.caret, this.clipboard);
    this.emit('pasted', this.clipboard);
  }

  /**
   * 撤销
   */
  undo() {
    if (this.history.length === 0) {
      this.logger.warn('[EditorState] Nothing to undo');
      return false;
    }
    
    // TODO: 实现撤销逻辑
    this.logger.log('[EditorState] Undo not fully implemented yet');
    return false;
  }

  /**
   * 获取编辑历史
   */
  getHistory() {
    return [...this.history];
  }

  /**
   * 验证位置有效性
   */
  _validatePosition(line, column) {
    if (!this.currentFile) return false;
    
    const lines = this.currentFile.content.split('\n');
    
    if (line < 0 || line >= lines.length) return false;
    if (column < 0 || column > lines[line].length) return false;
    
    return true;
  }

  /**
   * 解析位置参数
   */
  _parsePosition(position) {
    if (typeof position === 'number') {
      // 仅提供了行号，默认列为 0
      return { line: position, column: 0 };
    }
    
    if (typeof position === 'object' && position.line !== undefined) {
      return { line: position.line, column: position.column || 0 };
    }
    
    throw new Error('Invalid position parameter');
  }

  /**
   * 记录编辑历史
   */
  _recordHistory(type, data) {
    this.history.push({
      type,
      data,
      timestamp: Date.now(),
      previousContent: this.currentFile.content
    });
  }
}

module.exports = EditorState;
