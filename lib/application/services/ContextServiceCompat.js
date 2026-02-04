/**
 * 向后兼容适配层
 * 
 * 为旧的函数式 API 提供兼容性，确保 V1 代码继续运行
 * 使用单例实例管理旧版本的功能
 */

const path = require('path');
const ContextServiceV2 = require('./ContextServiceV2');
const SearchServiceV2 = require('./SearchServiceV2');
const CandidateServiceV2 = require('../../candidate/CandidateServiceV2');
const RecipeServiceV2 = require('./RecipeServiceV2');
const GuardServiceV2 = require('./GuardServiceV2');
const InjectionServiceV2 = require('../../injection/InjectionServiceV2');
const PackageParserV2 = require('../../infrastructure/external/spm/PackageParserV2');
const MarkerLineV2 = require('../../snippet/MarkerLineV2');
const SnippetFactoryV2 = require('./SnippetFactoryV2');
const SpecRepositoryV2 = require('./SpecRepositoryV2');
const SpmDepsServiceV2 = require('../../infrastructure/external/spm/SpmDepsServiceV2');
const DirectiveParserV2 = require('../../injection/DirectiveParserV2');
const ModuleResolverV2 = require('../../injection/ModuleResolverV2');
const ImportWriterV2 = require('../../injection/ImportWriterV2');

// 单例实例缓存
const instances = new Map();

/**
 * 获取或创建 ContextService 单例
 * @param {string} projectRoot 项目根目录
 * @returns {ContextServiceV2}
 */
function getContextServiceInstance(projectRoot) {
  const key = `context:${projectRoot}`;
  if (!instances.has(key)) {
    instances.set(key, new ContextServiceV2(projectRoot));
  }
  return instances.get(key);
}

/**
 * 获取或创建 SearchService 单例
 * @param {string} projectRoot 项目根目录
 * @returns {SearchServiceV2}
 */
function getSearchServiceInstance(projectRoot) {
  const key = `search:${projectRoot}`;
  if (!instances.has(key)) {
    instances.set(key, new SearchServiceV2(projectRoot));
  }
  return instances.get(key);
}

/**
 * 获取或创建 CandidateService 单例
 * @param {string} projectRoot 项目根目录
 * @returns {CandidateServiceV2}
 */
function getCandidateServiceInstance(projectRoot) {
  const key = `candidate:${projectRoot}`;
  if (!instances.has(key)) {
    instances.set(key, new CandidateServiceV2(projectRoot));
  }
  return instances.get(key);
}

/**
 * 获取或创建 RecipeService 单例
 * @param {string} projectRoot 项目根目录
 * @returns {RecipeServiceV2}
 */
function getRecipeServiceInstance(projectRoot) {
  const key = `recipe:${projectRoot}`;
  if (!instances.has(key)) {
    instances.set(key, new RecipeServiceV2(projectRoot));
  }
  return instances.get(key);
}

/**
 * 获取或创建 GuardService 单例
 * @param {string} projectRoot 项目根目录
 * @returns {GuardServiceV2}
 */
function getGuardServiceInstance(projectRoot) {
  const key = `guard:${projectRoot}`;
  if (!instances.has(key)) {
    instances.set(key, new GuardServiceV2(projectRoot));
  }
  return instances.get(key);
}

/**
 * 获取或创建 InjectionService 单例
 * @param {string} projectRoot 项目根目录
 * @returns {InjectionServiceV2}
 */
function getInjectionServiceInstance(projectRoot) {
  const key = `injection:${projectRoot}`;
  if (!instances.has(key)) {
    instances.set(key, new InjectionServiceV2(projectRoot));
  }
  return instances.get(key);
}

/**
 * 获取或创建 PackageParser 单例
 * @param {string} projectRoot 项目根目录
 * @returns {PackageParserV2}
 */
function getPackageParserInstance(projectRoot) {
  const key = `packageParser:${projectRoot}`;
  if (!instances.has(key)) {
    instances.set(key, new PackageParserV2(projectRoot));
  }
  return instances.get(key);
}

/**
 * 获取或创建 MarkerLine 单例
 * @param {string} projectRoot 项目根目录
 * @returns {MarkerLineV2}
 */
