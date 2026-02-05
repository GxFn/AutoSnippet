#!/usr/bin/env node

/**
 * 上下文存储 - JSON 文件适配器
 * 存储路径: {knowledgeBase}/.autosnippet/context/index/vector_index.json
 * 格式: { version: '1.0', items: [{ id, vector, content, metadata, updatedAt }] }
 * 与现有 VectorStore 的 items 格式兼容，便于渐进迁移
 * 
 * Phase 4: 迁移到新架构，继承 BaseContextAdapter
 */

const fs = require('fs');
const path = require('path');
const paths = require('../../infrastructure/config/Paths');
const VectorMath = require('../../infrastructure/vector/VectorMath');
const persistence = require('../persistence');
const BaseContextAdapter = require('../../services/context/BaseContextAdapter');

const INDEX_FILENAME = 'vector_index.json';
const DATA_VERSION = '1.0';

class JsonAdapter extends BaseContextAdapter {
  constructor(projectRoot, config = {}) {
  super(projectRoot, config);
  this.indexPath = path.join(paths.getContextIndexPath(projectRoot), INDEX_FILENAME);
  this.oldIndexPath = path.join(paths.getProjectInternalDataPath(projectRoot), INDEX_FILENAME);
  this.data = null;
  
  // 同步初始化（因为是本地文件操作）
  this.data = this._load();
  this.initialized = true;
  }

  _load() {
  // 优先读新路径
  if (fs.existsSync(this.indexPath)) {
    try {
    return JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
    } catch (e) {
    console.warn('[JsonAdapter] 索引文件损坏，将重新创建');
    }
  }
  // 兼容：若旧路径存在且新路径不存在，一次性迁移
  if (fs.existsSync(this.oldIndexPath)) {
    try {
    const data = JSON.parse(fs.readFileSync(this.oldIndexPath, 'utf8'));
    if (data && data.items && Array.isArray(data.items)) {
      this._save(data);
      return data;
    }
    } catch (e) {
    console.warn('[JsonAdapter] 旧索引迁移失败:', e.message);
    }
  }
  return { version: DATA_VERSION, items: [] };
  }

