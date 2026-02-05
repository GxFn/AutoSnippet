/**
 * Guard 统一接入：按语言分发到各语言规则模块（guardRules-iOS、guardRules-Android 等）
 * - 本文件只做路由与聚合，不承载具体规则
 * - iOS（objc/swift）→ guardRules-iOS.js；其他语言新增对应文件并在此注册即可
 */

const path = require('path');

/** 语言与模块映射（懒加载避免循环依赖） */
const LANGUAGE_MODULES = {
  objc: () => require('./guardRules-iOS'),
  swift: () => require('./guardRules-iOS')
  // 后续可加: kotlin: () => require('./guardRules-Android'), java: () => require('./guardRules-Android')
};

/**
 * 根据文件路径推断语言（供 runStaticCheckForScope 等使用）
 * @param {string} relativePath 相对 projectRoot 的路径
 * @returns {string|null} 'objc' | 'swift' | ...
 */
function getLanguageFromPath(relativePath) {
  const ext = (path.extname(relativePath || '') || '').toLowerCase();
  if (ext === '.swift') return 'swift';
  if (ext === '.m' || ext === '.h') return 'objc';
  // if (ext === '.kt') return 'kotlin'; if (ext === '.java') return 'java';
  return null;
}

/**
 * 取某语言对应的规则模块
 * @param {string} language 'objc' | 'swift' | ...
 * @returns {object|null}
 */
function getModule(language) {
  const loader = LANGUAGE_MODULES[language];
  return loader ? loader() : null;
}

// 规则与 JSON 仍由「主模块」托管（当前为 iOS），保证单文件 guard-rules.json
const _ios = () => require('./guardRules-iOS');

function getGuardRules(projectRoot) {
  return _ios().getGuardRules(projectRoot);
}

function addOrUpdateRule(projectRoot, ruleId, rule) {
  return _ios().addOrUpdateRule(projectRoot, ruleId, rule);
}

function getRulesForLanguage(projectRoot, language) {
  return _ios().getRulesForLanguage(projectRoot, language);
}

function getRulesPath(projectRoot) {
  return _ios().getRulesPath(projectRoot);
}

function getDefaultRules() {
  return _ios().DEFAULT_RULES;
}

function runStaticCheck(projectRoot, code, language, scope) {
  const mod = getModule(language);
  return mod ? mod.runStaticCheck(projectRoot, code, language, scope) : [];
}

async function runFileAudit(projectRoot, code, language, currentFilePathRelative, currentFilePathAbsolute, scope) {
  const mod = getModule(language);
  return mod ? await mod.runFileAudit(projectRoot, code, language, currentFilePathRelative, currentFilePathAbsolute, scope) : [];
}

async function runStaticCheckForScope(projectRoot, fileScope, currentFilePathAbsolute, ruleScope) {
  const projectRootNorm = path.resolve(projectRoot);
  const relativePath = path.relative(projectRootNorm, currentFilePathAbsolute || '').replace(/\\/g, '/');
  const language = getLanguageFromPath(relativePath);
  const mod = getModule(language);
  return mod && typeof mod.runStaticCheckForScope === 'function'
  ? await mod.runStaticCheckForScope(projectRoot, fileScope, currentFilePathAbsolute, ruleScope)
  : [];
}

function getSupportedAuditLanguages() {
  const langs = new Set();
  Object.keys(LANGUAGE_MODULES).forEach(lang => langs.add(lang));
  return Array.from(langs);
}

const AUDIT_DIMENSIONS = ['file', 'target', 'project'];

module.exports = {
  getLanguageFromPath,
  getGuardRules,
  addOrUpdateRule,
  getRulesForLanguage,
  getRulesPath,
  getDefaultRules,
  runStaticCheck,
  runFileAudit,
  runStaticCheckForScope,
  getSupportedAuditLanguages,
  AUDIT_DIMENSIONS
};
