#!/usr/bin/env node

/**
 * 向量数据库初始化脚本（简化版）
 * 初始化本地向量存储系统，准备 Recipe 索引
 * 当前阶段使用本地 JSON 存储 + 向量缓存
 * 后续可升级到 Milvus Cloud
 */

const path = require('path');
const fs = require('fs');
const kbConfig = require('../config/knowledge-base.config');

const projectRoot = path.resolve(__dirname, '..');
const logPath = path.join(projectRoot, '.autosnippet', 'logs');

// 初始化日志目录
if (!fs.existsSync(logPath)) {
  fs.mkdirSync(logPath, { recursive: true });
}

const logger = {
  log: (msg) => {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${msg}`;
  console.log(logMsg);
  fs.appendFileSync(path.join(logPath, 'init-vector-db.log'), logMsg + '\n');
  },
  error: (msg, err) => {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ERROR: ${msg}`;
  console.error(logMsg);
  if (err) console.error(err);
  fs.appendFileSync(path.join(logPath, 'init-vector-db.log'), logMsg + '\n');
  if (err) fs.appendFileSync(path.join(logPath, 'init-vector-db.log'), err.toString() + '\n');
  }
};

async function initVectorDB() {
  try {
  logger.log('========== 向量数据库初始化开始 ==========');
  logger.log(`存储类型: ${kbConfig.vectorDb.type}`);
  logger.log(`嵌入维度: ${kbConfig.indexing.embeddingDimension}`);
  logger.log(`缓存路径: ${kbConfig.indexing.cachePath}`);
  
  // 1. 初始化本地存储目录
  logger.log('\n[1/5] 初始化本地存储目录...');
  initLocalStorage();
  
  // 2. 初始化索引元数据
  logger.log('[2/5] 初始化索引元数据...');
  initIndexMetadata();
  
  // 3. 初始化缓存系统
  logger.log('[3/5] 初始化向量缓存系统...');
  initVectorCache();
  
  // 4. 初始化检索配置
  logger.log('[4/5] 初始化检索配置...');
  initRetrievalConfig();
  
  // 5. 验证系统状态
  logger.log('[5/5] 验证系统状态...');
  const status = verifySystemStatus();
  
  logger.log('\n========== 向量数据库初始化完成 ==========');
  logger.log('\n✅ 系统已准备好进行 Recipe 索引');
  logger.log(`   - 本地存储: ${path.join(projectRoot, kbConfig.indexing.cachePath)}`);
  logger.log(`   - 索引元数据: ${path.join(projectRoot, '.autosnippet/indexes.json')}`);
  logger.log(`   - 嵌入维度: ${kbConfig.indexing.embeddingDimension}`);
  logger.log(`   - 最大缓存: ${kbConfig.indexing.maxCacheSize} 条`);
  logger.log('\n📌 后续升级路径：');
  logger.log('   1. Phase 1.2: Recipe 元数据扩展与自动提取');
  logger.log('   2. Phase 2: 集成 Milvus Cloud 用于大规模部署');
  logger.log('   3. Phase 3: 实现四层检索漏斗');
  
  return true;
  
  } catch (err) {
  logger.error('初始化失败', err);
  process.exit(1);
  }
}

/**
 * 初始化本地存储目录结构
 */
function initLocalStorage() {
  const dirs = [
  '.autosnippet/cache',           // 向量缓存
  '.autosnippet/indexes',         // 索引存储
  '.autosnippet/memory',          // 记忆系统
  '.autosnippet/memory/episodic', // 情节记忆
  '.autosnippet/logs'             // 日志
  ];
  
  for (const dir of dirs) {
  const fullPath = path.join(projectRoot, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    logger.log(`  ✅ 创建目录: ${dir}`);
  }
  }
}

/**
 * 初始化索引元数据
 */
