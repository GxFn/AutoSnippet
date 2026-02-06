/**
 * ContextService V2 - 升级版本
 * 
 * 改进点：
 * - Class 设计，明确的 public/private 接口
 * - 更好的错误处理和日志
 * - 依赖注入支持
 * - 完整的文档注释
 */

const path = require('path');
const fs = require('fs');
const persistence = require('../../context/persistence');
const JsonAdapter = require('../../context/adapters/JsonAdapter');
const defaults = require('../../infrastructure/config/Defaults');
const Paths = require('../../infrastructure/config/Paths.js');

/**
 * Adapter 工厂函数
 */
class AdapterFactory {
  static create(projectRoot, config) {
  const adapterName = (config?.storage?.adapter) || defaults.DEFAULT_STORAGE_ADAPTER;
  
  switch (adapterName) {
    case 'json':
    return new JsonAdapter(projectRoot, config.storage);
    
    case 'milvus':
    try {
      // eslint-disable-next-line global-require
      const MilvusAdapter = require('../../context/adapters/MilvusAdapter');
      return new MilvusAdapter(projectRoot, config.storage);
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND') {
      throw new Error('Milvus SDK 未安装。请执行: npm install milvus');
      }
      throw e;
    }
    
    default:
    throw new Error(`不支持的 context 存储适配器: ${adapterName}。可选: ${defaults.STORAGE_ADAPTERS.join(', ')}`);
  }
  }
}

/**
 * ContextService V2 - 统一的上下文存储服务
 * 
 * 职责：
 * - 管理上下文数据的存储和检索
 * - 提供统一的搜索接口（语义 + 关键词混合）
 * - 处理向量化和查询优化
 * - 管理适配器生命周期
 * 
 * 使用示例：
 * ```javascript
 * const service = new ContextServiceV2(projectRoot);
 * const results = await service.search('keyword', { limit: 10 });
 * await service.upsert({ id: '1', content: 'text' });
 * ```
 */
class ContextServiceV2 {
  constructor(projectRoot, config = null) {
  this._validateProjectRoot(projectRoot);
  
  this.projectRoot = projectRoot;
  this.config = config || this._loadConfig();
  
  // 初始化持久化和适配器
  persistence.cleanupStaleTmpFiles(projectRoot);
  persistence.checkAndMigrate(projectRoot);
  
  this.adapter = AdapterFactory.create(projectRoot, this.config);
  this.logger = this._createLogger();
  this._adapterInitialized = false;
  this._adapterInitPromise = null;
  }

  /**
   * 确保适配器已初始化
   * @private
   * @returns {Promise<void>}
   */
  async _ensureAdapterInitialized() {
  if (this._adapterInitialized) return;
  
  // 避免并发初始化
  if (this._adapterInitPromise) {
    await this._adapterInitPromise;
    return;
  }
  
  this._adapterInitPromise = (async () => {
    if (this.adapter && typeof this.adapter.init === 'function') {
    await this.adapter.init();
    }
    this._adapterInitialized = true;
  })();
  
  await this._adapterInitPromise;
  }

  // ============ Public API ============

  /**
   * 搜索上下文项目
   * 
   * @param {string|number[]} query - 查询文本或向量
   * @param {Object} options - 搜索选项
   *   @param {number} options.limit - 返回数量上限 (默认 5)
   *   @param {Object} options.filter - 元数据过滤条件
   *   @param {string[]} options.keywords - 关键词搜索
   *   @param {string} options.mode - 搜索模式: 'semantic'|'keyword'|'hybrid' (默认 'semantic')
   *   @param {boolean} options.includeContent - 是否返回完整内容 (默认 true)
   * 
   * @returns {Promise<Object[]>} 搜索结果
   */
  async search(query, options = {}) {
  try {
    await this._ensureAdapterInitialized();
    
    const { limit = 5, filter, keywords, mode = 'semantic', includeContent = true } = options;

    let queryVector = [];
    let searchKeywords = keywords;

    // 处理查询向量
    if (Array.isArray(query) && query.length > 0 && typeof query[0] === 'number') {
    queryVector = query;
    } else if (typeof query === 'string' && query.trim()) {
    // 关键词搜索
    if (mode === 'keyword') {
      searchKeywords = keywords || [query];
    } else if (mode === 'hybrid') {
      searchKeywords = keywords ? [...keywords, query] : [query];
    }

    // 语义搜索：调用 AI 进行 embedding
    if (mode !== 'keyword') {
      queryVector = await this._embedQuery(query);
      // embedding 失败时回退到关键词搜索（如无 API Key、context 索引为空等场景）
      if ((!queryVector || queryVector.length === 0) && !searchKeywords) {
      const words = query.split(/\s+/).filter(w => w.length > 1);
      searchKeywords = words.length > 0 ? words : [query];
      }
    }
    }

    const results = await this.adapter.searchVector(queryVector, {
    limit,
    filter,
    metric: 'cosine',
    keywords: searchKeywords
    });

    // 按需返回完整内容
    if (!includeContent) {
    return results.map(r => ({
      id: r.id,
      metadata: r.metadata || {},
      similarity: r.similarity
    }));
    }

    return results;
  } catch (e) {
    this.logger.error('搜索失败', { query, error: e.message });
    throw e;
  }
  }