  _save(data) {
  const dir = path.dirname(this.indexPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  persistence.atomicWrite(this.indexPath, JSON.stringify(data, null, 2));
  }

  async init() {
  // 构造函数中已同步初始化，此方法保留供兼容性，可重新加载数据
  if (!this.data) {
    this.data = this._load();
  }
  this.initialized = true;
  }

  async upsert(item) {
  this.ensureInitialized();
  this.validateItem(item);
  
  const { id, content, vector, metadata = {}, parentId } = item;
  const updatedAt = metadata.updatedAt ?? Date.now();
  const entry = {
    id,
    content: content ?? '',
    vector: vector || [],
    metadata: { ...metadata, updatedAt },
    updatedAt,
    ...(parentId !== undefined && { parentId })
  };
  const index = this.data.items.findIndex(i => i.id === id);
  if (index >= 0) {
    this.data.items[index] = entry;
  } else {
    this.data.items.push(entry);
  }
  this._save(this.data);
  }

  async batchUpsert(items) {
  this.ensureInitialized();
  if (!items || items.length === 0) return;
  
  for (const item of items) {
    this.validateItem(item);
    const { id, content, vector, metadata = {}, parentId } = item;
    const updatedAt = metadata.updatedAt ?? Date.now();
    const entry = {
    id,
    content: content ?? '',
    vector: vector || [],
    metadata: { ...metadata, updatedAt },
    updatedAt,
    ...(parentId !== undefined && { parentId })
    };
    const index = this.data.items.findIndex(i => i.id === id);
    if (index >= 0) {
    this.data.items[index] = entry;
    } else {
    this.data.items.push(entry);
    }
  }
  this._save(this.data);
  }

  async remove(id) {
  this.ensureInitialized();
  const prev = this.data.items.length;
  this.data.items = this.data.items.filter(item => item.id !== id);
  if (this.data.items.length !== prev) {
    this._save(this.data);
  }
  }

  async getById(id) {
  this.ensureInitialized();
  const item = this.data.items.find(i => i.id === id);
  if (!item) return null;
  return {
    id: item.id,
    content: item.content,
    vector: item.vector,
    metadata: item.metadata || {},
    parentId: item.parentId
  };
  }

  _applyFilter(items, filter) {
  if (!filter || typeof filter !== 'object') return items;
  let out = items;
  if (filter.type) {
    out = out.filter(i => (i.metadata && i.metadata.type) === filter.type);
  }
  if (filter.sourcePath) {
    out = out.filter(i => (i.metadata && i.metadata.sourcePath) === filter.sourcePath);
  }
  if (filter.category) {
    out = out.filter(i => (i.metadata && i.metadata.category) === filter.category);
  }
  if (filter.module) {
    out = out.filter(i => (i.metadata && i.metadata.module) === filter.module);
  }
  if (filter.language) {
    const lang = String(filter.language).toLowerCase();
    out = out.filter(i => {
    const m = i.metadata && i.metadata.language;
    if (!m) return true;
    const itemLang = String(m).toLowerCase();
    if (itemLang === lang) return true;
    if (lang === 'objc' && /^objectivec|objective-c$/i.test(itemLang)) return true;
    return false;
    });
  }
  if (filter.deprecated === false) {
    out = out.filter(i => !(i.metadata && i.metadata.deprecated));
  }
  if (filter.tags && Array.isArray(filter.tags)) {
    out = out.filter(i => {
    const itemTags = i.metadata && i.metadata.tags;
    if (!Array.isArray(itemTags)) return false;
    return filter.tags.some(t => itemTags.includes(t));
    });
  }
  return out;
  }

  _keywordMatch(items, keywords) {
  if (!keywords || !Array.isArray(keywords) || keywords.length === 0) return items;
  const lower = keywords.map(k => String(k).toLowerCase()).filter(Boolean);
  
  // 为每个 item 计算关键词匹配分数
  const scored = items.map(i => {
    const text = [
    i.content || '',
    ...(i.metadata ? Object.values(i.metadata).filter(v => typeof v === 'string') : [])
    ].join(' ').toLowerCase();
    
    // 计算匹配分数：匹配的关键词数量 / 总关键词数量
    const matchCount = lower.filter(k => text.includes(k)).length;
    const score = matchCount / lower.length;
    
    return { ...i, _keywordScore: score };
  });
  
  // 只保留至少匹配一个关键词的结果
  return scored.filter(i => i._keywordScore > 0);
  }

  // 重命名 searchVector 为 search 以符合 IContextAdapter 接口
  async search(queryVector, options = {}) {
  this.ensureInitialized();
  const limit = options.limit ?? 5;
  const metric = options.metric || 'cosine';
  const filter = options.filter;
  const keywords = options.keywords;
  const hasVector = queryVector && queryVector.length > 0;
  const hasKeywords = keywords && Array.isArray(keywords) && keywords.length > 0;
  if (this.data.items.length === 0 || (!hasVector && !hasKeywords)) return [];

  let items = this.data.items;
  if (queryVector && queryVector.length > 0) {
    items = items.filter(i => i.vector && i.vector.length > 0);
  }
  items = this._applyFilter(items, filter);
  items = this._keywordMatch(items, keywords);

  if (items.length === 0) return [];

  if (hasVector) {
    const ranked = VectorMath.rank(queryVector, items, metric);
    
    // 如果同时有关键词搜索，需要综合向量相似度和关键词匹配度
    if (hasKeywords) {
    const reranked = ranked.map(item => {
      const vectorScore = item.similarity || 0;
      const keywordScore = item._keywordScore || 0;
      
      // 综合得分：向量相似度 70% + 关键词匹配度 30%
      // 如果关键词完全匹配（score=1），则给予更高权重
      const weight = keywordScore === 1 ? 0.5 : 0.3;
      const finalScore = vectorScore * (1 - weight) + keywordScore * weight;
      
      return { ...item, similarity: finalScore };
    });
    
    // 按综合得分重新排序
    reranked.sort((a, b) => b.similarity - a.similarity);
    return reranked.slice(0, limit);
    }
    
    return ranked.slice(0, limit);
  }
  
  // 纯关键词搜索：按 _keywordScore 排序
  const sorted = items.sort((a, b) => {
    const scoreA = a._keywordScore ?? 0;
    const scoreB = b._keywordScore ?? 0;
    return scoreB - scoreA;  // 从高到低
  });
  
  return sorted.slice(0, limit).map(item => ({
    ...item,
    similarity: item._keywordScore ?? 1
  }));
  }

  // 保留向后兼容的方法名
  async searchVector(queryVector, options = {}) {
  return this.search(queryVector, options);
  }

  // 实现 list 方法以符合 IContextAdapter 接口
  async list(options = {}) {
  this.ensureInitialized();
  let items = [...this.data.items];
  
  if (options.filter) {
    items = this._applyFilter(items, options.filter);
  }
  
  if (options.keywords) {
    items = this._keywordMatch(items, options.keywords);
  }
  
  return this.applyPagination(items, options);
  }

  async searchByFilter(filter = {}) {
  return this._applyFilter(this.data.items, filter);
  }

  async listIds() {
  return this.data.items.map(i => i.id);
  }

  async clear() {
  this.ensureInitialized();
  this.data = { version: DATA_VERSION, items: [] };
  this._save(this.data);
  }

  // 实现 count 方法
  async count(filter = {}) {
  this.ensureInitialized();
  if (Object.keys(filter).length === 0) {
    return this.data.items.length;
  }
  const items = this._applyFilter(this.data.items, filter);
  return items.length;
  }

  // 实现 healthCheck 方法
  async healthCheck() {
  return {
    healthy: this.initialized,
    itemCount: this.data ? this.data.items.length : 0,
    projectRoot: this.projectRoot,
    indexPath: this.indexPath
  };
  }

  // 实现 close 方法
  async close() {
  // JSON adapter 不需要特殊的关闭逻辑
  this.initialized = false;
  }

  // 实现 getInfo 方法
  getInfo() {
  return {
    name: 'json',
    type: 'file-based',
    projectRoot: this.projectRoot,
    initialized: this.initialized,
    itemCount: this.data ? this.data.items.length : 0,
    indexPath: this.indexPath
  };
  }

  // 向后兼容的方法
  getStats() {
  return {
    count: this.data ? this.data.items.length : 0,
    version: this.data ? this.data.version : DATA_VERSION
  };
  }
}

module.exports = JsonAdapter;
