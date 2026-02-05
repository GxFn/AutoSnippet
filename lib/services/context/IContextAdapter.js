/**
 * Context Adapter 接口
 * 定义所有 Context 存储适配器必须实现的方法
 */
class IContextAdapter {
  /**
   * 获取适配器信息
   * @returns {Object} { name, version, type }
   */
  getInfo() {
  throw new Error('Method getInfo() must be implemented');
  }

  /**
   * 初始化存储（创建目录、建表等）
   * @param {Object} options 初始化选项
   * @returns {Promise<void>}
   * @throws {ContextError}
   */
  async init(options = {}) {
  throw new Error('Method init() must be implemented');
  }

  /**
   * 添加或更新上下文条目
   * @param {Object} item 上下文条目
   * @param {string} item.id 唯一标识
   * @param {string} item.content 内容
   * @param {Array<number>} [item.vector] 向量嵌入
   * @param {Object} item.metadata 元数据
   * @param {string} [item.parentId] 父条目ID
   * @returns {Promise<void>}
   * @throws {ContextError}
   */
  async upsert(item) {
  throw new Error('Method upsert() must be implemented');
  }

  /**
   * 批量添加或更新
   * @param {Array<Object>} items 条目数组
   * @returns {Promise<void>}
   * @throws {ContextError}
   */
  async batchUpsert(items) {
  throw new Error('Method batchUpsert() must be implemented');
  }

  /**
   * 根据 ID 获取条目
   * @param {string} id 条目ID
   * @returns {Promise<Object|null>} 条目或 null
   * @throws {ContextError}
   */
  async getById(id) {
  throw new Error('Method getById() must be implemented');
  }

  /**
   * 删除条目
   * @param {string} id 条目ID
   * @returns {Promise<void>}
   * @throws {ContextError}
   */
  async remove(id) {
  throw new Error('Method remove() must be implemented');
  }

  /**
   * 批量删除
   * @param {Array<string>} ids 条目ID数组
   * @returns {Promise<void>}
   * @throws {ContextError}
   */
  async batchRemove(ids) {
  throw new Error('Method batchRemove() must be implemented');
  }

  /**
   * 向量搜索
   * @param {Array<number>} queryVector 查询向量
   * @param {Object} options 搜索选项
   * @param {number} [options.limit=10] 返回条目数
   * @param {Object} [options.filter] 过滤条件
   * @param {string} [options.metric='cosine'] 距离度量方式
   * @returns {Promise<Array<Object>>} 搜索结果
   * @throws {ContextError}
   */
  async search(queryVector, options = {}) {
  throw new Error('Method search() must be implemented');
  }

  /**
   * 列出所有条目（支持过滤和分页）
   * @param {Object} options 列表选项
   * @param {Object} [options.filter] 过滤条件
   * @param {number} [options.limit] 限制数量
   * @param {number} [options.offset] 偏移量
   * @returns {Promise<Array<Object>>} 条目列表
   * @throws {ContextError}
   */
  async list(options = {}) {
  throw new Error('Method list() must be implemented');
  }

  /**
   * 统计条目数量
   * @param {Object} [filter] 过滤条件
   * @returns {Promise<number>} 条目数量
   * @throws {ContextError}
   */
  async count(filter = {}) {
  throw new Error('Method count() must be implemented');
  }

  /**
   * 清空所有数据
   * @returns {Promise<void>}
   * @throws {ContextError}
   */
  async clear() {
  throw new Error('Method clear() must be implemented');
  }

  /**
   * 健康检查
   * @returns {Promise<{healthy: boolean, message: string}>}
   */
  async healthCheck() {
  throw new Error('Method healthCheck() must be implemented');
  }

  /**
   * 关闭连接和释放资源
   * @returns {Promise<void>}
   */
  async close() {
  throw new Error('Method close() must be implemented');
  }
}

module.exports = IContextAdapter;
