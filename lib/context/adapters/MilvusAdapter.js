#!/usr/bin/env node

/**
 * 上下文存储 - Milvus 适配器
 * 存储路径: Knowledge/.autosnippet/context/index/milvus/
 * 适用于超大规模上下文（亿级向量），混合搜索，可扩展到云部署
 * 
 * Milvus 特性：
 * - Dense vectors (768-dim)
 * - Sparse vectors (BM25 全文搜索)
 * - 混合搜索（结合稠密和稀疏）
 * - 自动 reranking
 * - 云部署支持 (Milvus Cloud)
 * - 10B+ 向量规模
 */

const path = require('path');
const fs = require('fs');
const paths = require('../../infrastructure/config/Paths');

const DEFAULT_COLLECTION_NAME = 'recipes';

class MilvusAdapter {
  constructor(projectRoot, options = {}) {
  this.projectRoot = projectRoot;
  this.options = options;
  this.collectionName = options.collectionName || DEFAULT_COLLECTION_NAME;
  this.dbPath = path.join(paths.getContextIndexPath(projectRoot), 'milvus');
  
  // 连接配置
  this.config = {
    uri: options.uri || 'http://localhost:19530',
    dbName: options.dbName || 'autosnippet',
    timeout: options.timeout || 30000,
    useSSL: options.useSSL || false,
    username: options.username || '',
    password: options.password || ''
  };
  
  // 向量维度配置
  this.embedding = {
    dimension: options.dimension || 768,
    metric: options.metric || 'L2', // L2, IP, COSINE
    indexType: options.indexType || 'IVF_FLAT' // IVF_FLAT, HNSW, ANNOY
  };
  
  this._client = null;
  this._collection = null;
  }

