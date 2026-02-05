#!/usr/bin/env node

/**
 * 职责：
 * - 提供路径相关的基础能力（Xcode CodeSnippets 输出目录、AutoSnippet 缓存目录）
 * - 统一通过 HOME/USERPROFILE 计算路径，并确保目录存在
 *
 * 核心方法：
 * - getSnippetsPath(): 返回 ~/Library/Developer/Xcode/UserData/CodeSnippets，并确保目录存在
 * - getCachePath(): 返回 ~/.autosnippet/cache，并确保目录存在
 */

const path = require('path');
const fs = require('fs');

function getSnippetsPath() {
  if (process.env.ASD_SNIPPETS_PATH) return process.env.ASD_SNIPPETS_PATH;
  const USER_HOME = process.env.HOME || process.env.USERPROFILE;
  const snippetsPath = path.join(USER_HOME, 'Library/Developer/Xcode/UserData/CodeSnippets');
  try {
  fs.accessSync(snippetsPath, fs.constants.F_OK);
  } catch {
  try { fs.mkdirSync(snippetsPath, { recursive: true }); } catch (e) {}
  }
  return snippetsPath;
}

function getCachePath() {
  if (process.env.ASD_CACHE_PATH) return process.env.ASD_CACHE_PATH;
  const USER_HOME = process.env.HOME || process.env.USERPROFILE;
  const cachePath = path.join(USER_HOME, '.autosnippet', 'cache');
  try {
  fs.accessSync(cachePath, fs.constants.F_OK);
  } catch {
  try { fs.mkdirSync(cachePath, { recursive: true }); } catch (e) {}
  }
  return cachePath;
}

/**
 * 获取项目知识库根目录名称（用户项目可配置）
 * 优先级：boxspec.knowledgeBase.dir > 'AutoSnippet'（默认）
 * @param {string} projectRoot - 项目根目录
 * @returns {string} 知识库目录名
 */
const SPEC_FILENAME = 'AutoSnippet.boxspec.json';

/**
 * 获取项目知识库根目录名称（开发环境：发现包含 AutoSnippet.boxspec.json 的子目录）
 * 约定：仅开发环境有“项目根”；项目根下含 AutoSnippet.boxspec.json 的子目录即知识库目录
 */
function getKnowledgeBaseDirName(projectRoot) {
  try {
  const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith('.')) {
    const specPath = path.join(projectRoot, e.name, SPEC_FILENAME);
    if (fs.existsSync(specPath)) {
      return e.name;
    }
    }
  }
  } catch (e) {}
  return 'AutoSnippet';
}

/**
 * 获取项目内部的知识库目录路径（扫描含 AutoSnippet.boxspec.json 的子目录，否则 projectRoot/AutoSnippet）
 */
function getProjectKnowledgePath(projectRoot) {
  const dirName = getKnowledgeBaseDirName(projectRoot);
  const dataPath = path.join(projectRoot, dirName);
  if (!fs.existsSync(dataPath)) {
  try { fs.mkdirSync(dataPath, { recursive: true }); } catch (e) {}
  }
  return dataPath;
}

/**
 * 获取项目唯一 spec 文件路径（开发环境：AutoSnippet/AutoSnippet.boxspec.json）
 */
function getProjectSpecPath(projectRoot) {
  return path.join(getProjectKnowledgePath(projectRoot), SPEC_FILENAME);
}

/**
 * 获取项目内部的隐藏数据目录（用于缓存、候选等）
 * 默认为 [ProjectRoot]/AutoSnippet/.autosnippet
 */
function getProjectInternalDataPath(projectRoot) {
  const dataPath = path.join(getProjectKnowledgePath(projectRoot), '.autosnippet');
  if (!fs.existsSync(dataPath)) {
  try { fs.mkdirSync(dataPath, { recursive: true }); } catch (e) {}
  }
  return dataPath;
}

/**
 * 获取上下文存储根目录
 * 默认为 [ProjectRoot]/AutoSnippet/.autosnippet/context
 */
function getContextStoragePath(projectRoot) {
  const dataPath = path.join(getProjectInternalDataPath(projectRoot), 'context');
  if (!fs.existsSync(dataPath)) {
  try { fs.mkdirSync(dataPath, { recursive: true }); } catch (e) {}
  }
  return dataPath;
}

/**
 * 获取上下文索引目录（由 Storage Adapter 管理）
 * 默认为 [ProjectRoot]/AutoSnippet/.autosnippet/context/index
 */
function getContextIndexPath(projectRoot) {
  const indexPath = path.join(getContextStoragePath(projectRoot), 'index');
  if (!fs.existsSync(indexPath)) {
  try { fs.mkdirSync(indexPath, { recursive: true }); } catch (e) {}
  }
  return indexPath;
}

/**
 * 获取项目 Recipe 目录（可配置）
 * 优先使用 rootSpec.recipes.dir 或 rootSpec.skills.dir（兼容旧配置），否则为 {knowledgeBase}/recipes
 * @param {string} projectRoot - 项目根目录
 * @param {object} [rootSpec] - 已读取的 root spec（可选，避免重复读文件）
 * @returns {string} recipes 目录绝对路径
 */
function getProjectRecipesPath(projectRoot, rootSpec) {
  const dir = (rootSpec && (rootSpec.recipes?.dir || rootSpec.skills?.dir))
  ? (rootSpec.recipes?.dir || rootSpec.skills?.dir)
  : null;
  if (dir) {
  return path.join(projectRoot, dir);
  }
  return path.join(getProjectKnowledgePath(projectRoot), 'recipes');
}

module.exports = {
  SPEC_FILENAME,
  getSnippetsPath,
  getCachePath,
  getKnowledgeBaseDirName,
  getProjectKnowledgePath,
  getProjectSpecPath,
  getProjectInternalDataPath,
  getContextStoragePath,
  getContextIndexPath,
  getProjectRecipesPath
};

