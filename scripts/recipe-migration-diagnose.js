#!/usr/bin/env node

/**
 * Recipe 迁移能力诊断
 * 检查现有工具、脚本、依赖是否满足迁移需求
 * 
 * 用法:
 *   node scripts/recipe-migration-diagnose.js [--fix]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Paths = require('../lib/infrastructure/config/Paths.js');

const projectRoot = path.resolve(__dirname, '..');
const args = require('minimist')(process.argv.slice(2));

// ============ 诊断检查 ============

const checks = {
  environment: [],
  tools: [],
  data: [],
  dependencies: [],
  configuration: []
};

const results = {
  passed: 0,
  warnings: 0,
  failed: 0,
  recommendations: []
};

function check(category, name, condition, message, fixFn = null) {
  const status = condition ? '✅' : '❌';
  const item = { name, status, message, fixFn };
  
  checks[category] = checks[category] || [];
  checks[category].push(item);

  if (condition) {
  results.passed++;
  } else {
  results.failed++;
  if (fixFn && args.fix) {
    try {
    fixFn();
    console.log(`  ⚙️  自动修复: ${name}`);
    } catch (e) {
    console.log(`  ⚠️  修复失败: ${e.message}`);
    }
  }
  }

  console.log(`${status} ${name}`);
  if (message) console.log(`   └─ ${message}`);
}

function section(title) {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60) + '\n');
}

// ============ 环境检查 ============

section('1. 环境检查');

check(
  'environment',
  'Node.js 版本',
  process.versions.node.split('.')[0] >= 12,
  `当前: v${process.versions.node}`,
  null
);

check(
  'environment',
  '项目根目录',
  fs.existsSync(path.join(projectRoot, 'package.json')),
  `检测到: ${projectRoot}`,
  null
);

check(
  'environment',
  'npm/yarn 可用',
  execSync('which npm').toString().length > 0,
  '已安装 npm',
  null
);

// ============ 工具检查 ============

section('2. 核心工具检查');

// 检查 RecipeExtractor
check(
  'tools',
  'RecipeExtractor',
  fs.existsSync(path.join(projectRoot, 'lib/context/RecipeExtractor.js')),
  '元数据提取工具',
  null
);

// 检查 IndexingPipeline
check(
  'tools',
  'IndexingPipeline',
  fs.existsSync(path.join(projectRoot, 'lib/context/IndexingPipeline.js')),
  '向量化索引工具',
  null
);

// 检查迁移脚本
check(
  'tools',
  '迁移脚本 (migrate-recipes-metadata.js)',
  fs.existsSync(path.join(projectRoot, 'scripts/migrate-recipes-metadata.js')),
  '元数据迁移脚本',
  null
);

// 检查 RecipeServiceV2
check(
  'tools',
  'RecipeServiceV2',
  fs.existsSync(path.join(projectRoot, 'lib/application/services/RecipeServiceV2.js')),
  'Recipe 管理服务',
  null
);

// 检查 IntelligentServiceLayer
check(
  'tools',
  'IntelligentServiceLayer',
  fs.existsSync(path.join(projectRoot, 'lib/application/services/IntelligentServiceLayer.js')),
  'AI 增强搜索层',
  null
);

// 检查 parseRecipeMd
check(
  'tools',
  'parseRecipeMd',
  fs.existsSync(path.join(projectRoot, 'lib/recipe/parseRecipeMd.js')),
  'Markdown 解析工具',
  null
);

// ============ 数据检查 ============

section('3. 数据现状检查');

const recipesDir = path.join(projectRoot, 'recipes');
const recipeFiles = fs.existsSync(recipesDir) 
  ? findAllFiles(recipesDir, '.md')
  : [];

check(
  'data',
  '原始 Recipe 数据',
  recipeFiles.length > 0,
  `发现 ${recipeFiles.length} 个 .md 文件`,
  null
);

const metadataDir = path.join(projectRoot, '.autosnippet', 'metadata');
const metadataFiles = fs.existsSync(metadataDir)
  ? findAllFiles(metadataDir, '.json')
  : [];

check(
  'data',
  '已迁移的元数据',
  metadataFiles.length > 0,
  `已迁移 ${metadataFiles.length} 个元数据文件`,
  null
);

const indexDir = path.join(projectRoot, '.autosnippet', 'context', 'index');
const hasIndex = fs.existsSync(path.join(indexDir, 'vector_index.json')) ||
          fs.existsSync(path.join(indexDir, 'milvus'));

check(
  'data',
  '向量索引',
  hasIndex,
  `索引位置: ${indexDir}`,
  null
);

// 数据完整性
if (recipeFiles.length > 0 && metadataFiles.length > 0) {
  const ratio = (metadataFiles.length / recipeFiles.length * 100).toFixed(1);
  check(
  'data',
  '迁移完整性',
  metadataFiles.length >= recipeFiles.length * 0.9,
  `元数据覆盖率: ${ratio}%`,
  null
  );
} else {
  check(
  'data',
  '迁移完整性',
  false,
  '数据不足，无法评估',
  null
  );
}

// ============ 依赖检查 ============

section('4. 依赖检查');

const pkgPath = path.join(projectRoot, 'package.json');
let pkg = {};
try {
  pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
} catch (e) {
  console.log('❌ 无法读取 package.json');
}

const deps = pkg.dependencies || {};
const devDeps = pkg.devDeps || {};

check(
  'dependencies',
  'openai (用于 embedding)',
  deps.openai !== undefined,
  `${deps.openai ? `版本: ${deps.openai}` : '未安装'}`,
  () => {
  execSync('npm install openai', { cwd: projectRoot });
  }
);

check(
  'dependencies',
  'minimist (CLI 参数)',
  deps.minimist !== undefined || devDeps.minimist !== undefined,
  '用于脚本参数解析',
  null
);

// ============ 配置检查 ============

section('5. 配置检查');

const configPath = path.join(projectRoot, 'config', 'knowledge-base.config.js');
check(
  'configuration',
  '知识库配置',
  fs.existsSync(configPath),
  `位置: ${configPath}`,
  null
);

const specPath = Paths.getProjectSpecPath(projectRoot);
check(
  'configuration',
  '项目规格文件',
  fs.existsSync(specPath),
  `位置: ${specPath}`,
  null
);

// 检查配置内容
if (fs.existsSync(configPath)) {
  try {
  const config = require(configPath);
  check(
    'configuration',
    '向量数据库配置',
    config.vectorDb !== undefined,
    `类型: ${config.vectorDb?.type || 'unknown'}`,
    null
  );
  
  check(
    'configuration',
    '嵌入维度',
    config.indexing?.embeddingDimension === 768,
    `维度: ${config.indexing?.embeddingDimension || 'unknown'}`,
    null
  );
  } catch (e) {
  check('configuration', '配置可解析', false, e.message, null);
  }
}

// ============ 能力评估 ============

section('6. 迁移能力评估');

const capabilityStatus = evaluateCapabilities();
console.log('\n📊 能力评分:');
for (const [name, score] of Object.entries(capabilityStatus)) {
  const bar = '█'.repeat(Math.floor(score / 10)) + '░'.repeat(10 - Math.floor(score / 10));
  console.log(`  ${name}: ${bar} ${score}%`);
}

// ============ 最终报告 ============

section('7. 诊断报告');

console.log(`✅ 通过: ${results.passed}`);
console.log(`⚠️  警告: ${results.warnings}`);
console.log(`❌ 失败: ${results.failed}`);
console.log(`\n总体: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}% 就绪`);

// 建议
if (results.failed > 0) {
  console.log('\n🔧 建议修复:');
  
  if (!fs.existsSync(path.join(projectRoot, 'lib/context/RecipeExtractor.js'))) {
  console.log('  1. 核心工具缺失 - 需要实现或安装');
  }
  
  if (metadataFiles.length === 0 && recipeFiles.length > 0) {
  console.log(`  2. 执行元数据迁移:`);
  console.log(`     node scripts/migrate-recipes-metadata.js`);
  }
  
  if (!hasIndex && metadataFiles.length > 0) {
  console.log(`  3. 构建向量索引:`);
  console.log(`     asd embed  (或 node scripts/recipe-migration-complete.js --phase 2)`);
  }
}

// 后续步骤
console.log('\n📋 后续步骤:');
console.log('  1. Phase 1 - 元数据提取:');
console.log('     node scripts/recipe-migration-complete.js --phase 1');
console.log('  2. Phase 2 - 向量化索引:');
console.log('     node scripts/recipe-migration-complete.js --phase 2');
console.log('  3. Phase 3 - 验证兼容:');
console.log('     node scripts/recipe-migration-complete.js --phase 3');
console.log('  4. Phase 4 - 生成报告:');
console.log('     node scripts/recipe-migration-complete.js --phase 4');
console.log('\n  或全量执行:');
console.log('     node scripts/recipe-migration-complete.js');

// ============ 辅助函数 ============

function findAllFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
  const fullPath = path.join(dir, entry.name);
  if (entry.isDirectory()) {
    files.push(...findAllFiles(fullPath, ext));
  } else if (entry.name.endsWith(ext)) {
    files.push(fullPath);
  }
  }
  return files;
}

function evaluateCapabilities() {
  let score = 0;
  
  // 工具可用性 (30%)
  const toolsScore = [
  fs.existsSync(path.join(projectRoot, 'lib/context/RecipeExtractor.js')),
  fs.existsSync(path.join(projectRoot, 'lib/context/IndexingPipeline.js')),
  fs.existsSync(path.join(projectRoot, 'lib/application/services/RecipeServiceV2.js'))
  ].filter(Boolean).length * 10;
  score += Math.min(toolsScore, 30);
  
  // 数据可用性 (30%)
  const dataScore = [
  recipeFiles.length > 0 ? 10 : 0,
  metadataFiles.length > 0 ? 10 : 0,
  hasIndex ? 10 : 0
  ].reduce((a, b) => a + b, 0);
  score += dataScore;
  
  // 依赖完整性 (20%)
  const depsScore = [
  deps.openai !== undefined ? 10 : 0,
  (deps.lancedb !== undefined || deps['@lancedb/lancedb'] !== undefined) ? 10 : 0
  ].reduce((a, b) => a + b, 0);
  score += depsScore;
  
  // 配置完整性 (20%)
  const configScore = [
  fs.existsSync(configPath) ? 10 : 0,
  fs.existsSync(specPath) ? 10 : 0
  ].reduce((a, b) => a + b, 0);
  score += configScore;

  return {
  '工具完整性': Math.min(toolsScore, 30),
  '数据完整性': dataScore,
  '依赖完整性': depsScore,
  '配置完整性': configScore
  };
}

console.log('\n✨ 诊断完成！');
