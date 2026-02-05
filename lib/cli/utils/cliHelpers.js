/**
 * CLI 通用工具函数
 * 职责：
 * - Spec 文件查找 (getSpecFile)
 * - 全局选项解析 (getGlobalOptions)
 * - 特殊处理流程
 */

const fs = require('fs');
const path = require('path');

/**
 * 向上查找 AutoSnippet.boxspec.json 配置文件
 * @param {string} startDir - 起始搜索目录
 * @param {Function} callback - 发现文件时的回调 (path) => void
 * @returns {string|null} - 找到的 spec 文件路径，未找到返回 null
 */
function getSpecFile(startDir = process.cwd(), callback = null) {
  let currentDir = path.resolve(startDir);
  const SPEC_FILENAME = 'AutoSnippet.boxspec.json';
  
  while (true) {
  const specPath = path.join(currentDir, SPEC_FILENAME);
  
  if (fs.existsSync(specPath)) {
    if (callback) callback(specPath);
    return specPath;
  }
  
  const parentDir = path.dirname(currentDir);
  if (parentDir === currentDir) {
    // 已到达文件系统根目录
    return null;
  }
  currentDir = parentDir;
  }
}

/**
 * 解析全局命令行选项
 * @param {Object} program - commander 程序对象
 * @returns {Object} - 解析后的全局选项
 */
function getGlobalOptions(program) {
  return {
  preset: program.preset,
  yes: program.yes || false,
  skipCheck: process.env.ASD_SKIP_ENTRY_CHECK === '1',
  cwd: process.env.ASD_CWD || process.cwd()
  };
}

/**
 * 确保 SPM 依赖映射文件存在
 * @param {string} projectRootDir - 项目根目录
 */
function ensureSpmDepMapFile(projectRootDir) {
  const spmMapPath = path.join(projectRootDir, 'AutoSnippet.spmmap.json');
  
  if (!fs.existsSync(spmMapPath)) {
  const spmMap = {
    type: 'spm-map',
    targets: {},
    timestamp: new Date().toISOString()
  };
  fs.writeFileSync(spmMapPath, JSON.stringify(spmMap, null, 2));
  }
  
  return spmMapPath;
}

module.exports = {
  getSpecFile,
  getGlobalOptions,
  ensureSpmDepMapFile
};
