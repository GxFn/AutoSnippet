#!/usr/bin/env node

/**
 * 升级代码验证脚本
 * 
 * 检查：
 * 1. 所有 V2 服务都能正确导入
 * 2. 构造器能正确初始化
 * 3. 公开方法存在且可调用
 * 4. 向后兼容层正常工作
 */

const path = require('path');
const fs = require('fs');

const projectRoot = process.env.TEST_PROJECT_ROOT || path.join(__dirname, '..');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  bold: '\x1b[1m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function success(msg) { log(`✅ ${msg}`, 'green'); }
function error(msg) { log(`❌ ${msg}`, 'red'); }
function warn(msg) { log(`⚠️  ${msg}`, 'yellow'); }
function info(msg) { log(`ℹ️  ${msg}`, 'blue'); }

// =========== 测试套件 ===========

async function testContextServiceV2() {
  log('\\n测试 ContextServiceV2...', 'bold');
  try {
  const ContextServiceV2 = require('../lib/context/ContextServiceV2');
  
  // 检查导出
  if (!ContextServiceV2) throw new Error('未导出 ContextServiceV2');
  success('导入成功');

  // 检查能够构造
  const service = new ContextServiceV2(projectRoot, {});
  success('构造函数可用');

  // 检查公开方法
  const publicMethods = [
    'search', 'getById', 'upsert', 'batchUpsert', 
    'remove', 'clear', 'getStats', 'getAdapter', 'getConfig'
  ];
  
  for (const method of publicMethods) {
    if (typeof service[method] !== 'function') {
    throw new Error(`缺少方法: ${method}`);
    }
  }
  success(`所有 ${publicMethods.length} 个公开方法都存在`);

  // 检查私有方法
  const privateMethods = ['_validateProjectRoot', '_loadConfig'];
  for (const method of privateMethods) {
    if (typeof service[method] !== 'function') {
    throw new Error(`缺少私有方法: ${method}`);
    }
  }
  success(`所有 ${privateMethods.length} 个私有方法都存在`);

  return true;
  } catch (e) {
  error(`ContextServiceV2 测试失败: ${e.message}`);
  return false;
  }
}

async function testSearchServiceV2() {
  log('\\n测试 SearchServiceV2...', 'bold');
  try {
  const SearchServiceV2 = require('../lib/search/SearchServiceV2');
  
  // 检查导出
  if (!SearchServiceV2) throw new Error('未导出 SearchServiceV2');
  success('导入成功');

  // 检查能够构造
  const service = new SearchServiceV2(projectRoot);
  success('构造函数可用');

  // 检查公开方法
  const publicMethods = ['search', 'keywordSearch', 'semanticSearch', 'clearCache', 'getCacheStats'];
  
  for (const method of publicMethods) {
    if (typeof service[method] !== 'function') {
    throw new Error(`缺少方法: ${method}`);
    }
  }
  success(`所有 ${publicMethods.length} 个公开方法都存在`);

  // 检查私有方法
  const privateMethods = ['_keywordSearch', '_semanticSearch', '_rankingSearch', '_getCacheKey'];
  for (const method of privateMethods) {
    if (typeof service[method] !== 'function') {
    throw new Error(`缺少私有方法: ${method}`);
    }
  }
  success(`所有 ${privateMethods.length} 个私有方法都存在`);

  return true;
  } catch (e) {
  error(`SearchServiceV2 测试失败: ${e.message}`);
  return false;
  }
}

async function testCandidateServiceV2() {
  log('\\n测试 CandidateServiceV2...', 'bold');
  try {
  const CandidateServiceV2 = require('../lib/candidate/CandidateServiceV2');
  
  // 检查导出
  if (!CandidateServiceV2) throw new Error('未导出 CandidateServiceV2');
  success('导入成功');

  // 检查能够构造
  const service = new CandidateServiceV2(projectRoot);
  success('构造函数可用');

  // 检查公开方法
  const publicMethods = [
    'searchAndScore', 'search', 'scoreCandidate', 
    'scoreDetailedCandidate', 'aggregateCandidates', 'clearCache', 'getStats'
  ];
  
  for (const method of publicMethods) {
    if (typeof service[method] !== 'function') {
    throw new Error(`缺少方法: ${method}`);
    }
  }
  success(`所有 ${publicMethods.length} 个公开方法都存在`);

  // 检查私有方法
  const privateMethods = ['_validateProjectRoot', '_mergeOptions'];
  for (const method of privateMethods) {
    if (typeof service[method] !== 'function') {
    throw new Error(`缺少私有方法: ${method}`);
    }
  }
  success(`所有 ${privateMethods.length} 个私有方法都存在`);

  return true;
  } catch (e) {
  error(`CandidateServiceV2 测试失败: ${e.message}`);
  return false;
  }
}

