#!/usr/bin/env node

/**
 * 上下文存储模块 - 数据模型与常量
 *
 * ContextItem 结构：
 *   id: string              全局唯一，如 ctx_<hash> 或 recipe_<filename>
 *   content: string         原文内容（分块后为该块内容）
 *   vector?: number[]       嵌入向量，可选
 *   metadata:
 *     type: 'recipe' | 'doc' | 'snippet' | 'architecture'
 *     sourcePath: string    相对项目根的路径
 *     sourceHash?: string   源文件内容 hash，用于增量检测
 *     category?: string     如 modules, foundation, video-player
 *     module?: string        如 BDNetworkControl, Navigation
 *     chunkIndex?: number   分块序号
 *     sectionTitle?: string 若按章节分块，章节标题
 *     updatedAt: number     时间戳
 *     language?: string     如 swift, objectivec, javascript
 *     tags?: string[]       多标签，如 ['network', 'async', 'best-practice']
 *     priority?: number     优先级，越大越优先检索
 *     deprecated?: boolean  是否已过时
 *     author?: string       创建者
 *     version?: string      内容版本
 *   parentId?: string       若为分块，指向父文档 id
 *
 * manifest 结构：
 *   schemaVersion: number   数据模型版本，迁移时校验
 *   indexVersion: number    索引版本，重建时递增
 *   count: number           条目总数
 *   sources?: string[]      索引来源路径摘要
 *   updatedAt: number       最后更新时间
 *   embeddingModel?: string 嵌入模型标识
 *   embeddingDimension?: number 向量维度
 *   storageAdapter?: string 存储适配器类型
 *   lastFullRebuild?: number 上次全量重建时间戳
 */

const defaults = require('../infrastructure/config/Defaults');

const SCHEMA_VERSION = 1;
const MANIFEST_FILENAME = 'manifest.json';

function getSchemaVersion() {
  return SCHEMA_VERSION;
}

function getManifestFilename() {
  return MANIFEST_FILENAME;
}

/**
 * 创建默认 manifest 对象
 */
function createDefaultManifest() {
  return {
  schemaVersion: SCHEMA_VERSION,
  indexVersion: 0,
  count: 0,
  sources: [],
  updatedAt: Date.now(),
  embeddingModel: undefined,
  embeddingDimension: undefined,
  storageAdapter: undefined,
  lastFullRebuild: undefined
  };
}

/**
 * 创建 ContextItem 的 metadata 默认结构
 * @param {Object} opts type, sourcePath, sourceHash?, category?, module?, chunkIndex?, sectionTitle?,
 *   language?, tags?, priority?, deprecated?, author?, version?
 */
function createItemMetadata(opts = {}) {
  return {
  type: opts.type || defaults.SOURCE_TYPE_RECIPE,
  sourcePath: opts.sourcePath || '',
  sourceHash: opts.sourceHash,
  category: opts.category,
  module: opts.module,
  chunkIndex: opts.chunkIndex,
  sectionTitle: opts.sectionTitle,
  updatedAt: opts.updatedAt ?? Date.now(),
  language: opts.language,
  tags: opts.tags,
  priority: opts.priority,
  deprecated: opts.deprecated,
  author: opts.author,
  version: opts.version
  };
}

module.exports = {
  SCHEMA_VERSION,
  MANIFEST_FILENAME,
  getSchemaVersion,
  getManifestFilename,
  createDefaultManifest,
  createItemMetadata
};