function initIndexMetadata() {
  const indexMetadataPath = path.join(projectRoot, '.autosnippet', 'indexes.json');
  
  const indexMetadata = {
  version: '1.0.0',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  collections: {
    recipes: {
    name: 'recipes',
    dimension: kbConfig.indexing.embeddingDimension,
    embeddingModel: kbConfig.indexing.embeddingModel,
    indexType: kbConfig.vectorDb.collection.indexType,
    metricType: kbConfig.vectorDb.collection.metricType,
    documentCount: 0,
    lastIndexedAt: null,
    fields: [
      'id',
      'title',
      'language',
      'category',
      'keywords',
      'embedding',
      'authority_score',
      'usage_heat',
      'last_modified',
      'deprecated'
    ]
    }
  },
  statistics: {
    totalEmbeddings: 0,
    cachedEmbeddings: 0,
    cacheHitRate: 0
  }
  };
  
  fs.writeFileSync(indexMetadataPath, JSON.stringify(indexMetadata, null, 2), 'utf-8');
  logger.log(`  ✅ 索引元数据初始化: indexes.json`);
}

/**
 * 初始化向量缓存系统
 */
function initVectorCache() {
  const cachePath = path.join(projectRoot, kbConfig.indexing.cachePath);
  const cacheConfigPath = path.join(cachePath, '.cache-config.json');
  
  const cacheConfig = {
  version: '1.0.0',
  createdAt: new Date().toISOString(),
  maxSize: kbConfig.indexing.maxCacheSize,
  expiry: kbConfig.indexing.cacheExpiry,
  enableCaching: kbConfig.indexing.enableCaching,
  statistics: {
    totalSize: 0,
    entryCount: 0,
    hitCount: 0,
    missCount: 0
  }
  };
  
  fs.writeFileSync(cacheConfigPath, JSON.stringify(cacheConfig, null, 2), 'utf-8');
  logger.log(`  ✅ 向量缓存配置初始化: ${cacheConfigPath}`);
}

/**
 * 初始化检索配置
 */
function initRetrievalConfig() {
  const retrievalConfigPath = path.join(projectRoot, 'config', 'retrieval.config.json');
  const configDir = path.dirname(retrievalConfigPath);
  
  if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
  }
  
  const retrievalConfig = {
  version: '1.0.0',
  createdAt: new Date().toISOString(),
  layers: {
    keyword: {
    enabled: true,
    topK: kbConfig.retrieval.topK.keyword,
    description: 'BM25 全文搜索 + 精确匹配'
    },
    semantic: {
    enabled: true,
    topK: kbConfig.retrieval.topK.semantic,
    embeddingModel: kbConfig.indexing.embeddingModel,
    embeddingDimension: kbConfig.indexing.embeddingDimension,
    description: '密集向量搜索'
    },
    fusion: {
    enabled: true,
    topK: kbConfig.retrieval.topK.fusion,
    weights: kbConfig.retrieval.weights.default,
    description: '多信号融合排序'
    },
    rerank: {
    enabled: true,
    topK: kbConfig.retrieval.topK.final,
    description: '上下文感知重排'
    }
  },
  scenarioWeights: kbConfig.retrieval.weights.scenarios
  };
  
  fs.writeFileSync(retrievalConfigPath, JSON.stringify(retrievalConfig, null, 2), 'utf-8');
  logger.log(`  ✅ 检索配置初始化: config/retrieval.config.json`);
}

/**
 * 验证系统状态
 */
function verifySystemStatus() {
  const status = {
  timestamp: new Date().toISOString(),
  components: {
    localStorage: true,
    indexMetadata: true,
    vectorCache: true,
    retrievalConfig: true
  },
  paths: {
    cache: path.join(projectRoot, kbConfig.indexing.cachePath),
    indexes: path.join(projectRoot, '.autosnippet/indexes.json'),
    memory: path.join(projectRoot, '.autosnippet/memory'),
    logs: path.join(projectRoot, '.autosnippet/logs')
  }
  };
  
  // 验证所有必要文件
  const requiredFiles = [
  '.autosnippet/indexes.json',
  '.autosnippet/cache/.cache-config.json',
  'config/retrieval.config.json'
  ];
  
  for (const file of requiredFiles) {
  const fullPath = path.join(projectRoot, file);
  if (fs.existsSync(fullPath)) {
    logger.log(`  ✅ 验证: ${file}`);
  } else {
    logger.log(`  ⚠️  警告: ${file} 不存在`);
    status.components[file] = false;
  }
  }
  
  return status;
}

// 运行初始化
if (require.main === module) {
  initVectorDB().catch(err => {
  logger.error('未捕获的错误', err);
  process.exit(1);
  });
}

module.exports = { initVectorDB };
