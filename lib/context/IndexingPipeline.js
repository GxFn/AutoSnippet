#!/usr/bin/env node

/**
 * 上下文存储 - 索引管道
 * 流程：扫描 → 分块 → 增量检测 → 嵌入 → 写入
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// 避免循环依赖：延迟加载 getInstance
let getInstance;
const getInstanceLazy = () => {
  if (!getInstance) {
  getInstance = require('./index').getInstance;
  }
  return getInstance;
};
const chunker = require('./chunker');
const persistence = require('./persistence');
const { createItemMetadata } = require('./constants');
const defaults = require('../infrastructure/config/Defaults');
const Paths = require('../infrastructure/config/Paths.js');
const { parseFrontmatter } = require('../recipe/parseRecipeMd');

function getContextConfig(projectRoot) {
  try {
  const configPath = Paths.getProjectSpecPath(projectRoot);
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config.context || {};
  }
  } catch (e) {}
  return {};
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content || '').digest('hex').slice(0, 16);
}

function getAllMdFiles(dir, baseDir = dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const result = [];
  for (const e of entries) {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) {
    result.push(...getAllMdFiles(full, baseDir));
  } else if (e.isFile() && e.name.endsWith('.md')) {
    result.push(path.relative(baseDir, full).replace(/\\/g, '/'));
  }
  }
  return result;
}

function stripFrontmatter(content) {
  return (content || '').replace(/^---[\s\S]*?---/, '').trim() || content;
}

/**
 * 扫描阶段：按配置遍历文件
 * @param {string} projectRoot
 * @param {Object} config context.index 配置
 * @returns {Promise<{ path: string, content: string, mtime: number, type: string }[]>}
 */
async function scan(projectRoot, config) {
  const sources = config?.sources || [...defaults.DEFAULT_SOURCES];
  const items = [];
  for (const src of sources) {
  const p = typeof src === 'string' ? { path: src, type: defaults.SOURCE_TYPE_RECIPE } : src;
  if (p.type === defaults.SOURCE_TYPE_TARGET_README) {
    const targetScanner = require('../spm/targetScanner');
    const targets = await targetScanner.listAllTargets(projectRoot);
    for (const t of targets) {
    const files = await targetScanner.getTargetFilesContent(t, { maxFiles: 1 });
    const readme = files.find(f => /readme\.md$/i.test(f.name));
    if (readme) {
      try {
      const fullContent = fs.readFileSync(readme.path, 'utf8');
      const stat = fs.statSync(readme.path);
      const sourcePath = path.relative(projectRoot, readme.path).replace(/\\/g, '/').replace(/\/+/g, '/');
      items.push({
        path: sourcePath,
        content: stripFrontmatter(fullContent),
        mtime: stat.mtimeMs,
        type: defaults.SOURCE_TYPE_TARGET_README,
        metadata: { targetName: t.name, packageName: t.packageName }
      });
      } catch (e) {
      // skip
      }
    }
    }
    continue;
  }
  const fullPath = path.join(projectRoot, p.path);
  const type = p.type || defaults.SOURCE_TYPE_RECIPE;
  const files = getAllMdFiles(fullPath, fullPath);
  for (const rel of files) {
    const absPath = path.join(fullPath, rel);
    try {
    const content = fs.readFileSync(absPath, 'utf8');
    const stat = fs.statSync(absPath);
    // 只保存相对于源目录的路径，不包含 p.path 前缀（如 "AutoSnippet/recipes"）
    const sourcePath = rel.replace(/\\/g, '/').replace(/\/+/g, '/');
    const metadata = {};
    if (type === defaults.SOURCE_TYPE_RECIPE) {
      const fmMatch = content.trim().match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (fmMatch && fmMatch[1]) {
      const meta = parseFrontmatter(fmMatch[1]);
      if (meta.category) metadata.category = String(meta.category).trim();
      if (meta.language) {
        const lang = String(meta.language).toLowerCase();
        metadata.language = /swift/i.test(lang) ? 'swift' : (/objc|objectivec|objective-c/i.test(lang) ? 'objc' : lang);
      }
      }
    }
    items.push({
      path: sourcePath,
      content: stripFrontmatter(content),
      mtime: stat.mtimeMs,
      type,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined
    });
    } catch (e) {
    // skip
    }
  }
  }
  return items;
}

/**
 * 生成 chunk 的 id
 */
