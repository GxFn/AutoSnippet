/**
 * Provider Manager - 管理和注册 AI Provider
 * 提供 Provider 的动态加载、切换和管理能力
 */
const path = require('path');
const fs = require('fs');

class ProviderManager {
  /**
   * @param {ServiceContainer} container DI 容器
   * @param {Logger} logger 日志记录器
   */
  constructor(container, logger) {
  this.container = container;
  this.logger = logger;
  this.providers = new Map(); // name -> provider class
  this.instances = new Map(); // name -> provider instance
  this.current = null; // 当前活跃的 provider
  }

  /**
   * 注册一个 Provider
   * @param {string} name Provider 名称
   * @param {class} ProviderClass Provider 类
   * @param {boolean} makeCurrent 是否设为当前 provider
   */
  register(name, ProviderClass, makeCurrent = false) {
  if (this.providers.has(name)) {
    this.logger.warn(`Provider '${name}' already registered, overwriting`);
  }

  this.providers.set(name, ProviderClass);
  this.logger.info(`Registered AI Provider: ${name}`);

  if (makeCurrent) {
    this.setCurrent(name);
  }

  return this;
  }

  /**
   * 获取 Provider 实例
   * @param {string} name Provider 名称
   * @param {Object} config Provider 配置
   * @returns {IAiProvider} Provider 实例
   * @throws {AiProviderNotFoundError}
   */
  getInstance(name, config = {}) {
  const cacheKey = `${name}:${JSON.stringify(config)}`;

  if (this.instances.has(cacheKey)) {
    return this.instances.get(cacheKey);
  }

  const ProviderClass = this.providers.get(name);
  if (!ProviderClass) {
    const available = Array.from(this.providers.keys()).join(', ');
    const error = new Error(`Provider '${name}' not found. Available: ${available}`);
    error.code = 'AiProviderNotFoundError';
    throw error;
  }

  try {
    const instance = new ProviderClass(config);
    this.instances.set(cacheKey, instance);
    return instance;
  } catch (error) {
    this.logger.error(`Failed to instantiate provider '${name}':`, error);
    throw error;
  }
  }

  /**
   * 设置当前 Provider
   * @param {string} name Provider 名称
   * @param {Object} config Provider 配置
   * @returns {IAiProvider} 激活的 Provider 实例
   */
  setCurrent(name, config = {}) {
  if (!this.providers.has(name)) {
    const available = Array.from(this.providers.keys()).join(', ');
    throw new Error(`Provider '${name}' not found. Available: ${available}`);
  }

  this.current = { name, instance: this.getInstance(name, config) };
  this.logger.info(`Switched to AI Provider: ${name}`);
  return this.current.instance;
  }

  /**
   * 获取当前激活的 Provider 实例
   * @returns {IAiProvider|null}
   */
  getCurrent() {
  return this.current ? this.current.instance : null;
  }

  /**
   * 获取当前 Provider 名称
   * @returns {string|null}
   */
  getCurrentName() {
  return this.current ? this.current.name : null;
  }

  /**
   * 列出所有已注册的 Provider
   * @returns {Array<string>}
   */
  list() {
  return Array.from(this.providers.keys());
  }

  /**
   * 检查 Provider 是否已注册
   * @param {string} name Provider 名称
   * @returns {boolean}
   */
  has(name) {
  return this.providers.has(name);
  }

  /**
   * 从文件加载 Provider
   * @param {string} providerDirPath Provider 目录路径
   * @param {string} pattern 文件匹配模式
   */
  loadFromDirectory(providerDirPath, pattern = '*Provider.js') {
  if (!fs.existsSync(providerDirPath)) {
    this.logger.warn(`Provider directory not found: ${providerDirPath}`);
    return;
  }

  const files = fs.readdirSync(providerDirPath).filter(f => {
    const basename = path.basename(f);
    return !basename.startsWith('_') && f.endsWith('.js');
  });

  for (const file of files) {
    try {
    const filePath = path.join(providerDirPath, file);
    const ProviderClass = require(filePath);
    
    // 从文件名推断 provider 名称 (e.g., OpenAiProvider.js -> openai)
    const baseName = path.basename(file, '.js');
    const name = baseName.replace(/Provider$/, '').toLowerCase();

    if (typeof ProviderClass === 'function') {
      this.register(name, ProviderClass);
    } else if (ProviderClass && typeof ProviderClass.default === 'function') {
      this.register(name, ProviderClass.default);
    }
    } catch (error) {
    this.logger.error(`Failed to load provider from ${file}:`, error);
    }
  }
  }

  /**
   * 卸载 Provider
   * @param {string} name Provider 名称
   */
  unregister(name) {
  if (this.current && this.current.name === name) {
    this.logger.warn(`Cannot unregister current provider '${name}'`);
    return false;
  }

  this.providers.delete(name);
  
  // 清除该 provider 的所有缓存实例
  for (const [key] of this.instances) {
    if (key.startsWith(`${name}:`)) {
    this.instances.delete(key);
    }
  }

  this.logger.info(`Unregistered AI Provider: ${name}`);
  return true;
  }

  /**
   * 获取 Provider 统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
  return {
    total: this.providers.size,
    current: this.getCurrentName(),
    available: this.list(),
    cached: this.instances.size
  };
  }

  /**
   * 清空所有缓存的实例
   */
  clearCache() {
  this.instances.clear();
  this.logger.info('Cleared all provider instances cache');
  }

  /**
   * 重置 Manager（卸载所有 Provider）
   */
  reset() {
  this.providers.clear();
  this.instances.clear();
  this.current = null;
  this.logger.info('Reset ProviderManager');
  }
}

module.exports = ProviderManager;