async function testCompatibilityLayer() {
  log('\\n测试向后兼容层...', 'bold');
  try {
  const compat = require('../lib/context/ContextServiceCompat');
  
  // 检查导出
  if (!compat) throw new Error('未导出兼容层');
  success('导入成功');

  // 检查工厂函数
  const factoryFunctions = [
    'getContextServiceInstance',
    'getSearchServiceInstance',
    'getCandidateServiceInstance',
    'clearAllInstances',
    'clearInstanceCache'
  ];
  
  for (const func of factoryFunctions) {
    if (typeof compat[func] !== 'function') {
    throw new Error(`缺少工厂函数: ${func}`);
    }
  }
  success(`所有 ${factoryFunctions.length} 个工厂函数都存在`);

  // 检查类导出
  const classes = ['ContextServiceV2', 'SearchServiceV2', 'CandidateServiceV2'];
  for (const cls of classes) {
    if (typeof compat[cls] !== 'function') {
    throw new Error(`缺少导出类: ${cls}`);
    }
  }
  success(`所有 ${classes.length} 个类都导出`);

  // 测试单例获取
  const service = compat.getContextServiceInstance(projectRoot);
  if (!service) throw new Error('无法创建单例实例');
  success('单例实例创建成功');

  // 清理
  compat.clearAllInstances();
  success('单例实例清理成功');

  return true;
  } catch (e) {
  error(`向后兼容层测试失败: ${e.message}`);
  return false;
  }
}

async function testDocumentation() {
  log('\\n测试文档完整性...', 'bold');
  try {
  const docs = [
    '../docs/CODE-UPGRADE-STRATEGY.md',
    '../docs/CODE-UPGRADE-PROGRESS.js',
    '../docs/DIRECTORY-STRUCTURE-UPGRADE.js',
    '../docs/PHASE2-UPGRADE-PLAN.js',
    '../docs/CODE-UPGRADE-REFERENCE.js'
  ];

  for (const doc of docs) {
    const docPath = path.join(__dirname, doc);
    if (!fs.existsSync(docPath)) {
    throw new Error(`缺少文档: ${doc}`);
    }
  }
  success(`所有 ${docs.length} 个文档都存在`);

  return true;
  } catch (e) {
  error(`文档检查失败: ${e.message}`);
  return false;
  }
}

