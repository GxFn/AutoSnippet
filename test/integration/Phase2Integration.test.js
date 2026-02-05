/**
 * Phase 2 集成测试 - 业务层 Hub 的协作验证
 * 
 * 测试场景：
 * 1. RecipeHub + SearchHub 集成：创建 Recipe，索引到 SearchHub，执行搜索
 * 2. RecipeHub + MetricsHub 集成：收集 Recipe 操作的指标
 * 3. SearchHub + MetricsHub 集成：搜索性能指标收集
 * 4. 完整工作流：创建 -> 搜索 -> 统计
 */

const { RecipeHub } = require('../../lib/business/recipe/RecipeHub');
const { SearchHub } = require('../../lib/business/search/SearchHub');
const { MetricsHub } = require('../../lib/business/metrics/MetricsHub');

// 简单的测试框架
const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message = 'Assertion failed') {
  if (!condition) {
  throw new Error(message);
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
  throw new Error(`${message || 'Assertion failed'}: expected ${expected}, got ${actual}`);
  }
}

// ===== 集成测试用例 =====

test('RecipeHub + SearchHub 应该索引和搜索 Recipe', () => {
  const recipeHub = new RecipeHub();
  const searchHub = new SearchHub();

  // 创建 Recipe
  const recipe = recipeHub.create({
  title: 'Caching Best Practices',
  description: 'Learn about caching strategies',
  content: 'Caching is important for performance...',
  category: 'Performance',
  tags: ['cache', 'optimization']
  });

  // 索引到搜索引擎
  searchHub.index({
  id: recipe.id,
  title: recipe.title,
  description: recipe.description,
  content: recipe.content,
  tags: recipe.tags
  });

  // 搜索
  const results = searchHub.searchKeyword('caching');

  assert(results.length > 0);
  assertEqual(results[0].id, recipe.id);
});

test('RecipeHub + MetricsHub 应该收集 Recipe 操作指标', () => {
  const recipeHub = new RecipeHub();
  const metricsHub = new MetricsHub();

  // 记录操作前的指标
  metricsHub.record('recipe.created', 0);

  // 创建多个 Recipe
  const count = 5;
  for (let i = 0; i < count; i++) {
  recipeHub.create({
    title: `Recipe ${i}`,
    description: 'Test',
    category: 'Test'
  });
  metricsHub.counter('recipe.created', 1);
  }

  // 验证指标
  const points = metricsHub.getPoints('recipe.created');
  assertEqual(points.length, count + 1);

  const stats = metricsHub.getStats('recipe.created');
  assertEqual(stats.max, count);
});

test('SearchHub + MetricsHub 应该收集搜索性能指标', () => {
  const searchHub = new SearchHub();
  const metricsHub = new MetricsHub();

  // 索引文档
  for (let i = 0; i < 10; i++) {
  searchHub.index({
    id: `doc${i}`,
    title: `Document ${i}`,
    content: `Content about caching and performance ${i}`
  });
  }

  // 执行搜索并记录性能
  const start = Date.now();
  const results = searchHub.searchKeyword('cache');
  const duration = Date.now() - start;

  metricsHub.histogram('search.latency', duration, { type: 'keyword' }, 'ms');

  assert(Array.isArray(results));
  const latency = metricsHub.getLatest('search.latency');
  assert(latency !== null);
});

test('RecipeHub 应该支持审批流和 MetricsHub 记录', () => {
  const recipeHub = new RecipeHub();
  const metricsHub = new MetricsHub();

  // 创建 Recipe
  const recipe = recipeHub.create({
  title: 'Advanced Caching',
  description: 'Advanced techniques',
  category: 'Performance'
  });

  metricsHub.counter('recipe.submitted', 1);

  // 提交审批
  recipe.submitForReview('reviewer1', 'Great content!');
  metricsHub.counter('recipe.submitted', 1);

  // 审批
  recipe.approve('reviewer1', 'Looks good');
  metricsHub.counter('recipe.approved', 1);

  // 发布
  recipe.publish();
  metricsHub.counter('recipe.published', 1);

  // 验证指标
  const submitted = metricsHub.getStats('recipe.submitted');
  assert(submitted.count >= 2);

  const approved = metricsHub.getStats('recipe.approved');
  assert(approved.count >= 1);
});

