/**
 * 向后兼容适配层
 * 
 * 为旧的函数式 API 提供兼容性，确保 V1 代码继续运行
 * 使用单例实例管理旧版本的功能
 */

const path = require('path');

// 延迟导入：避免循环依赖
// 模块将在首次使用时才加载
let ContextServiceV2;
let SearchServiceV2;
let CandidateServiceV2;
let RecipeServiceV2;
let GuardServiceV2;
let InjectionServiceV2;
let PackageParserV2;
let MarkerLineV2;
let SnippetFactoryV2;
let SpecRepositoryV2;
let SpmDepsServiceV2;
let DirectiveParserV2;
let ModuleResolverV2;
let ImportWriterV2;

// 单例实例缓存
const instances = new Map();

// 辅助函数：延迟加载模块
function lazyRequire(modulePath, varName, cache = {}) {
  return () => {
    if (!cache[varName]) {
      cache[varName] = require(modulePath);
    }
    return cache[varName];
  };
}

const moduleCache = {};
const getContextServiceV2 = lazyRequire('./ContextServiceV2', 'ContextServiceV2', moduleCache);
const getSearchServiceV2 = lazyRequire('./SearchServiceV2', 'SearchServiceV2', moduleCache);
const getCandidateServiceV2 = lazyRequire('../../candidate/CandidateServiceV2', 'CandidateServiceV2', moduleCache);
const getRecipeServiceV2 = lazyRequire('./RecipeServiceV2', 'RecipeServiceV2', moduleCache);
const getGuardServiceV2 = lazyRequire('./GuardServiceV2', 'GuardServiceV2', moduleCache);
const getInjectionServiceV2 = lazyRequire('../../injection/InjectionServiceV2', 'InjectionServiceV2', moduleCache);
const getPackageParserV2 = lazyRequire('../../infrastructure/external/spm/PackageParserV2', 'PackageParserV2', moduleCache);
const getMarkerLineV2 = lazyRequire('../../snippet/MarkerLineV2', 'MarkerLineV2', moduleCache);
const getSnippetFactoryV2 = lazyRequire('./SnippetFactoryV2', 'SnippetFactoryV2', moduleCache);
const getSpecRepositoryV2 = lazyRequire('./SpecRepositoryV2', 'SpecRepositoryV2', moduleCache);
const getSpmDepsServiceV2 = lazyRequire('../../infrastructure/external/spm/SpmDepsServiceV2', 'SpmDepsServiceV2', moduleCache);
const getDirectiveParserV2 = lazyRequire('../../injection/DirectiveParserV2', 'DirectiveParserV2', moduleCache);
const getModuleResolverV2 = lazyRequire('../../injection/ModuleResolverV2', 'ModuleResolverV2', moduleCache);
const getImportWriterV2 = lazyRequire('../../injection/ImportWriterV2', 'ImportWriterV2', moduleCache);

/**
 * 获取或创建 ContextService 单例
 * @param {string} projectRoot 项目根目录
 * @returns {ContextServiceV2}
 */
function getContextServiceInstance(projectRoot) {
  const key = `context:${projectRoot}`;
  if (!instances.has(key)) {
    const ContextServiceV2 = getContextServiceV2();
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
    const SearchServiceV2 = getSearchServiceV2();
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
    const CandidateServiceV2 = getCandidateServiceV2();
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
    const RecipeServiceV2 = getRecipeServiceV2();
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
    const GuardServiceV2 = getGuardServiceV2();
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
    const InjectionServiceV2 = getInjectionServiceV2();
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
    const PackageParserV2 = getPackageParserV2();
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
    const MarkerLineV2 = getMarkerLineV2();
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
    const SnippetFactoryV2 = getSnippetFactoryV2();
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
    const SpecRepositoryV2 = getSpecRepositoryV2();
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
    const SpmDepsServiceV2 = getSpmDepsServiceV2();
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
    const DirectiveParserV2 = getDirectiveParserV2();
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
    const ModuleResolverV2 = getModuleResolverV2();
    const packageParser = getPackageParserInstance(projectRoot);
		instances.set(key, new ModuleResolverV2(packageParser, { projectRoot }));
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
    const ImportWriterV2 = getImportWriterV2();
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
  
  // 导出类供直接使用（延迟加载）
  get ContextServiceV2() { return getContextServiceV2(); },
  get SearchServiceV2() { return getSearchServiceV2(); },
  get CandidateServiceV2() { return getCandidateServiceV2(); },
  get RecipeServiceV2() { return getRecipeServiceV2(); },
  get GuardServiceV2() { return getGuardServiceV2(); },
  get InjectionServiceV2() { return getInjectionServiceV2(); },
  get PackageParserV2() { return getPackageParserV2(); },
  get MarkerLineV2() { return getMarkerLineV2(); },
  get SnippetFactoryV2() { return getSnippetFactoryV2(); },
  get SpecRepositoryV2() { return getSpecRepositoryV2(); },
  get SpmDepsServiceV2() { return getSpmDepsServiceV2(); },
  get DirectiveParserV2() { return getDirectiveParserV2(); },
  get ModuleResolverV2() { return getModuleResolverV2(); },
  get ImportWriterV2() { return getImportWriterV2(); }
};
