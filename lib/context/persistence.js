#!/usr/bin/env node

/**
 * 上下文存储 - 持久化层
 * 职责：原子写入、manifest 读写、版本号
 */

const fs = require('fs');
const path = require('path');
const paths = require('../infrastructure/config/Paths');
const {
  getManifestFilename,
  createDefaultManifest,
  getSchemaVersion
} = require('./constants');

/**
 * 获取 manifest 文件路径
 * @param {string} projectRoot
 */
function getManifestPath(projectRoot) {
  return path.join(paths.getContextStoragePath(projectRoot), getManifestFilename());
}

/**
 * 原子写入：先写 .tmp 再 rename，避免写一半崩溃导致损坏
 * @param {string} filePath
 * @param {string} content
 */
function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    if (e.code === 'EACCES') {
    throw new Error(`[context/persistence] 权限不足，无法创建目录: ${dir}`);
    }
    throw e;
  }
  }
  const tmpPath = filePath + '.tmp.' + Date.now();
  try {
  fs.writeFileSync(tmpPath, content, 'utf8');
  } catch (e) {
  if (e.code === 'ENOSPC') {
    throw new Error('[context/persistence] 磁盘空间不足，无法写入');
  }
  if (e.code === 'EACCES') {
    throw new Error(`[context/persistence] 权限不足，无法写入: ${tmpPath}`);
  }
  throw e;
  }
  try {
  fs.renameSync(tmpPath, filePath);
  } catch (e) {
  try { fs.unlinkSync(tmpPath); } catch (_) {}
  if (e.code === 'EACCES') {
    throw new Error(`[context/persistence] 权限不足，无法重命名: ${filePath}`);
  }
  throw e;
  }
}

/**
 * 读取 manifest，若不存在或损坏则返回默认
 * @param {string} projectRoot
 */
function readManifest(projectRoot) {
  const manifestPath = getManifestPath(projectRoot);
  if (!fs.existsSync(manifestPath)) {
  return createDefaultManifest();
  }
  try {
  const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (data && typeof data.schemaVersion === 'number') {
    return data;
  }
  } catch (e) {
  console.warn('[context/persistence] manifest 损坏，将使用默认:', e.message);
  }
  return createDefaultManifest();
}

/**
 * 写入 manifest（原子写入）
 * @param {string} projectRoot
 * @param {Object} manifest
 */
function writeManifest(projectRoot, manifest) {
  const manifestPath = getManifestPath(projectRoot);
  manifest.updatedAt = Date.now();
  if (manifest.schemaVersion === undefined) {
  manifest.schemaVersion = getSchemaVersion();
  }
  atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * 更新 manifest 的 count、sources 及其他字段
 * @param {string} projectRoot
 * @param {{ count?: number, sources?: string[], indexVersion?: number,
 *   embeddingModel?: string, embeddingDimension?: number, storageAdapter?: string,
 *   lastFullRebuild?: number }} updates
 */
function updateManifest(projectRoot, updates) {
  const manifest = readManifest(projectRoot);
  if (updates.count !== undefined) manifest.count = updates.count;
  if (updates.sources !== undefined) manifest.sources = updates.sources;
  if (updates.indexVersion !== undefined) manifest.indexVersion = updates.indexVersion;
  if (updates.embeddingModel !== undefined) manifest.embeddingModel = updates.embeddingModel;
  if (updates.embeddingDimension !== undefined) manifest.embeddingDimension = updates.embeddingDimension;
  if (updates.storageAdapter !== undefined) manifest.storageAdapter = updates.storageAdapter;
  if (updates.lastFullRebuild !== undefined) manifest.lastFullRebuild = updates.lastFullRebuild;
  writeManifest(projectRoot, manifest);
}

/**
 * 清理遗留的 .tmp 文件（启动时调用）
 * @param {string} projectRoot
 */
function cleanupStaleTmpFiles(projectRoot) {
  const storagePath = paths.getContextStoragePath(projectRoot);
  const indexPath = paths.getContextIndexPath(projectRoot);
  for (const dir of [storagePath, indexPath]) {
  if (!fs.existsSync(dir)) continue;
  try {
    const files = fs.readdirSync(dir);
    for (const f of files) {
    if (/\.tmp\.\d+$/.test(f)) {
      try {
      fs.unlinkSync(path.join(dir, f));
      } catch (_) {}
    }
    }
  } catch (_) {}
  }
}

/**
 * 检查并执行数据迁移（schemaVersion 升级时）
 * @param {string} projectRoot
 * @returns {boolean} 是否执行了迁移
 */
function checkAndMigrate(projectRoot) {
  const manifest = readManifest(projectRoot);
  const current = manifest.schemaVersion;
  const target = getSchemaVersion();
  if (current >= target) return false;
  manifest.schemaVersion = target;
  const defaultManifest = createDefaultManifest();
  if (manifest.embeddingModel === undefined) manifest.embeddingModel = defaultManifest.embeddingModel;
  if (manifest.embeddingDimension === undefined) manifest.embeddingDimension = defaultManifest.embeddingDimension;
  if (manifest.storageAdapter === undefined) manifest.storageAdapter = defaultManifest.storageAdapter;
  if (manifest.lastFullRebuild === undefined) manifest.lastFullRebuild = defaultManifest.lastFullRebuild;
  writeManifest(projectRoot, manifest);
  return true;
}

module.exports = {
  getManifestPath,
  atomicWrite,
  readManifest,
  writeManifest,
  updateManifest,
  cleanupStaleTmpFiles,
  checkAndMigrate
};