test('完整工作流：创建 -> 审批 -> 索引 -> 搜索 -> 统计', () => {
  const recipeHub = new RecipeHub();
  const searchHub = new SearchHub();
  const metricsHub = new MetricsHub();

  // 1. 创建 Recipe
  const recipe = recipeHub.create({
  title: 'Docker Containerization',
  description: 'Container orchestration guide',
  content: 'Docker helps with deployment...',
  category: 'DevOps',
  tags: ['docker', 'containers']
  });

  metricsHub.counter('workflow.created', 1);

  // 2. 审批流
  recipe.submitForReview('reviewer1');
  recipe.approve('reviewer1', 'Good');
  recipe.publish();

  metricsHub.counter('workflow.published', 1);

  // 3. 索引到搜索
  searchHub.index({
  id: recipe.id,
  title: recipe.title,
  description: recipe.description,
  content: recipe.content || 'Docker helps with deployment...',
  tags: recipe.tags
  });

  metricsHub.counter('workflow.indexed', 1);

  // 4. 执行搜索
  const searchStart = Date.now();
  const results = searchHub.searchKeyword('docker');
  const searchDuration = Date.now() - searchStart;

  metricsHub.histogram('workflow.search_latency', searchDuration, {}, 'ms');
  metricsHub.counter('workflow.searched', 1);

  // 5. 验证整个流程
  assert(results.length > 0);
  assertEqual(results[0].id, recipe.id);

  // 检查至少有 3 个指标（created, published/indexed, searched）
  const summary = metricsHub.getSummary();
  assert(summary.metricCount >= 3);
});

test('RecipeHub 应该维护 Recipe 的统计信息', () => {
  const recipeHub = new RecipeHub();

  // 创建 Recipe
  const recipe = recipeHub.create({
  title: 'Testing Strategies',
  description: 'Unit testing guide',
  category: 'Testing'
  });

  const id = recipe.id;

  // 模拟使用
  recipe.view();
  recipe.view();
  recipe.setRating(5);
  recipe.like();

  // 获取统计
  const summaryAll = recipeHub.getAllSummary();
  const updated = summaryAll.find(r => r.id === id);

  assert(updated.stats.views >= 2);
  assert(updated.stats.rating === 5);
});

test('SearchHub 应该支持多种搜索方式的混合', () => {
  const searchHub = new SearchHub();

  // 索引文档
  searchHub.index({
  id: 'doc1',
  title: 'Machine Learning Basics',
  description: 'Introduction to ML',
  content: 'ML is about training models with data',
  tags: ['ml', 'ai']
  });

  searchHub.index({
  id: 'doc2',
  title: 'Deep Learning',
  description: 'Neural networks',
  content: 'Deep learning uses multiple layers',
  tags: ['dl', 'neural']
  });

  // 关键词搜索
  const keyword = searchHub.searchKeyword('learning');
  assert(keyword.length > 0);

  // 语义搜索
  const semantic = searchHub.searchSemantic('machine learning');
  assert(Array.isArray(semantic));

  // 混合搜索
  const hybrid = searchHub.search('learning', { type: 'hybrid' });
  assert(Array.isArray(hybrid));
});

test('MetricsHub 应该支持告警联动', () => {
  const metricsHub = new MetricsHub();

  // 创建告警规则
  const alertId = metricsHub.addAlert(
  'high_latency',
  'api.latency',
  'gt',
  1000,
  60000
  );

  // 记录正常延迟
  metricsHub.histogram('api.latency', 500, { endpoint: '/api/recipes' }, 'ms');
  let alert = metricsHub.getAlert(alertId);
  assertEqual(alert.violations.length, 0);

  // 记录高延迟
  metricsHub.histogram('api.latency', 1500, { endpoint: '/api/recipes' }, 'ms');
  alert = metricsHub.getAlert(alertId);
  assert(alert.violations.length > 0);
});