function chunkId(sourcePath, chunkIndex, parentId) {
  const slug = sourcePath.replace(/[/.]/g, '_').replace(/\s/g, '-');
  return parentId ? `${parentId}_c${chunkIndex}` : `doc_${slug}_c${chunkIndex}`;
}

/**
 * 生成整篇的 id（与旧 VectorStore 兼容）
 */
function wholeId(sourcePath, type) {
  const basename = path.basename(sourcePath);
  if (type === defaults.SOURCE_TYPE_RECIPE) return `recipe_${basename}`;
  if (type === defaults.SOURCE_TYPE_TARGET_README) {
  const slug = sourcePath.replace(/[/.]/g, '_').replace(/\s/g, '-').slice(0, 80);
  return `target_readme_${slug}`;
  }
  return `doc_${basename}`;
}

/**
 * 运行索引管道
 * @param {string} projectRoot
 * @param {Object} options { clear?: boolean, onProgress?: (msg) => void }
 * @returns {Promise<{ indexed: number, skipped: number, removed: number }>}
 */
async function run(projectRoot, options = {}) {
  const { clear = false, onProgress } = options;
  const config = getContextConfig(projectRoot);
  const indexConfig = config.index || {};
  const chunkingConfig = indexConfig.chunking || { ...defaults.DEFAULT_CHUNKING };

  const service = getInstanceLazy()(projectRoot);
  const adapter = service.getAdapter();

  if (clear) {
  await service.clear();
  persistence.updateManifest(projectRoot, {
    lastFullRebuild: Date.now(),
    storageAdapter: (config.storage && config.storage.adapter) || defaults.DEFAULT_STORAGE_ADAPTER
  });
  onProgress?.('已清理现有索引');
  }

  const ai = await (async () => {
  const AiFactory = require('../ai/AiFactory');
  return AiFactory.getProvider(projectRoot);
  })();

  if (!ai || typeof ai.embed !== 'function') {
  throw new Error('未配置 AI 或 AI 不支持 embed，请检查配置');
  }

  const scanned = await scan(projectRoot, indexConfig);
  onProgress?.(`扫描到 ${scanned.length} 个文件`);

  let indexed = 0;
  let skipped = 0;
  let removed = 0;

  const existingIds = new Set(await adapter.listIds());

  for (const file of scanned) {
  const { path: sourcePath, content, type, metadata: fileMeta = {} } = file;
  const sourceHash = hashContent(content);
  const parentId = wholeId(sourcePath, type);

  const chunks = chunker.chunk(content, {
    sourcePath,
    type,
    sourceHash,
    updatedAt: Date.now(),
    ...fileMeta
  }, chunkingConfig);

  const chunkIds = chunks.map((c, i) =>
    chunks.length === 1 ? parentId : chunkId(sourcePath, i, parentId)
  );

  const toRemove = chunkIds.filter(id => existingIds.has(id));
  const sourceItems = await adapter.searchByFilter({ type, sourcePath });

  if (sourceItems.length > 0 && sourceItems[0].metadata?.sourceHash === sourceHash) {
    skipped += chunks.length;
    continue;
  }

  for (const item of sourceItems) {
    await adapter.remove(item.id);
    removed++;
    existingIds.delete(item.id);
  }

  const toEmbed = [];
  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i];
    const id = chunkIds[i];
    const meta = createItemMetadata({
    ...ch.metadata,
    sourceHash,
    sourcePath,
    type
    });
    toEmbed.push({
    id,
    content: ch.content,
    metadata: meta,
    parentId: chunks.length > 1 ? parentId : undefined
    });
  }

  for (const item of toEmbed) {
    try {
    let vec = await ai.embed(item.content);
    if (Array.isArray(vec) && vec[0] !== undefined) {
      vec = Array.isArray(vec[0]) ? vec[0] : vec;
    }
    item.vector = vec || [];
    } catch (e) {
    onProgress?.(`embed 失败 ${item.id}: ${e.message}`);
    item.vector = [];
    }
  }

  await service.batchUpsert(toEmbed);
  indexed += toEmbed.length;
  for (const item of toEmbed) {
    existingIds.add(item.id);
  }
  onProgress?.(`.`);
  }

  const stats = await Promise.resolve(adapter.getStats());
  persistence.updateManifest(projectRoot, {
  count: stats.count,
  sources: scanned.map(s => s.path)
  });

  return { indexed, skipped, removed };
}

module.exports = {
  run,
  scan,
  hashContent
};