function getMarkerLineInstance(projectRoot) {
  const key = `markerLine:${projectRoot}`;
  if (!instances.has(key)) {
    instances.set(key, new MarkerLineV2(projectRoot));
  }
  return instances.get(key);
}

/**
 * 获取或创建 SnippetFactory 单例
 * @param {string} projectRoot 项目根目录
 * @returns {SnippetFactoryV2}
 */
function getSnippetFactoryInstance(projectRoot) {
  const key = `snippetFactory:${projectRoot}`;
  if (!instances.has(key)) {
    instances.set(key, new SnippetFactoryV2(projectRoot));
  }
  return instances.get(key);
}

/**
 * 获取或创建 SpecRepository 单例
 * @param {string} projectRoot 项目根目录
 * @returns {SpecRepositoryV2}
 */
function getSpecRepositoryInstance(projectRoot) {
  const key = `specRepository:${projectRoot}`;
  if (!instances.has(key)) {
    instances.set(key, new SpecRepositoryV2(projectRoot));
  }
  return instances.get(key);
}

/**
 * 获取或创建 SpmDepsService 单例
 * @param {string} projectRoot 项目根目录
 * @returns {SpmDepsServiceV2}
 */
function getSpmDepsServiceInstance(projectRoot) {
  const key = `spmDepsService:${projectRoot}`;
  if (!instances.has(key)) {
    instances.set(key, new SpmDepsServiceV2(projectRoot));
  }
  return instances.get(key);
}

/**
 * 获取或创建 DirectiveParser 单例
 * @returns {DirectiveParserV2}
 */
function getDirectiveParserInstance() {
  const key = 'directiveParser:global';
  if (!instances.has(key)) {
    instances.set(key, new DirectiveParserV2());
  }
  return instances.get(key);
}

/**
 * 获取或创建 ModuleResolver 单例
 * @param {string} projectRoot 项目根目录
 * @returns {ModuleResolverV2}
 */
function getModuleResolverInstance(projectRoot) {
  const key = `moduleResolver:${projectRoot}`;
  if (!instances.has(key)) {
    const packageParser = getPackageParserInstance(projectRoot);
    instances.set(key, new ModuleResolverV2(packageParser));
  }
  return instances.get(key);
}

/**
 * 获取或创建 ImportWriter 单例
 * @param {string} projectRoot 项目根目录
 * @returns {ImportWriterV2}
 */
function getImportWriterInstance(projectRoot) {
  const key = `importWriter:${projectRoot}`;
  if (!instances.has(key)) {
    const packageParser = getPackageParserInstance(projectRoot);
    const directiveParser = getDirectiveParserInstance();
    const cacheStore = require('../../infrastructure/cache/CacheStore');
    const notifier = require('../../infrastructure/notification/Notifier');
    
    instances.set(key, new ImportWriterV2({
      packageParser,
      directiveParser,
      cacheStore,
      notifier
    }));
  }
  return instances.get(key);
}

/**
 * 清空所有缓存的实例
 * 用于测试和资源清理
 */
function clearAllInstances() {
  instances.clear();
}

/**
 * 清空特定服务的缓存
 */
function clearInstanceCache(type) {
  const keysToDelete = [];
  for (const [key] of instances) {
    if (type && key.startsWith(`${type}:`)) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach(k => instances.delete(k));
}

module.exports = {
  // 工厂函数
  getContextServiceInstance,
  getSearchServiceInstance,
  getCandidateServiceInstance,
  getRecipeServiceInstance,
  getGuardServiceInstance,
  getInjectionServiceInstance,
  getPackageParserInstance,
  getMarkerLineInstance,
  getSnippetFactoryInstance,
  getSpecRepositoryInstance,
  getSpmDepsServiceInstance,
  getDirectiveParserInstance,
  getModuleResolverInstance,
  getImportWriterInstance,
  
  // 清理函数
  clearAllInstances,
  clearInstanceCache,
  
  // 导出类供直接使用
  ContextServiceV2,
  SearchServiceV2,
  CandidateServiceV2,
  RecipeServiceV2,
  GuardServiceV2,
  InjectionServiceV2,
  PackageParserV2,
  MarkerLineV2,
  SnippetFactoryV2,
  SpecRepositoryV2,
  SpmDepsServiceV2,
  DirectiveParserV2,
  ModuleResolverV2,
  ImportWriterV2
};