  /**
   * 根据 ID 获取单个项目
   * 
   * @param {string} id - 项目 ID
   * @returns {Promise<Object|null>} 项目或 null
   */
  async getById(id) {
  return this.adapter.getById(id);
  }

  /**
   * 创建或更新单个项目
   * 
   * @param {Object} item - 项目对象 (需包含 id 字段)
   * @returns {Promise<void>}
   */
  async upsert(item) {
  await this._ensureAdapterInitialized();
  await this.adapter.upsert(item);
  await this._updateManifest();
  }

  /**
   * 批量创建或更新项目
   * 
   * @param {Object[]} items - 项目数组
   * @returns {Promise<void>}
   */
  async batchUpsert(items) {
  if (!items || items.length === 0) return;
  
  await this._ensureAdapterInitialized();
  await this.adapter.batchUpsert(items);
  await this._updateManifest();
  }

  /**
   * 删除单个项目
   * 
   * @param {string} id - 项目 ID
   * @returns {Promise<void>}
   */
  async remove(id) {
  await this._ensureAdapterInitialized();
  await this.adapter.remove(id);
  await this._updateManifest();
  }

  /**
   * 清空所有项目
   * 
   * @returns {Promise<void>}
   */
  async clear() {
  await this._ensureAdapterInitialized();
  await this.adapter.clear();
  const manifest = persistence.readManifest(this.projectRoot);
  persistence.updateManifest(this.projectRoot, {
    count: 0,
    indexVersion: (manifest.indexVersion || 0) + 1
  });
  }

  /**
   * 获取统计信息
   * 
   * @returns {Promise<Object>} { count, indexVersion, ... }
   */
  async getStats() {
  return Promise.resolve(this.adapter.getStats());
  }

  /**
   * 获取底层 Adapter（供高级操作使用）
   * 
   * @returns {Object} 存储适配器实例
   */
  getAdapter() {
  return this.adapter;
  }

  /**
   * 获取当前配置
   * 
   * @returns {Object} 配置对象
   */
  getConfig() {
  return { ...this.config };
  }

  // ============ Private Methods ============

  /**
   * 验证项目根目录
   * @private
   */
  _validateProjectRoot(projectRoot) {
  if (!projectRoot || typeof projectRoot !== 'string') {
    throw new Error('projectRoot 必须是非空字符串');
  }
  }

  /**
   * 从 boxspec 读取配置
   * @private
   */
  _loadConfig() {
  const specPath = Paths.getProjectSpecPath(this.projectRoot);
  
  if (!fs.existsSync(specPath)) {
    return {
    storage: { adapter: defaults.DEFAULT_STORAGE_ADAPTER },
    index: {}
    };
  }

  try {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    return spec.context || {
    storage: { adapter: defaults.DEFAULT_STORAGE_ADAPTER },
    index: {}
    };
  } catch (e) {
    this.logger.warn('读取配置失败，使用默认配置', { error: e.message });
    return {
    storage: { adapter: defaults.DEFAULT_STORAGE_ADAPTER },
    index: {}
    };
  }
  }

  /**
   * 调用 AI 服务对查询进行 embedding
   * @private
   */
  async _embedQuery(query) {
  try {
    // eslint-disable-next-line global-require
    const AiFactory = require('../../ai/AiFactory');
    const ai = await AiFactory.getProvider(this.projectRoot);
    
    if (!ai || typeof ai.embed !== 'function') {
    return [];
    }

    const vec = await ai.embed(query);
    
    // 处理不同的向量返回格式
    let result = [];
    if (Array.isArray(vec)) {
    result = Array.isArray(vec[0]) ? vec[0] : vec;
    }
    
    // 调试：记录向量维度
    if (process.env.ASD_DEBUG === '1' && result.length > 0) {
    console.log(`[ContextServiceV2] Query vector dimension: ${result.length}`);
    }
    
    return result;
  } catch (e) {
    this.logger.warn('[ContextServiceV2] ⚠️  embedding 失败，使用纯关键词搜索', { error: e.message });
    return [];
  }
  }

  /**
   * 更新清单文件的统计信息
   * @private
   */
  async _updateManifest() {
  const stats = await Promise.resolve(this.adapter.getStats());
  persistence.updateManifest(this.projectRoot, { count: stats.count });
  }

  /**
   * 创建 logger 实例
   * @private
   */
  _createLogger() {
  return {
    log: (msg, data) => {
    if (process.env.DEBUG) {
      console.log(`[ContextServiceV2] ${msg}`, data ? JSON.stringify(data) : '');
    }
    },
    warn: (msg, data) => {
    console.warn(`[ContextServiceV2] ⚠️  ${msg}`, data ? JSON.stringify(data) : '');
    },
    error: (msg, data) => {
    console.error(`[ContextServiceV2] ❌ ${msg}`, data ? JSON.stringify(data) : '');
    }
  };
  }
}

module.exports = ContextServiceV2;
