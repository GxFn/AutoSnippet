/**
 * ServiceContainer - 依赖注入容器
 * 管理服务注册、解析、单例等生命周期
 */

class ServiceContainer {
  constructor() {
  this.services = new Map();        // 单例服务实例
  this.factories = new Map();       // 服务工厂函数
  this.singletons = new Set();      // 单例标记
  this.aliases = new Map();         // 服务别名
  this.booted = false;              // 容器启动标志
  }

  /**
   * 注册服务工厂
   * @param {string} name - 服务名称
   * @param {Function} factory - 工厂函数 (container) => service
   * @param {boolean} [singleton=true] - 是否单例
   * @returns {ServiceContainer} 返回 this 用于链式调用
   */
  register(name, factory, singleton = true) {
  if (this.booted) {
    throw new Error(`Cannot register service '${name}' after container is booted`);
  }

  if (typeof factory !== 'function') {
    throw new TypeError(`Factory for service '${name}' must be a function`);
  }

  this.factories.set(name, factory);

  if (singleton) {
    this.singletons.add(name);
  }

  return this;
  }

  /**
   * 注册单例服务
   * @param {string} name - 服务名称
   * @param {Function} factory - 工厂函数
   * @returns {ServiceContainer}
   */
  singleton(name, factory) {
  return this.register(name, factory, true);
  }

  /**
   * 注册非单例（瞬态）服务
   * @param {string} name - 服务名称
   * @param {Function} factory - 工厂函数
   * @returns {ServiceContainer}
   */
  transient(name, factory) {
  return this.register(name, factory, false);
  }

  /**
   * 注册服务别名
   * @param {string} original - 原始服务名
   * @param {string} alias - 别名
   * @returns {ServiceContainer}
   */
  alias(original, alias) {
  if (!this.factories.has(original)) {
    throw new Error(`Cannot create alias for non-existent service '${original}'`);
  }

  this.aliases.set(alias, original);
  return this;
  }

  /**
   * 解析服务
   * @param {string} name - 服务名称
   * @returns {any} 服务实例
   */
  resolve(name) {
  // 检查别名
  if (this.aliases.has(name)) {
    name = this.aliases.get(name);
  }

  // 返回已创建的单例
  if (this.singletons.has(name) && this.services.has(name)) {
    return this.services.get(name);
  }

  // 获取工厂函数
  const factory = this.factories.get(name);
  if (!factory) {
    throw new Error(`Service '${name}' not registered in container`);
  }

  // 创建新实例
  let service;
  try {
    service = factory(this);
  } catch (error) {
    throw new Error(`Error resolving service '${name}': ${error.message}`);
  }

  // 缓存单例
  if (this.singletons.has(name)) {
    this.services.set(name, service);
  }

  return service;
  }

  /**
   * 检查服务是否已注册
   * @param {string} name - 服务名称
   * @returns {boolean}
   */
  has(name) {
  if (this.aliases.has(name)) {
    name = this.aliases.get(name);
  }
  return this.factories.has(name);
  }

  /**
   * 检查服务是否为单例
   * @param {string} name - 服务名称
   * @returns {boolean}
   */
  isSingleton(name) {
  if (this.aliases.has(name)) {
    name = this.aliases.get(name);
  }
  return this.singletons.has(name);
  }

  /**
   * 启动容器（初始化所有单例）
   * @returns {ServiceContainer}
   */
  boot() {
  if (this.booted) {
    return this;
  }

  // 预加载所有单例服务
  for (const name of this.singletons) {
    if (!this.services.has(name)) {
    try {
      this.resolve(name);
    } catch (error) {
      console.error(`Error booting service '${name}':`, error.message);
      throw error;
    }
    }
  }

  this.booted = true;
  return this;
  }

  /**
   * 获取容器启动状态
   * @returns {boolean}
   */
  isBooted() {
  return this.booted;
  }

  /**
   * 清空容器（用于测试）
   * @returns {ServiceContainer}
   */
  flush() {
  this.services.clear();
  this.factories.clear();
  this.singletons.clear();
  this.aliases.clear();
  this.booted = false;
  return this;
  }

  /**
   * 获取所有已注册的服务名称
   * @returns {string[]}
   */
  getServices() {
  return Array.from(this.factories.keys());
  }

  /**
   * 获取容器统计信息
   * @returns {Object}
   */
  getStats() {
  return {
    registered: this.factories.size,
    singletons: this.singletons.size,
    resolved: this.services.size,
    aliases: this.aliases.size,
    booted: this.booted
  };
  }
}

/**
 * 创建全局容器实例
 */
const container = new ServiceContainer();

module.exports = {
  ServiceContainer,
  container
};
