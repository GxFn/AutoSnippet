/**
 * VirtualFileSystem
 * 
 * 职责：
 * - 模拟虚拟文件系统
 * - 支持创建/读取/修改/删除文件
 * - 可选地同步到真实文件系统（用于集成测试）
 * - 提供权限检查接口
 * - 触发变化事件（模拟 FileWatcher）
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class VirtualFileSystem extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.projectRoot = options.projectRoot || process.cwd();
    this.syncToDisk = options.syncToDisk || false;  // 是否同步写入磁盘
    this.files = new Map();  // { filePath: { content, mtime, permissions } }
    this.changeHistory = [];
    
    this.logger = options.logger || console;
  }

  /**
   * 初始化虚拟文件系统：加载项目现有文件（可选）
   */
  async init(options = {}) {
    const { loadExisting = true, rootPath = null } = options;
    
    const root = rootPath || this.projectRoot;
    
    if (loadExisting && fs.existsSync(root)) {
      this._loadFilesRecursive(root);
    }
    
    this.logger.log(`[VFS] Initialized with root: ${root}`);
    return { filesLoaded: this.files.size };
  }

  /**
   * 递归加载目录下的所有文件到虚拟系统
   */
  _loadFilesRecursive(dirPath, prefix = '') {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.join(prefix, entry.name);
        
        if (entry.isDirectory()) {
          this._loadFilesRecursive(fullPath, relativePath);
        } else if (entry.isFile()) {
          const content = fs.readFileSync(fullPath, 'utf8');
          this.files.set(relativePath, {
            content,
            mtime: Date.now(),
            permissions: { writable: true }
          });
        }
      }
    } catch (err) {
      this.logger.warn(`[VFS] Failed to load ${dirPath}: ${err.message}`);
    }
  }

  /**
   * 读取文件
   * @param {string} filePath - 相对路径或绝对路径
   * @returns {string | null}
   */
  readFile(filePath) {
    const normalized = this._normalizePath(filePath);
    
    if (!this.files.has(normalized)) {
      // 尝试从磁盘读取（如果启用）
      if (this.syncToDisk) {
        const fullPath = path.join(this.projectRoot, normalized);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          this.files.set(normalized, {
            content,
            mtime: Date.now(),
            permissions: { writable: true }
          });
          return content;
        }
      }
      return null;
    }
    
    return this.files.get(normalized).content;
  }

  /**
   * 写入文件
   * @param {string} filePath - 相对路径或绝对路径
   * @param {string} content - 文件内容
   * @param {object} options - { overwrite?: boolean, createIfNotExists?: boolean }
   * @returns {boolean} - 是否成功
   */
  writeFile(filePath, content, options = {}) {
    const normalized = this._normalizePath(filePath);
    const { overwrite = true, createIfNotExists = true } = options;
    
    // 检查文件是否存在
    const exists = this.files.has(normalized);
    
    if (exists && !overwrite) {
      this.logger.error(`[VFS] File exists and overwrite is disabled: ${normalized}`);
      return false;
    }
    
    if (!exists && !createIfNotExists) {
      this.logger.error(`[VFS] File does not exist and createIfNotExists is disabled: ${normalized}`);
      return false;
    }
    
    // 更新虚拟文件系统
    const oldContent = this.files.get(normalized)?.content;
    this.files.set(normalized, {
      content,
      mtime: Date.now(),
      permissions: { writable: true }
    });
    
    // 同步到磁盘（如果启用）
    if (this.syncToDisk) {
      try {
        const fullPath = path.join(this.projectRoot, normalized);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, content, 'utf8');
      } catch (err) {
        this.logger.warn(`[VFS] Failed to sync to disk: ${err.message}`);
      }
    }
    
    // 记录变化并触发事件
    this._recordChange('modify', normalized, oldContent, content);
    
    return true;
  }

  /**
   * 删除文件
   * @param {string} filePath - 相对路径或绝对路径
   * @returns {boolean}
   */
  deleteFile(filePath) {
    const normalized = this._normalizePath(filePath);
    
    if (!this.files.has(normalized)) {
      this.logger.error(`[VFS] File not found: ${normalized}`);
      return false;
    }
    
    const content = this.files.get(normalized).content;
    this.files.delete(normalized);
    
    // 同步到磁盘
    if (this.syncToDisk) {
      try {
        const fullPath = path.join(this.projectRoot, normalized);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      } catch (err) {
        this.logger.warn(`[VFS] Failed to delete from disk: ${err.message}`);
      }
    }
    
    // 记录变化
    this._recordChange('delete', normalized, content, null);
    
    return true;
  }

  /**
   * 列出目录内容
   * @param {string} dirPath - 目录路径
   * @returns {string[]} - 文件/目录列表
   */
  listDir(dirPath) {
    const normalized = this._normalizePath(dirPath);
    const prefix = normalized.endsWith('/') ? normalized : normalized + '/';
    
    const entries = new Set();
    
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const relative = filePath.slice(prefix.length);
        const parts = relative.split('/');
        entries.add(parts[0]);
      }
    }
    
    return Array.from(entries).sort();
  }

  /**
   * 检查文件是否存在
   */
  exists(filePath) {
    const normalized = this._normalizePath(filePath);
    return this.files.has(normalized);
  }

  /**
   * 获取文件信息
   */
  getFileInfo(filePath) {
    const normalized = this._normalizePath(filePath);
    const file = this.files.get(normalized);
    
    if (!file) return null;
    
    return {
      path: normalized,
      size: file.content.length,
      mtime: file.mtime,
      permissions: file.permissions,
      lineCount: file.content.split('\n').length
    };
  }

  /**
   * 获取所有文件列表
   */
  getAllFiles() {
    return Array.from(this.files.keys());
  }

  /**
   * 获取变化历史
   */
  getChangeHistory() {
    return [...this.changeHistory];
  }

  /**
   * 清空文件系统
   */
  clear() {
    this.files.clear();
    this.changeHistory = [];
    this.emit('clear');
  }

  /**
   * 记录变化并触发事件
   */
  _recordChange(type, filePath, oldContent, newContent) {
    const change = {
      type,           // 'create', 'modify', 'delete'
      filePath,
      timestamp: Date.now(),
      oldContent,
      newContent,
      diff: {
        oldLines: oldContent ? oldContent.split('\n').length : 0,
        newLines: newContent ? newContent.split('\n').length : 0
      }
    };
    
    this.changeHistory.push(change);
    this.emit('change', change);
    
    return change;
  }

  /**
   * 规范化路径（相对路径或绝对路径都转换为相对）
   */
  _normalizePath(filePath) {
    let normalized = filePath;
    
    // 如果是绝对路径，转换为相对路径
    if (path.isAbsolute(normalized)) {
      normalized = path.relative(this.projectRoot, normalized);
    }
    
    // 统一使用正斜杠
    normalized = normalized.replace(/\\/g, '/');
    
    return normalized;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const totalFiles = this.files.size;
    const totalSize = Array.from(this.files.values())
      .reduce((sum, file) => sum + file.content.length, 0);
    
    return {
      totalFiles,
      totalSize,
      totalLines: Array.from(this.files.values())
        .reduce((sum, file) => sum + file.content.split('\n').length, 0),
      changeCount: this.changeHistory.length
    };
  }
}

module.exports = VirtualFileSystem;
