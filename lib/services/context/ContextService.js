/**
 * Context Service - 统一的上下文服务入口
 * 封装 Adapter 管理和上下文操作
 */
const AdapterManager = require('./AdapterManager');
const IContextAdapter = require('./IContextAdapter');

class ContextService {
  /**
   * @param {Object} options 选项
   * @param {ServiceContainer} options.container DI 容器
   * @param {Logger} options.logger 日志记录器
   * @param {ConfigManager} options.config 配置管理器
   * @param {string} options.adaptersPath 默认 Adapter 路径
   */
  constructor(options = {}) {
  this.container = options.container;
  this.logger = options.logger;
  this.config = options.config;
  this.adaptersPath = options.adaptersPath;

  // 初始化 Adapter Manager
  this.adapterManager = new AdapterManager(this.container, this.logger);

  this.logger.info('Context Service initialized');
  }

  /**
   * 初始化服务（加载 Adapter）
   * @param {Object} options 选项
   * @param {boolean} [options.autoLoad=true] 是否自动加载内置 Adapter
   * @param {string} [options.defaultAdapter='json'] 默认 Adapter 名称
   * @returns {Promise<void>}
   */
  async initialize(options = {}) {
  const autoLoad = options.autoLoad !== false;
  const defaultAdapter = options.defaultAdapter || 
    this.config.get('context.storage.adapter') || 
    'json';

  if (autoLoad) {
    const adaptersPath = this.adaptersPath || 
    `${__dirname}/../../context/adapters`;
    
    this.logger.info(`Loading adapters from ${adaptersPath}`);
    this.adapterManager.loadFromDirectory(adaptersPath);
  }

  // 注册配置中的自定义 Adapter
  const customAdapters = this.config.get('context.customAdapters');
  if (customAdapters && typeof customAdapters === 'object') {
    for (const [name, AdapterClass] of Object.entries(customAdapters)) {
    this.adapterManager.register(name, AdapterClass);
    }
  }

  this.logger.info(`Context Service initialized with ${this.adapterManager.list().length} adapters`);
  }

  /**
   * 获取或创建指定项目的 Adapter
   * @param {string} projectRoot 项目根目录
   * @param {Object} [options] 选项
   * @param {string} [options.adapter] Adapter 名称
   * @param {Object} [options.config] Adapter 配置
   * @returns {Promise<IContextAdapter>}
   * @private
   */
  async _getAdapter(projectRoot, options = {}) {
  if (!projectRoot) {
    throw new Error('projectRoot is required');
  }

  let current = this.adapterManager.getCurrent(projectRoot);
  
  if (!current || (options.adapter && options.adapter !== this.adapterManager.getCurrentName(projectRoot))) {
    const adapterName = options.adapter || 
    this.config.get('context.storage.adapter') || 
    'json';
    
    const adapterConfig = options.config || 
    this.config.get(`context.storage.${adapterName}`) || 
    {};

    current = this.adapterManager.setCurrent(projectRoot, adapterName, adapterConfig);
    
    // 初始化 Adapter
    await current.init();
  }

  return current;
  }

  /**
   * 添加或更新上下文条目
   * @param {string} projectRoot 项目根目录
   * @param {Object} item 上下文条目
   * @returns {Promise<void>}
   * @throws {ContextError}
   */
  async upsert(projectRoot, item) {
  const adapter = await this._getAdapter(projectRoot);
  
  try {
    this.logger.debug(`Upserting item ${item.id} in project ${projectRoot}`);
    await adapter.upsert(item);
  } catch (error) {
    this.logger.error('Upsert failed:', error);
    throw this._wrapError(error);
  }
  }

  /**
   * 批量添加或更新
   * @param {string} projectRoot 项目根目录
   * @param {Array<Object>} items 条目数组
   * @returns {Promise<void>}
   * @throws {ContextError}
   */
  async batchUpsert(projectRoot, items) {
  const adapter = await this._getAdapter(projectRoot);
  
  try {
    this.logger.debug(`Batch upserting ${items.length} items in project ${projectRoot}`);
    await adapter.batchUpsert(items);
  } catch (error) {
    this.logger.error('Batch upsert failed:', error);
    throw this._wrapError(error);
  }
  }

  /**
   * 根据 ID 获取条目
   * @param {string} projectRoot 项目根目录
   * @param {string} id 条目ID
   * @returns {Promise<Object|null>}
   * @throws {ContextError}
   */
  async getById(projectRoot, id) {
  const adapter = await this._getAdapter(projectRoot);
  
  try {
    this.logger.debug(`Getting item ${id} from project ${projectRoot}`);
    return await adapter.getById(id);
  } catch (error) {
    this.logger.error('Get by ID failed:', error);
    throw this._wrapError(error);
  }
  }

  /**
   * 删除条目
   * @param {string} projectRoot 项目根目录
   * @param {string} id 条目ID
   * @returns {Promise<void>}
   * @throws {ContextError}
   */
  async remove(projectRoot, id) {
  const adapter = await this._getAdapter(projectRoot);
  
  try {
    this.logger.debug(`Removing item ${id} from project ${projectRoot}`);
    await adapter.remove(id);
  } catch (error) {
    this.logger.error('Remove failed:', error);
    throw this._wrapError(error);
  }
  }