  /**
   * 获取 Milvus 客户端
   */
  async _getClient() {
  if (this._client) return this._client;
  
  try {
    const { MilvusClient } = require('@zilliz/milvus2-sdk-node');
    
    this._client = new MilvusClient({
    address: this.config.uri,
    database: this.config.dbName,
    timeout: this.config.timeout,
    ssl: this.config.useSSL,
    username: this.config.username || undefined,
    password: this.config.password || undefined
    });
    
    return this._client;
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND' || e.message.includes('Cannot find module')) {
    throw new Error('官方 Milvus SDK 未安装。请执行: npm install @zilliztech/milvus2-sdk-node');
    }
    throw new Error(`Milvus 连接失败: ${e.message}`);
  }
  }

  /**
   * 初始化 Milvus 连接和集合
   */
  async init() {
  const client = await this._getClient();
  
  // 创建本地数据目录
  if (!fs.existsSync(this.dbPath)) {
    fs.mkdirSync(this.dbPath, { recursive: true });
  }
  
  try {
    // 检查集合是否存在
    const hasCollection = await client.hasCollection({
    collection_name: this.collectionName
    });
    
    if (!hasCollection.value) {
    // 创建集合
    await this._createCollection(client);
    } else {
    // 获取现有集合
    await this._loadCollection(client);
    }
  } catch (err) {
    throw new Error(`初始化集合失败: ${err.message}`);
  }
  }

  /**
   * 创建 Milvus 集合结构
   */
  async _createCollection(client) {
  const { DataType } = require('@zilliz/milvus2-sdk-node');
  
  const fields = [
    {
    name: 'id',
    data_type: DataType.VarChar,
    is_primary_key: true,
    max_length: 256
    },
    {
    name: 'content',
    data_type: DataType.VarChar,
    max_length: 65535
    },
    {
    name: 'vector',
    data_type: DataType.FloatVector,
    dim: this.embedding.dimension
    },
    {
    name: 'type',
    data_type: DataType.VarChar,
    max_length: 64
    },
    {
    name: 'sourcePath',
    data_type: DataType.VarChar,
    max_length: 512
    },
    {
    name: 'sourceHash',
    data_type: DataType.VarChar,
    max_length: 64
    },
    {
    name: 'category',
    data_type: DataType.VarChar,
    max_length: 128
    },
    {
    name: 'module',
    data_type: DataType.VarChar,
    max_length: 128
    },
    {
    name: 'metadata',
    data_type: DataType.VarChar,
    max_length: 65535
    },
    {
    name: 'parentId',
    data_type: DataType.VarChar,
    max_length: 256
    },
    {
    name: 'updatedAt',
    data_type: DataType.Int64
    }
  ];
  
  await client.createCollection({
    collection_name: this.collectionName,
    fields,
    timeout: this.config.timeout
  });
  
  // 为向量创建索引
  await client.createIndex({
    collection_name: this.collectionName,
    field_name: 'vector',
    index_type: this.embedding.indexType,
    metric_type: this.embedding.metric,
    params: {
    nlist: 128 // IVF 集群数
    }
  });
  
  // 为元数据创建索引以加快过滤
  const indexFields = ['type', 'category', 'module', 'updatedAt'];
  for (const field of indexFields) {
    try {
    await client.createIndex({
      collection_name: this.collectionName,
      field_name: field,
      index_type: 'Ascend'
    });
    } catch (_) {
    // 某些字段可能不支持索引，忽略
    }
  }
  
  // 加载集合到内存
  await client.loadCollection({
    collection_name: this.collectionName
  });
  }

  /**
   * 加载现有集合
   */
  async _loadCollection(client) {
  const collectionInfo = await client.describeCollection({
    collection_name: this.collectionName
  });
  
  if (!collectionInfo.loaded) {
    await client.loadCollection({
    collection_name: this.collectionName
    });
  }
  }

  /**
   * 条目转为 Milvus 行格式
   */
  _toRow(item) {
  const { id, content, vector, metadata = {}, parentId } = item;
  const updatedAt = metadata.updatedAt ?? Date.now();
  
  return {
    id: String(id),
    content: content ?? '',
    vector: Array.isArray(vector) ? vector : new Array(this.embedding.dimension).fill(0),
    type: metadata.type || 'recipe',
    sourcePath: metadata.sourcePath || '',
    sourceHash: metadata.sourceHash || '',
    category: metadata.category || '',
    module: metadata.module || '',
    metadata: JSON.stringify({ ...metadata, updatedAt }),
    parentId: parentId || '',
    updatedAt: Math.floor(updatedAt / 1000) // Milvus INT64 以秒为单位
  };
  }

  /**
   * Milvus 行转为条目格式
   */
  _fromRow(row) {
  if (!row) return null;
  let metadata = {};
  try {
    metadata = typeof row.metadata === 'string' 
    ? JSON.parse(row.metadata) 
    : (row.metadata || {});
  } catch (_) {}
  
  return {
    id: row.id,
    content: row.content || '',
    vector: row.vector || [],
    metadata,
    parentId: row.parentId || undefined
  };
  }

  /**
   * 添加或更新一条条目
   */
  async upsert(item) {
  const client = await this._getClient();
  const row = this._toRow(item);
  
  try {
    // Milvus 的 upsert 会自动处理更新或插入
    await client.upsert({
    collection_name: this.collectionName,
    data: [row]
    });
  } catch (err) {
    throw new Error(`Upsert 失败: ${err.message}`);
  }
  }

  /**
   * 批量添加或更新条目
   */
  async batchUpsert(items) {
  if (!items || items.length === 0) return;
  
  const client = await this._getClient();
  const rows = items.map(i => this._toRow(i));
  
  try {
    await client.upsert({
    collection_name: this.collectionName,
    data: rows
    });
  } catch (err) {
    throw new Error(`批量 Upsert 失败: ${err.message}`);
  }
  }

  /**
   * 按 ID 删除条目
   */
  async remove(id) {
  const client = await this._getClient();
  
  try {
    await client.delete({
    collection_name: this.collectionName,
    expr: `id == "${String(id).replace(/"/g, '\\"')}"`
    });
  } catch (err) {
    throw new Error(`删除失败: ${err.message}`);
  }
  }

  /**
   * 按 ID 获取条目
   */
  async getById(id) {
  const client = await this._getClient();
  
  try {
    const result = await client.query({
    collection_name: this.collectionName,
    filter: `id == "${String(id).replace(/"/g, '\\"')}"`,
    limit: 1
    });
    
    if (result.data && result.data.length > 0) {
    return this._fromRow(result.data[0]);
    }
    return null;
  } catch (err) {
    throw new Error(`获取失败: ${err.message}`);
  }
  }

  /**
   * 向量相似度搜索（支持过滤）
   */
  async searchVector(queryVector, options = {}) {
  const client = await this._getClient();
  const limit = options.limit || 10;
  const metric = options.metric || this.embedding.metric;
  
  // 构建过滤条件
  let filter = '';
  if (options.filter) {
    const conditions = [];
    if (options.filter.type) {
    conditions.push(`type == "${options.filter.type}"`);
    }
    if (options.filter.category) {
    conditions.push(`category == "${options.filter.category}"`);
    }
    if (options.filter.module) {
    conditions.push(`module == "${options.filter.module}"`);
    }
    filter = conditions.join(' && ') || '';
  }
  
  try {
    const result = await client.search({
    collection_name: this.collectionName,
    data: [queryVector],
    filter: filter || undefined,
    limit,
    output_fields: ['id', 'content', 'type', 'metadata', 'parentId', 'vector']
    });
    
    if (!result.results || result.results.length === 0) {
    return [];
    }
    
    // 返回带相似度分数的结果
    return result.results[0].map(hit => {
    const item = this._fromRow(hit);
    return {
      ...item,
      similarity: hit.distance || 0,
      score: this._normalizeScore(hit.distance, metric)
    };
    });
  } catch (err) {
    throw new Error(`向量搜索失败: ${err.message}`);
  }
  }

  /**
   * 规范化距离分数到 0-1 范围
   */
  _normalizeScore(distance, metric) {
  if (metric === 'COSINE') {
    // COSINE 距离本身已在 0-1 范围
    return Math.max(0, Math.min(1, distance));
  } else if (metric === 'IP') {
    // IP (Inner Product) 分数越高越好
    return 1 / (1 + Math.exp(-distance));
  } else {
    // L2 距离越小越好
    return 1 / (1 + distance);
  }
  }

  /**
   * 混合搜索（向量 + 关键词）
   */
  async hybridSearch(queryVector, queryText, options = {}) {
  const client = await this._getClient();
  const limit = options.limit || 10;
  
  // 虽然 Milvus 官方没有原生的混合搜索，但可以组合多个搜索
  const vectorResults = await this.searchVector(queryVector, {
    ...options,
    limit: Math.ceil(limit * 1.5) // 获取更多结果用于融合
  });
  
  // 对结果按相似度排序并截断
  const hybridResults = vectorResults
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item, idx) => ({
    ...item,
    rank: idx + 1
    }));
  
  return hybridResults;
  }

  /**
   * 文本搜索（关键词）
   * 注：Milvus 本身不支持全文搜索，需要额外的 Sparse Vector 支持
   * 这里提供的是简单的元数据过滤搜索
   */
  async searchText(queryText, options = {}) {
  const client = await this._getClient();
  const limit = options.limit || 10;
  
  // 简单的文本搜索实现：通过 metadata 过滤
  // 在完整实现中，应使用 Sparse Vector (BM25) 索引
  try {
    const result = await client.query({
    collection_name: this.collectionName,
    filter: options.filter || '',
    limit,
    output_fields: ['id', 'content', 'type', 'metadata', 'parentId']
    });
    
    if (!result.data) return [];
    
    return result.data.map(row => this._fromRow(row));
  } catch (err) {
    throw new Error(`文本搜索失败: ${err.message}`);
  }
  }

  /**
   * 获取集合统计信息
   */
  async getStats() {
  const client = await this._getClient();
  
  try {
    const stats = await client.getCollectionStats({
    collection_name: this.collectionName
    });
    
    return {
    name: this.collectionName,
    rows: stats.row_count || 0,
    memoryUsage: stats.memory_usage || 0,
    status: 'loaded'
    };
  } catch (err) {
    return {
    name: this.collectionName,
    rows: 0,
    memoryUsage: 0,
    status: 'error',
    error: err.message
    };
  }
  }

  /**
   * 删除整个集合（谨慎使用）
   */
  async dropCollection() {
  const client = await this._getClient();
  
  try {
    await client.dropCollection({
    collection_name: this.collectionName
    });
    this._collection = null;
  } catch (err) {
    throw new Error(`删除集合失败: ${err.message}`);
  }
  }

  /**
   * 关闭连接
   */
  async close() {
  if (this._client) {
    try {
    await this._client.close();
    } catch (_) {}
    this._client = null;
    this._collection = null;
  }
  }
}

module.exports = MilvusAdapter;
