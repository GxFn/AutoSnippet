/**
 * KnowledgeGraph - 知识图谱数据模型与推断引擎
 * 
 * 功能：
 * - 管理 Recipe 之间的依赖、替代、相关关系
 * - 自动推断Recipe间的关系
 * - 支持路径查询和影响分析
 * - 权重管理和关系评分
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class KnowledgeGraph {
  constructor(options = {}) {
  this.entities = new Map(); // recipeId -> Entity metadata
  this.relationships = new Map(); // "from_to_type" -> RelationshipEdge
  this.inverseRelationships = new Map(); // Reverse index for fast lookups
  this.relationshipTypes = {
    REQUIRES: 'requires',        // A 需要 B
    USED_BY: 'used_by',          // A 被 B 使用
    CONFLICTS_WITH: 'conflicts_with', // A 与 B 冲突
    ALTERNATIVE_TO: 'alternative_to',  // A 是 B 的替代
    EXTENDS: 'extends',          // A 扩展 B
    DEPRECATED_BY: 'deprecated_by',  // A 被 B 取代
    RELATED_TO: 'related_to'    // A 相关于 B（弱关系）
  };
  
  this.persistPath = options.persistPath || '.autosnippet/graph';
  this.enablePersist = options.enablePersist !== false;
  
  this.initializePersistence();
  }
  
  /**
   * 初始化持久化存储
   */
  initializePersistence() {
  if (!this.enablePersist) return;
  
  if (!fs.existsSync(this.persistPath)) {
    fs.mkdirSync(this.persistPath, { recursive: true });
  }
  }
  
  /**
   * 添加节点（Recipe）到图谱
   * @param {string} recipeId - Recipe ID
   * @param {Object} metadata - Recipe 元数据
   */
  addEntity(recipeId, metadata = {}) {
  if (!this.entities.has(recipeId)) {
    this.entities.set(recipeId, {
    id: recipeId,
    title: metadata.title || '',
    language: metadata.language || '',
    category: metadata.category || '',
    keywords: metadata.keywords || [],
    semanticTags: metadata.semanticTags || [],
    inDegree: 0,  // 被依赖的次数
    outDegree: 0, // 依赖其他的次数
    pageRank: 1.0,
    createdAt: metadata.createdAt || Date.now(),
    lastModified: metadata.lastModified || Date.now()
    });
  }
  }
  
  /**
   * 添加关系边
   * @param {string} fromId - 源 Recipe ID
   * @param {string} toId - 目标 Recipe ID
   * @param {string} relationType - 关系类型
   * @param {Object} metadata - 关系元数据
   */
  addRelationship(fromId, toId, relationType, metadata = {}) {
  // 检查关系类型是否有效（确保 type 值存在）
  const validTypes = Object.values(this.relationshipTypes);
  if (!validTypes.includes(relationType)) {
    throw new Error(`Invalid relationship type: ${relationType}. Valid types: ${validTypes.join(', ')}`);
  }
  
  if (!this.entities.has(fromId) || !this.entities.has(toId)) {
    throw new Error(`Entity not found: ${fromId} or ${toId}`);
  }
  
  if (fromId === toId) {
    console.warn(`Self-loop detected: ${fromId}`);
    return;
  }
  
  const key = `${fromId}__${toId}__${relationType}`;
  
  if (!this.relationships.has(key)) {
    this.relationships.set(key, {
    from: fromId,
    to: toId,
    type: relationType,
    weight: metadata.weight || 1.0,
    confidence: metadata.confidence || 1.0,
    evidence: metadata.evidence || [],
    createdAt: Date.now(),
    reason: metadata.reason || ''
    });
    
    // 更新度数
    this.entities.get(fromId).outDegree++;
    this.entities.get(toId).inDegree++;
    
    // 更新反向索引
    this.updateInverseRelationships(fromId, toId, relationType);
  }
  }
  
  /**
   * 更新反向关系索引
   */
  updateInverseRelationships(fromId, toId, relationType) {
  const reverseKey = `${toId}__${fromId}`;
  if (!this.inverseRelationships.has(reverseKey)) {
    this.inverseRelationships.set(reverseKey, []);
  }
  this.inverseRelationships.get(reverseKey).push(relationType);
  }
  
  /**
   * 获取 Recipe 的所有依赖
   * @param {string} recipeId - Recipe ID
   * @param {Object} options - 查询选项
   * @returns {Array} 依赖列表
   */
  getDependencies(recipeId, options = {}) {
  const {
    depth = 1,
    includeTypes = ['requires', 'extends'],
    maxResults = Infinity
  } = options;
  
  const visited = new Set();
  const results = [];
  
  const traverse = (currentId, currentDepth) => {
    if (visited.has(currentId) || currentDepth === 0 || results.length >= maxResults) {
    return;
    }
    
    visited.add(currentId);
    
    // 查找所有出向关系
    for (const [key, relationship] of this.relationships) {
    if (relationship.from === currentId && includeTypes.includes(relationship.type)) {
      results.push({
      id: relationship.to,
      type: relationship.type,
      weight: relationship.weight,
      depth: currentDepth,
      reason: relationship.reason
      });
      
      if (currentDepth > 1) {
      traverse(relationship.to, currentDepth - 1);
      }
    }
    }
  };
  
  traverse(recipeId, depth);
  return results;
  }
  
  /**
   * 获取 Recipe 的所有反向依赖（使用者）
   * @param {string} recipeId - Recipe ID
   * @param {Object} options - 查询选项
   * @returns {Array} 使用者列表
   */
  getUsedBy(recipeId, options = {}) {
  const {
    depth = 1,
    includeTypes = ['used_by'],
    maxResults = Infinity
  } = options;
  
  const visited = new Set();
  const results = [];
  
  const traverse = (currentId, currentDepth) => {
    if (visited.has(currentId) || currentDepth === 0 || results.length >= maxResults) {
    return;
    }
    
    visited.add(currentId);
    
    // 查找所有入向关系
    for (const [key, relationship] of this.relationships) {
    if (relationship.to === currentId && includeTypes.includes(relationship.type)) {
      results.push({
      id: relationship.from,
      type: relationship.type,
      weight: relationship.weight,
      depth: currentDepth,
      reason: relationship.reason
      });
      
      if (currentDepth > 1) {
      traverse(relationship.from, currentDepth - 1);
      }
    }
    }
  };
  
  traverse(recipeId, depth);
  return results;
  }
  
  /**
   * 获取替代方案
   * @param {string} recipeId - Recipe ID
   * @returns {Array} 替代方案列表
   */
  getAlternatives(recipeId) {
  const alternatives = [];
  
  for (const [key, relationship] of this.relationships) {
    if (relationship.type === 'alternative_to') {
    if (relationship.from === recipeId) {
      alternatives.push({
      id: relationship.to,
      weight: relationship.weight,
      reason: relationship.reason,
      direction: 'forward'
      });
    } else if (relationship.to === recipeId) {
      alternatives.push({
      id: relationship.from,
      weight: relationship.weight,
      reason: relationship.reason,
      direction: 'reverse'
      });
    }
    }
  }
  
  return alternatives;
  }
  
  /**
   * 获取相关 Recipe
   * @param {string} recipeId - Recipe ID
   * @param {Object} options - 查询选项
   * @returns {Array} 相关 Recipe 列表
   */
  getRelated(recipeId, options = {}) {
  const {
    includeTypes = ['related_to', 'alternative_to'],
    maxResults = 10,
    minWeight = 0
  } = options;
  
  const related = [];
  
  for (const [key, relationship] of this.relationships) {
    if (relationship.weight < minWeight) continue;
    
    if (relationship.from === recipeId && includeTypes.includes(relationship.type)) {
    related.push({
      id: relationship.to,
      type: relationship.type,
      weight: relationship.weight,
      reason: relationship.reason
    });
    } else if (relationship.to === recipeId && includeTypes.includes(relationship.type)) {
    related.push({
      id: relationship.from,
      type: relationship.type,
      weight: relationship.weight,
      reason: relationship.reason
    });
    }
  }
  
  // 按权重排序
  related.sort((a, b) => b.weight - a.weight);
  return related.slice(0, maxResults);
  }
  
  /**
   * 自动推断依赖关系（基于内容相似度和引用）
   * @param {Array} recipes - 所有 Recipe 元数据数组
   * @param {Object} options - 推断选项
   */
  inferDependencies(recipes, options = {}) {
  const {
    similarityThreshold = 0.6,
    keywordMatchThreshold = 0.7,
    enableSemanticInference = true
  } = options;
  
  console.log(`[KnowledgeGraph] 开始推断依赖关系... (共 ${recipes.length} 个 Recipe)`);
  
  let inferredCount = 0;
  
  for (let i = 0; i < recipes.length; i++) {
    const recipe = recipes[i];
    if (!this.entities.has(recipe.id)) {
    this.addEntity(recipe.id, recipe);
    }
    
    // 1. 基于语义标签推断（强相关）
    if (enableSemanticInference && recipe.semanticTags) {
    for (let j = 0; j < recipes.length; j++) {
      if (i === j) continue;
      const other = recipes[j];
      
      const tagOverlap = this.computeSetOverlap(
      recipe.semanticTags,
      other.semanticTags
      );
      
      if (tagOverlap > similarityThreshold) {
      // 如果有明显的顺序关系（通过标签），推断依赖
      if (this.shouldRequire(recipe, other)) {
        this.addRelationship(recipe.id, other.id, 'requires', {
        weight: tagOverlap,
        confidence: 0.8,
        reason: `Semantic tag overlap: ${tagOverlap.toFixed(2)}`
        });
        inferredCount++;
      }
      }
    }
    }
    
    // 2. 基于关键词推断（中等相关）
    if (recipe.keywords) {
    for (let j = 0; j < recipes.length; j++) {
      if (i === j) continue;
      const other = recipes[j];
      if (!other.keywords) continue;
      
      const keywordOverlap = this.computeSetOverlap(
      recipe.keywords,
      other.keywords
      );
      
      if (keywordOverlap > keywordMatchThreshold) {
      // 推断为相关
      const key = `${recipe.id}__${other.id}__related_to`;
      if (!this.relationships.has(key)) {
        this.addRelationship(recipe.id, other.id, 'related_to', {
        weight: keywordOverlap,
        confidence: 0.6,
        reason: `Keyword overlap: ${keywordOverlap.toFixed(2)}`
        });
        inferredCount++;
      }
      }
    }
    }
    
    // 3. 基于类别推断（弱相关）
    if (recipe.category === 'async-patterns') {
    for (let j = 0; j < recipes.length; j++) {
      if (i === j) continue;
      const other = recipes[j];
      
      if (other.category === 'error-handling') {
      // 异步通常需要错误处理
      const key = `${recipe.id}__${other.id}__requires`;
      if (!this.relationships.has(key)) {
        this.addRelationship(recipe.id, other.id, 'requires', {
        weight: 0.5,
        confidence: 0.5,
        reason: `Category inference: ${recipe.category} requires ${other.category}`
        });
        inferredCount++;
      }
      }
    }
    }
  }
  
  console.log(`[KnowledgeGraph] 推断完成，共发现 ${inferredCount} 个新关系`);
  return inferredCount;
  }
  
  /**
   * 计算两个集合的重叠度（0-1）
   */
  computeSetOverlap(set1, set2) {
  if (!Array.isArray(set1) || !Array.isArray(set2)) return 0;
  if (set1.length === 0 || set2.length === 0) return 0;
  
  const intersection = set1.filter(item => set2.includes(item)).length;
  const union = new Set([...set1, ...set2]).size;
  
  return intersection / union;
  }
  
  /**
   * 判断是否应该推断为依赖关系
   */
  shouldRequire(recipe, other) {
  // 简单的启发式规则
  // 如果 other 的 semanticTags 包含 "basic", "fundamental" 等，则应该被 require
  const basicTags = ['basic', 'fundamental', 'core', 'prerequisite'];
  const hasBasicTag = other.semanticTags?.some(tag => basicTags.some(b => tag.includes(b)));
  
  return hasBasicTag;
  }
  
  /**
   * 计算 PageRank 评分
   * @param {number} iterations - 迭代次数
   * @param {number} damping - 阻尼系数
   */
  computePageRank(iterations = 10, damping = 0.85) {
  console.log(`[KnowledgeGraph] 计算 PageRank... (${iterations} 次迭代)`);
  
  const n = this.entities.size;
  if (n === 0) return;
  
  // 初始化 PageRank
  for (const [id, entity] of this.entities) {
    entity.pageRank = 1 / n;
  }
  
  // 迭代计算
  for (let iter = 0; iter < iterations; iter++) {
    const newPageRanks = new Map();
    
    for (const [id, entity] of this.entities) {
    let rank = (1 - damping) / n;
    
    // 累加入向边的 PageRank
    for (const [key, relationship] of this.relationships) {
      if (relationship.to === id && relationship.type === 'requires') {
      const sourceEntity = this.entities.get(relationship.from);
      if (sourceEntity && sourceEntity.outDegree > 0) {
        rank += damping * (sourceEntity.pageRank / sourceEntity.outDegree) * relationship.weight;
      }
      }
    }
    
    newPageRanks.set(id, rank);
    }
    
    // 更新 PageRank
    for (const [id, rank] of newPageRanks) {
    this.entities.get(id).pageRank = rank;
    }
  }
  
  console.log(`[KnowledgeGraph] PageRank 计算完成`);
  }
  
  /**
   * 检测循环依赖
   * @returns {Array} 循环依赖列表
   */
  detectCycles() {
  const cycles = [];
  const visited = new Set();
  const recursionStack = new Set();
  
  const hasCycle = (nodeId, path = []) => {
    visited.add(nodeId);
    recursionStack.add(nodeId);
    path.push(nodeId);
    
    for (const [key, relationship] of this.relationships) {
    if (relationship.from === nodeId && 
      ['requires', 'extends'].includes(relationship.type)) {
      const neighbor = relationship.to;
      
      if (!visited.has(neighbor)) {
      if (hasCycle(neighbor, [...path])) {
        return true;
      }
      } else if (recursionStack.has(neighbor)) {
      // 找到循环
      const cycleStart = path.indexOf(neighbor);
      const cycle = path.slice(cycleStart).concat([neighbor]);
      cycles.push(cycle);
        return true;
      }
    }
    }
    
    recursionStack.delete(nodeId);
    return false;
  };
  
  for (const [id] of this.entities) {
    if (!visited.has(id)) {
    hasCycle(id);
    }
  }
  
  return cycles;
  }
  
  /**
   * 获取统计信息
   */
  getStats() {
  const relationshipCount = {};
  for (const type of Object.values(this.relationshipTypes)) {
    relationshipCount[type] = 0;
  }
  
  for (const [key, rel] of this.relationships) {
    relationshipCount[rel.type] = (relationshipCount[rel.type] || 0) + 1;
  }
  
  const inDegrees = Array.from(this.entities.values()).map(e => e.inDegree);
  const outDegrees = Array.from(this.entities.values()).map(e => e.outDegree);
  
  return {
    entityCount: this.entities.size,
    relationshipCount: this.relationships.size,
    relationshipBreakdown: relationshipCount,
    avgInDegree: inDegrees.length > 0 ? inDegrees.reduce((a, b) => a + b) / inDegrees.length : 0,
    avgOutDegree: outDegrees.length > 0 ? outDegrees.reduce((a, b) => a + b) / outDegrees.length : 0,
    maxInDegree: Math.max(...inDegrees, 0),
    maxOutDegree: Math.max(...outDegrees, 0)
  };
  }
  
  /**
   * 持久化到文件
   */
  persist() {
  if (!this.enablePersist) return;
  
  const data = {
    entities: Array.from(this.entities.entries()),
    relationships: Array.from(this.relationships.entries()),
    metadata: {
    persistedAt: new Date().toISOString(),
    version: '1.0'
    }
  };
  
  const filePath = path.join(this.persistPath, 'graph.json');
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  
  console.log(`[KnowledgeGraph] 图谱已持久化到 ${filePath}`);
  }
  
  /**
   * 从文件加载
   */
  load() {
  if (!this.enablePersist) return;
  
  const filePath = path.join(this.persistPath, 'graph.json');
  
  if (fs.existsSync(filePath)) {
    try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    this.entities = new Map(data.entities);
    this.relationships = new Map(data.relationships);
    
    // 重建反向索引
    for (const [key, relationship] of this.relationships) {
      this.updateInverseRelationships(relationship.from, relationship.to, relationship.type);
    }
    
    console.log(`[KnowledgeGraph] 从 ${filePath} 加载完成`);
    } catch (error) {
    console.error(`[KnowledgeGraph] 加载失败: ${error.message}`);
    }
  }
  }
  
  /**
   * 导出为 GraphML 格式（用于可视化）
   */
  exportGraphML() {
  let graphml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  graphml += '<graphml xmlns="http://graphml.graphdrawing.org/xmlformat/graphml.graphml.org/xmlformat/graphml">\n';
  graphml += '  <key id="title" for="node" attr.name="title" attr.type="string"/>\n';
  graphml += '  <key id="weight" for="edge" attr.name="weight" attr.type="double"/>\n';
  graphml += '  <graph id="knowledge-graph" edgedefault="directed">\n';
  
  // 添加节点
  for (const [id, entity] of this.entities) {
    graphml += `    <node id="${id}">\n`;
    graphml += `      <data key="title">${this.escapeXml(entity.title)}</data>\n`;
    graphml += `    </node>\n`;
  }
  
  // 添加边
  let edgeId = 0;
  for (const [key, relationship] of this.relationships) {
    graphml += `    <edge id="e${edgeId}" source="${relationship.from}" target="${relationship.to}" label="${relationship.type}">\n`;
    graphml += `      <data key="weight">${relationship.weight}</data>\n`;
    graphml += `    </edge>\n`;
    edgeId++;
  }
  
  graphml += '  </graph>\n';
  graphml += '</graphml>\n';
  
  return graphml;
  }
  
  /**
   * 转义 XML 特殊字符
   */
  escapeXml(str) {
  return String(str).replace(/[<>&'"]/g, (c) => {
    switch (c) {
    case '<': return '&lt;';
    case '>': return '&gt;';
    case '&': return '&amp;';
    case '\'': return '&apos;';
    case '"': return '&quot;';
    }
  });
  }
}

module.exports = KnowledgeGraph;
