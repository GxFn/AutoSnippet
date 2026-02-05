/**
 * @deprecated 已废弃，请使用 lib/context 模块（ContextService、IndexingPipeline）。
 * 语义索引现统一由 lib/context 管理，存储于 {knowledgeBase}/.autosnippet/context/。
 * 本文件仅保留供兼容参考，不再被业务代码引用。
 */

const fs = require('fs');
const path = require('path');
const VectorMath = require('../infrastructure/vector/VectorMath');
const Paths = require('../infrastructure/config/Paths');

/**
 * 轻量级本地向量存储（已废弃）
 * 依赖底层 lib/infra/vectorMath 做向量计算
 * 存储结构: {knowledgeBase}/.autosnippet/vector_index.json
 * 格式: { version: '1.0', items: [{ id, vector, content, metadata }] }
 */
class VectorStore {
  constructor(projectRoot) {
  this.projectRoot = projectRoot;
  this.indexPath = path.join(Paths.getProjectInternalDataPath(projectRoot), 'vector_index.json');
  this.data = this._load();
  }

  _load() {
  if (fs.existsSync(this.indexPath)) {
    try {
    return JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
    } catch (e) {
    console.warn('[VectorStore] 索引文件损坏，将重新创建');
    }
  }
  return { version: '1.0', items: [] };
  }

  save() {
  const dir = path.dirname(this.indexPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(this.indexPath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  /**
   * 添加或更新向量条目
   */
  upsert(id, vector, content, metadata = {}) {
  const index = this.data.items.findIndex(item => item.id === id);
  const newItem = { id, vector, content, metadata, updatedAt: Date.now() };
  
  if (index !== -1) {
    this.data.items[index] = newItem;
  } else {
    this.data.items.push(newItem);
  }
  }

  /**
   * 按 id 删除一条
   */
  remove(id) {
  const prev = this.data.items.length;
  this.data.items = this.data.items.filter(item => item.id !== id);
  if (this.data.items.length !== prev) this.save();
  }

  /**
   * 向量相似度搜索（底层计算由 VectorMath 提供）
   * @param {number[]} queryVector 查询向量
   * @param {number} limit 返回条数
   * @param {string} metric 'cosine' | 'euclidean'
   */
  search(queryVector, limit = 5, metric = 'cosine') {
  if (!queryVector || this.data.items.length === 0) return [];

  const ranked = VectorMath.rank(queryVector, this.data.items, metric);
  return ranked.slice(0, limit);
  }

  /**
   * 清理索引
   */
  clear() {
  this.data.items = [];
  this.save();
  }
}

module.exports = VectorStore;