  /**
   * 批量删除
   * @param {string} projectRoot 项目根目录
   * @param {Array<string>} ids 条目ID数组
   * @returns {Promise<void>}
   * @throws {ContextError}
   */
  async batchRemove(projectRoot, ids) {
  const adapter = await this._getAdapter(projectRoot);
  
  try {
    this.logger.debug(`Batch removing ${ids.length} items from project ${projectRoot}`);
    await adapter.batchRemove(ids);
  } catch (error) {
    this.logger.error('Batch remove failed:', error);
    throw this._wrapError(error);
  }
  }

  /**
   * 向量搜索
   * @param {string} projectRoot 项目根目录
   * @param {Array<number>} queryVector 查询向量
   * @param {Object} options 搜索选项
   * @returns {Promise<Array<Object>>}
   * @throws {ContextError}
   */
  async search(projectRoot, queryVector, options = {}) {
  const adapter = await this._getAdapter(projectRoot);
  
  try {
    this.logger.debug(`Searching in project ${projectRoot}`);
    return await adapter.search(queryVector, options);
  } catch (error) {
    this.logger.error('Search failed:', error);
    throw this._wrapError(error);
  }
  }

  /**
   * 列出所有条目
   * @param {string} projectRoot 项目根目录
   * @param {Object} options 列表选项
   * @returns {Promise<Array<Object>>}
   * @throws {ContextError}
   */
  async list(projectRoot, options = {}) {
  const adapter = await this._getAdapter(projectRoot);
  
  try {
    this.logger.debug(`Listing items in project ${projectRoot}`);
    return await adapter.list(options);
  } catch (error) {
    this.logger.error('List failed:', error);
    throw this._wrapError(error);
  }
  }

  /**
   * 统计条目数量
   * @param {string} projectRoot 项目根目录
   * @param {Object} [filter] 过滤条件
   * @returns {Promise<number>}
   * @throws {ContextError}
   */
  async count(projectRoot, filter = {}) {
  const adapter = await this._getAdapter(projectRoot);
  
  try {
    return await adapter.count(filter);
  } catch (error) {
    this.logger.error('Count failed:', error);
    throw this._wrapError(error);
  }
  }

  /**
   * 清空项目的所有数据
   * @param {string} projectRoot 项目根目录
   * @returns {Promise<void>}
   * @throws {ContextError}
   */
  async clear(projectRoot) {
  const adapter = await this._getAdapter(projectRoot);
  
  try {
    this.logger.warn(`Clearing all data in project ${projectRoot}`);
    await adapter.clear();
  } catch (error) {
    this.logger.error('Clear failed:', error);
    throw this._wrapError(error);
  }
  }

  /**
   * 检查 Context Adapter 健康状态
   * @param {string} projectRoot 项目根目录
   * @returns {Promise<Object>} 健康状态
   */
  async healthCheck(projectRoot) {
  try {
    const adapter = await this._getAdapter(projectRoot);
    return await adapter.healthCheck();
  } catch (error) {
    this.logger.error('Health check failed:', error);
    return { healthy: false, message: error.message };
  }
  }

  /**
   * 切换 Context Adapter
   * @param {string} projectRoot 项目根目录
   * @param {string} adapterName Adapter 名称
   * @param {Object} config Adapter 配置
   * @returns {Promise<IContextAdapter>} 新激活的 Adapter
   */
  async switchAdapter(projectRoot, adapterName, config = {}) {
  try {
    const adapter = this.adapterManager.setCurrent(projectRoot, adapterName, config);
    await adapter.init();
    return adapter;
  } catch (error) {
    this.logger.error(`Failed to switch adapter to '${adapterName}':`, error);
    throw error;
  }
  }

  /**
   * 列出所有可用 Adapter
   * @returns {Array<string>}
   */
  listAdapters() {
  return this.adapterManager.list();
  }

  /**
   * 获取当前项目使用的 Adapter 名称
   * @param {string} projectRoot 项目根目录
   * @returns {string|null}
   */
  getCurrentAdapter(projectRoot) {
  return this.adapterManager.getCurrentName(projectRoot);
  }

  /**
   * 注册自定义 Adapter
   * @param {string} name Adapter 名称
   * @param {class} AdapterClass Adapter 类
   * @returns {ContextService} this
   */
  registerAdapter(name, AdapterClass) {
  this.adapterManager.register(name, AdapterClass);
  return this;
  }

  /**
   * 获取服务统计信息
   * @returns {Object}
   */
  getStats() {
  return {
    service: 'context',
    adapterStats: this.adapterManager.getStats()
  };
  }

  /**
   * 清空缓存
   * @param {string} [projectRoot] 项目根目录，不传则清空所有
   */
  clearCache(projectRoot) {
  this.adapterManager.clearCache(projectRoot);
  }

  /**
   * 获取 Adapter Manager（高级用法）
   * @returns {AdapterManager}
   */
  getAdapterManager() {
  return this.adapterManager;
  }

  /**
   * 关闭所有 Adapter 连接
   * @returns {Promise<void>}
   */
  async close() {
  await this.adapterManager.closeAll();
  }

  /**
   * 包装错误信息
   * @private
   */
  _wrapError(error) {
  if (error.code === 'ContextAdapterNotFoundError' || error.code === 'ContextError') {
    return error;
  }

  if (!error.code) {
    error.code = 'ContextError';
    error.timestamp = new Date().toISOString();
  }

  return error;
  }
}

module.exports = ContextService;
