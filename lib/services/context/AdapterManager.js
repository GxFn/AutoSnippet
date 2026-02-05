/**
 * Adapter Manager - 管理和注册 Context Adapter
 * 提供 Adapter 的动态加载、切换和管理能力
 */
const path = require('path');
const fs = require('fs');

class AdapterManager {
  /**
   * @param {ServiceContainer} container DI 容器
   * @param {Logger} logger 日志记录器
   */
  constructor(container, logger) {
  this.container = container;
  this.logger = logger;
  this.adapters = new Map(); // name -> adapter class
  this.instances = new Map(); // projectRoot:name -> adapter instance
  this.currentByProject = new Map(); // projectRoot -> { name, instance }
  }

  /**
   * 注册一个 Adapter
   * @param {string} name Adapter 名称
   * @param {class} AdapterClass Adapter 类
   * @returns {AdapterManager} this
   */
  register(name, AdapterClass) {
  if (this.adapters.has(name)) {
    this.logger.warn(`Adapter '${name}' already registered, overwriting`);
  }

  this.adapters.set(name, AdapterClass);
  this.logger.info(`Registered Context Adapter: ${name}`);
  return this;
  }

  /**
   * 获取 Adapter 实例
   * @param {string} name Adapter 名称
   * @param {string} projectRoot 项目根目录
   * @param {Object} config Adapter 配置
   * @returns {IContextAdapter} Adapter 实例
   * @throws {ContextAdapterNotFoundError}
   */
  getInstance(name, projectRoot, config = {}) {
  const cacheKey = `${projectRoot}:${name}`;

  if (this.instances.has(cacheKey)) {
    return this.instances.get(cacheKey);
  }

  const AdapterClass = this.adapters.get(name);
  if (!AdapterClass) {
    const available = Array.from(this.adapters.keys()).join(', ');
    const error = new Error(`Adapter '${name}' not found. Available: ${available}`);
    error.code = 'ContextAdapterNotFoundError';
    throw error;
  }

  try {
    const instance = new AdapterClass(projectRoot, config);
    this.instances.set(cacheKey, instance);
    return instance;
  } catch (error) {
    this.logger.error(`Failed to instantiate adapter '${name}':`, error);
    throw error;
  }
  }

  /**
   * 设置当前项目的 Adapter
   * @param {string} projectRoot 项目根目录
   * @param {string} name Adapter 名称
   * @param {Object} config Adapter 配置
   * @returns {IContextAdapter} 激活的 Adapter 实例
   */
  setCurrent(projectRoot, name, config = {}) {
  if (!this.adapters.has(name)) {
    const available = Array.from(this.adapters.keys()).join(', ');
    throw new Error(`Adapter '${name}' not found. Available: ${available}`);
  }

  const instance = this.getInstance(name, projectRoot, config);
  this.currentByProject.set(projectRoot, { name, instance });
  this.logger.info(`Switched to Context Adapter '${name}' for project: ${projectRoot}`);
  return instance;
  }

  /**
   * 获取当前项目的 Adapter 实例
   * @param {string} projectRoot 项目根目录
   * @returns {IContextAdapter|null}
   */
  getCurrent(projectRoot) {
  const current = this.currentByProject.get(projectRoot);
  return current ? current.instance : null;
  }

  /**
   * 获取当前项目的 Adapter 名称
   * @param {string} projectRoot 项目根目录
   * @returns {string|null}
   */
  getCurrentName(projectRoot) {
  const current = this.currentByProject.get(projectRoot);
  return current ? current.name : null;
  }

  /**
   * 列出所有已注册的 Adapter
   * @returns {Array<string>}
   */
  list() {
  return Array.from(this.adapters.keys());
  }

  /**
   * 检查 Adapter 是否已注册
   * @param {string} name Adapter 名称
   * @returns {boolean}
   */
  has(name) {
  return this.adapters.has(name);
  }

  /**
   * 从文件加载 Adapter
   * @param {string} adapterDirPath Adapter 目录路径
   */
  loadFromDirectory(adapterDirPath) {
  if (!fs.existsSync(adapterDirPath)) {
    this.logger.warn(`Adapter directory not found: ${adapterDirPath}`);
    return;
  }

  const files = fs.readdirSync(adapterDirPath).filter(f => {
    const basename = path.basename(f);
    return !basename.startsWith('_') && 
       !basename.startsWith('Base') &&
       f.endsWith('.js');
  });

  for (const file of files) {
    try {
    const filePath = path.join(adapterDirPath, file);
    const AdapterClass = require(filePath);
    
    // 从文件名推断 adapter 名称 (e.g., JsonAdapter.js -> json)
    const baseName = path.basename(file, '.js');
    const name = baseName.replace(/Adapter$/, '').toLowerCase();

    if (typeof AdapterClass === 'function') {
      this.register(name, AdapterClass);
    } else if (AdapterClass && typeof AdapterClass.default === 'function') {
      this.register(name, AdapterClass.default);
    }
    } catch (error) {
    this.logger.error(`Failed to load adapter from ${file}:`, error);
    }
  }
  }

  /**
   * 卸载 Adapter
   * @param {string} name Adapter 名称
   */
  unregister(name) {
  // 检查是否有项目正在使用
  for (const [projectRoot, current] of this.currentByProject) {
    if (current.name === name) {
    this.logger.warn(`Cannot unregister adapter '${name}': in use by project ${projectRoot}`);
    return false;
    }
  }

  this.adapters.delete(name);
  
  // 清除该 adapter 的所有缓存实例
  for (const [key] of this.instances) {
    if (key.endsWith(`:${name}`)) {
    this.instances.delete(key);
    }
  }

  this.logger.info(`Unregistered Context Adapter: ${name}`);
  return true;
  }

  /**
   * 清空特定项目或所有项目的 Adapter 实例缓存
   * @param {string} [projectRoot] 项目根目录，不传则清空所有
   */
  clearCache(projectRoot) {
  if (projectRoot) {
    // 清除特定项目的缓存
    for (const [key] of this.instances) {
    if (key.startsWith(`${projectRoot}:`)) {
      this.instances.delete(key);
    }
    }
    this.currentByProject.delete(projectRoot);
    this.logger.info(`Cleared adapter cache for project: ${projectRoot}`);
  } else {
    // 清空所有缓存
    this.instances.clear();
    this.currentByProject.clear();
    this.logger.info('Cleared all adapter instances cache');
  }
  }

  /**
   * 获取 Adapter 统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
  return {
    total: this.adapters.size,
    available: this.list(),
    cached: this.instances.size,
    activeProjects: this.currentByProject.size
  };
  }

  /**
   * 重置 Manager（卸载所有 Adapter）
   */
  reset() {
  this.adapters.clear();
  this.instances.clear();
  this.currentByProject.clear();
  this.logger.info('Reset AdapterManager');
  }

  /**
   * 关闭所有 Adapter 实例
   * @returns {Promise<void>}
   */
  async closeAll() {
  const promises = [];
  for (const [key, instance] of this.instances) {
    if (typeof instance.close === 'function') {
    promises.push(instance.close().catch(err => {
      this.logger.error(`Failed to close adapter ${key}:`, err);
    }));
    }
  }
  await Promise.all(promises);
  this.instances.clear();
  this.currentByProject.clear();
  this.logger.info('Closed all adapter instances');
  }
}

module.exports = AdapterManager;
