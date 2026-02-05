/**
 * Preset 配置加载器
 * 职责：
 * - 从 JSON 文件加载非交互式输入配置
 * - 验证配置结构
 * - 提供默认值合并
 */

const fs = require('fs');
const path = require('path');

/**
 * 从指定路径加载预置配置 JSON
 * @param {string} presetPath - 预置配置文件的完整路径或相对路径
 * @param {Object} defaults - 默认配置值
 * @returns {Object|null} - 解析后的配置对象，加载失败返回 null
 * @throws {Error} 当 presetPath 无效或 JSON 解析失败时
 */
function loadPresetConfig(presetPath, defaults = {}) {
  if (!presetPath) {
  return null;
  }
  
  try {
  const resolvedPath = path.isAbsolute(presetPath)
    ? presetPath
    : path.resolve(process.cwd(), presetPath);
  
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`预置配置文件不存在: ${resolvedPath}`);
  }
  
  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const config = JSON.parse(content);
  
  // 合并默认值
  return {
    ...defaults,
    ...config
  };
  } catch (error) {
  if (error.name === 'SyntaxError') {
    throw new Error(`预置配置 JSON 解析失败: ${error.message}`);
  }
  throw error;
  }
}

/**
 * 验证预置配置的必需字段
 * @param {Object} config - 配置对象
 * @param {string[]} requiredFields - 必需字段列表
 * @returns {string[]} - 缺失的字段列表，全部存在返回空数组
 */
function validatePresetConfig(config, requiredFields = []) {
  const missing = [];
  
  for (const field of requiredFields) {
  if (!(field in config) || config[field] === undefined || config[field] === null) {
    missing.push(field);
  }
  }
  
  return missing;
}

module.exports = {
  loadPresetConfig,
  validatePresetConfig
};
