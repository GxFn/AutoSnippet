/**
 * BasePlugin - 插件基类
 * 所有插件都应继承此类
 */

class BasePlugin {
  /**
   * @param {ServiceContainer} container - 服务容器
   * @param {Object} metadata - 插件元数据
   * @param {string} metadata.name - 插件名称
   * @param {string} metadata.version - 插件版本
   * @param {string} [metadata.type] - 插件类型
   * @param {string} [metadata.description] - 插件描述
   */
  constructor(container, metadata) {
  this.container = container;
  this.metadata = metadata;
  this.name = metadata.name;
  this.version = metadata.version;
  this.type = metadata.type || 'unknown';
  this.description = metadata.description || '';
  this.hooks = [];
  this.listeners = [];
  }

  /**
   * 插件注册时调用（子类实现）
   * @returns {Promise<void>}
   */
  async register() {
  throw new Error('Plugin must implement register() method');
  }

  /**
   * 插件卸载时调用（可选）
   * @returns {Promise<void>}
   */
  async unregister() {
  // 默认无操作，子类可覆盖
  }

  /**
   * 获取服务
   * @param {string} name - 服务名称
   * @returns {any} 服务实例
   */
  getService(name) {
  return this.container.resolve(name);
  }

  /**
   * 检查服务是否存在
   * @param {string} name - 服务名称
   * @returns {boolean}
   */
  hasService(name) {
  return this.container.has(name);
  }

  /**
   * 注册 Hook（插件可以在执行流中插入逻辑）
   * @param {string} hookName - Hook 名称
   * @param {Function} callback - 回调函数
   * @param {number} [priority=10] - 优先级（数字越小优先级越高）
   * @returns {BasePlugin}
   */
  hook(hookName, callback, priority = 10) {
  const pluginLoader = this.container.resolve('plugin-loader');
  pluginLoader.registerHook(hookName, callback, priority);

  this.hooks.push({ name: hookName, priority });
  return this;
  }

  /**
   * 监听事件
   * @param {string} eventName - 事件名称
   * @param {Function} callback - 回调函数
   * @returns {BasePlugin}
   */
  on(eventName, callback) {
  const eventBus = this.container.resolve('event-bus');
  eventBus.on(eventName, callback);

  this.listeners.push(eventName);
  return this;
  }

  /**
   * 监听事件（仅一次）
   * @param {string} eventName - 事件名称
   * @param {Function} callback - 回调函数
   * @returns {BasePlugin}
   */
  once(eventName, callback) {
  const eventBus = this.container.resolve('event-bus');
  eventBus.once(eventName, callback);

  this.listeners.push(eventName);
  return this;
  }

  /**
   * 发射事件
   * @param {string} eventName - 事件名称
   * @param {...any} args - 事件参数
   * @returns {boolean} 是否有监听者处理
   */
  emit(eventName, ...args) {
  const eventBus = this.container.resolve('event-bus');
  return eventBus.emit(eventName, ...args);
  }

  /**
   * 异步发射事件
   * @param {string} eventName - 事件名称
   * @param {...any} args - 事件参数
   * @returns {Promise<void>}
   */
  async emitAsync(eventName, ...args) {
  const eventBus = this.container.resolve('event-bus');
  return await eventBus.emitAsync(eventName, ...args);
  }

  /**
   * 获取日志器
   * @returns {Logger}
   */
  getLogger() {
  return this.container.resolve('logger');
  }

  /**
   * 获取插件信息
   * @returns {Object}
   */
  getInfo() {
  return {
    name: this.name,
    version: this.version,
    type: this.type,
    description: this.description,
    hooksRegistered: this.hooks.length,
    listenersRegistered: this.listeners.length
  };
  }

  /**
   * 清理资源（卸载时调用）
   * @private
   */
  async cleanup() {
  const eventBus = this.container.resolve('event-bus');

  // 移除所有注册的监听者（可选，看具体实现）
  // 注：由于 EventEmitter 的限制，无法直接移除匿名函数
  // 实际应用中应该保存引用并手动移除

  this.hooks = [];
  this.listeners = [];
  }
}

module.exports = BasePlugin;