test('RecipeHub 应该支持版本控制和搜索', () => {
  const recipeHub = new RecipeHub();
  const searchHub = new SearchHub();

  // 创建 Recipe
  let recipe = recipeHub.create({
  title: 'Version Control Git',
  description: 'Git basics',
  content: 'Git is a VCS',
  category: 'DevOps'
  });

  const recipeId = recipe.id;

  // 初始版本索引
  searchHub.index({
  id: recipe.id,
  title: recipe.title,
  description: recipe.description,
  content: recipe.content || 'Git is a VCS'
  });

  // 更新 Recipe（创建新版本）
  recipe.update('Advanced Git techniques for collaboration', {
  author: 'admin',
  changes: 'Updated to advanced content'
  });

  // 验证版本
  assert(recipe.versions.length >= 2);

  // 搜索
  const results = searchHub.searchKeyword('git');
  assert(results.length > 0);
});

test('完整集成：多个 Hub 协同工作', () => {
  const recipeHub = new RecipeHub();
  const searchHub = new SearchHub();
  const metricsHub = new MetricsHub();

  // 启用告警
  metricsHub.addAlert('slow_search', 'search.latency', 'gt', 500);

  // 批量创建 Recipe
  const recipes = [];
  for (let i = 0; i < 5; i++) {
  const recipe = recipeHub.create({
    title: `Recipe ${i} - Performance ${i}`,
    description: `Description ${i}`,
    content: `Content about optimization technique ${i}`,
    category: 'Performance'
  });
  recipes.push(recipe);

  // 索引
  searchHub.index({
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    content: recipe.content || `Content about optimization technique ${i}`
  });

  metricsHub.counter('batch.created', 1);
  }

  // 执行搜索
  const latencyStart = Date.now();
  const results = searchHub.searchKeyword('optimization');
  const latency = Date.now() - latencyStart;

  metricsHub.histogram('search.latency', latency, {}, 'ms');

  // 验证结果
  assert(Array.isArray(results));

  // 验证指标
  const created = metricsHub.getStats('batch.created');
  assert(created.max >= 5);

  const summary = metricsHub.getSummary();
  assert(summary.metricCount >= 2);
});

test('RecipeHub 与 SearchHub 应该保持数据一致', () => {
  const recipeHub = new RecipeHub();
  const searchHub = new SearchHub();

  // 创建 Recipe
  const recipe1 = recipeHub.create({
  title: 'Async Programming',
  description: 'Async patterns',
  category: 'JavaScript'
  });

  const recipe2 = recipeHub.create({
  title: 'Promise Patterns',
  description: 'Using promises',
  category: 'JavaScript'
  });

  // 索引
  searchHub.index({
  id: recipe1.id,
  title: recipe1.title,
  description: recipe1.description
  });

  searchHub.index({
  id: recipe2.id,
  title: recipe2.title,
  description: recipe2.description
  });

  // 验证一致性
  const allSummary = recipeHub.getAllSummary();
  assertEqual(allSummary.length, searchHub.getIndexSize());

  // 搜索验证
  const results = searchHub.searchKeyword('async');
  assert(results.length >= 1);
});

test('MetricsHub 应该支持导出和分析', () => {
  const metricsHub = new MetricsHub();

  // 记录各种指标
  metricsHub.record('requests.success', 100);
  metricsHub.record('requests.failed', 5);
  metricsHub.histogram('response.time', 125, {}, 'ms');

  // 导出
  const exported = metricsHub.export('json');

  assert(exported.metrics);
  assert(exported.stats);

  // 聚合分析
  const totalRequests = metricsHub.aggregate(
  ['requests.success', 'requests.failed'],
  'sum'
  );

  assertEqual(totalRequests.result, 105);
  assertEqual(totalRequests.count, 2);
});

// ===== 运行测试 =====

console.log('🧪 Phase 2 集成测试\n');

for (const { name, fn } of tests) {
  try {
  fn();
  console.log(`✅ ${name}`);
  passed++;
  } catch (error) {
  console.log(`❌ ${name}`);
  console.log(`   ${error.message}`);
  failed++;
  }
}

console.log(`\n📊 结果: ${passed} 通过, ${failed} 失败`);

process.exit(failed > 0 ? 1 : 0);