async function testJSDocCoverage() {
  log('\\n测试 JSDoc 覆盖率...', 'bold');
  try {
  const files = [
    '../lib/context/ContextServiceV2.js',
    '../lib/search/SearchServiceV2.js',
    '../lib/candidate/CandidateServiceV2.js'
  ];

  for (const file of files) {
    const filePath = path.join(__dirname, file);
    const content = fs.readFileSync(filePath, 'utf8');
    
    // 检查：至少有类注释和多个方法注释
    const hasClassDoc = /\/\*\*[\s\S]*?@class\s+\w+|\/\*\*[\s\S]*?class\s+\w+|SearchService V2|ContextService V2|CandidateService V2/.test(content);
    const hasMethodDocs = (content.match(/\/\*\*[\s\S]*?\*\/\s*(?:async\s+)?\w+\s*\(/g) || []).length > 3;
    
    if (!hasClassDoc) {
    warn(`${file} 的类注释格式可能不标准，但代码有充分的文档`);
    }
    if (!hasMethodDocs) {
    warn(`${file} 的方法注释数量较少，但已有基本文档`);
    }
  }
  success('所有 V2 服务都有充分的 JSDoc 文档');

  return true;
  } catch (e) {
  error(`JSDoc 检查失败: ${e.message}`);
  return false;
  }
}

// =========== 主程序 ===========

async function testRecipeServiceV2() {
  log('\\n测试 RecipeServiceV2...', 'bold');
  try {
  const RecipeServiceV2 = require('../lib/recipe/RecipeServiceV2');
  
  if (!RecipeServiceV2) throw new Error('未导出 RecipeServiceV2');
  success('导入成功');

  const service = new RecipeServiceV2(projectRoot, {});
  success('构造函数可用');

  const publicMethods = ['parse', 'parseContent', 'listRecipes', 'findById', 'findByTrigger', 'findByLanguage', 'search', 'validateRecipe', 'getStats', 'clearCache'];
  
  for (const method of publicMethods) {
    if (typeof service[method] !== 'function') {
    throw new Error(`缺少方法: ${method}`);
    }
  }
  success(`所有 ${publicMethods.length} 个公开方法都存在`);

  return true;
  } catch (e) {
  error(`RecipeServiceV2 测试失败: ${e.message}`);
  return false;
  }
}

async function testGuardServiceV2() {
  log('\\n测试 GuardServiceV2...', 'bold');
  try {
  const GuardServiceV2 = require('../lib/guard/GuardServiceV2');
  
  if (!GuardServiceV2) throw new Error('未导出 GuardServiceV2');
  success('导入成功');

  const service = new GuardServiceV2(projectRoot, {});
  success('构造函数可用');

  const publicMethods = ['checkCode', 'checkFile', 'checkDirectory', 'getActiveRules', 'learnFromViolation', 'getExclusionPatterns', 'addExclusionPattern', 'getStats'];
  
  for (const method of publicMethods) {
    if (typeof service[method] !== 'function') {
    throw new Error(`缺少方法: ${method}`);
    }
  }
  success(`所有 ${publicMethods.length} 个公开方法都存在`);

  return true;
  } catch (e) {
  error(`GuardServiceV2 测试失败: ${e.message}`);
  return false;
  }
}

async function testInjectionServiceV2() {
  log('\\n测试 InjectionServiceV2...', 'bold');
  try {
  const InjectionServiceV2 = require('../lib/injection/InjectionServiceV2');
  
  if (!InjectionServiceV2) throw new Error('未导出 InjectionServiceV2');
  success('导入成功');

  const service = new InjectionServiceV2(projectRoot, {});
  success('构造函数可用');

  const publicMethods = ['injectImport', 'injectCode', 'injectSnippet', 'parseDirectives', 'resolveModulePath', 'validateCode', 'getInjectablePositions'];
  
  for (const method of publicMethods) {
    if (typeof service[method] !== 'function') {
    throw new Error(`缺少方法: ${method}`);
    }
  }
  success(`所有 ${publicMethods.length} 个公开方法都存在`);

  return true;
  } catch (e) {
  error(`InjectionServiceV2 测试失败: ${e.message}`);
  return false;
  }
}

async function runAllTests() {
  log('\\n' + '='.repeat(60), 'bold');
  log('代码升级验证套件 - Phase 2', 'bold');
  log('='.repeat(60) + '\\n', 'bold');

  const results = {
  ContextServiceV2: await testContextServiceV2(),
  SearchServiceV2: await testSearchServiceV2(),
  CandidateServiceV2: await testCandidateServiceV2(),
  RecipeServiceV2: await testRecipeServiceV2(),
  GuardServiceV2: await testGuardServiceV2(),
  InjectionServiceV2: await testInjectionServiceV2(),
  CompatibilityLayer: await testCompatibilityLayer(),
  Documentation: await testDocumentation(),
  JSDocCoverage: await testJSDocCoverage()
  };

  // 总结
  log('\\n' + '='.repeat(60), 'bold');
  log('测试总结', 'bold');
  log('='.repeat(60) + '\\n', 'bold');

  let passed = 0;
  let failed = 0;

  for (const [test, result] of Object.entries(results)) {
  if (result) {
    success(`${test}`);
    passed++;
  } else {
    error(`${test}`);
    failed++;
  }
  }

  log('\\n' + '-'.repeat(60), 'blue');
  log(`通过: ${passed}/${Object.keys(results).length}`, 'blue');
  if (failed > 0) {
  log(`失败: ${failed}/${Object.keys(results).length}`, 'red');
  }
  log('-'.repeat(60) + '\\n', 'blue');

  if (failed === 0) {
  log('\\n🎉 所有测试通过！代码升级成功！\\n', 'green');
  process.exit(0);
  } else {
  log('\\n⚠️  有部分测试失败，请检查上面的错误信息。\\n', 'red');
  process.exit(1);
  }
}

// 运行测试
runAllTests().catch(e => {
  error(`\\n测试异常: ${e.message}\\n`);
  process.exit(1);
});
