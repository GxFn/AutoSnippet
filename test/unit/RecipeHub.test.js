/**
 * RecipeHub 单元测试
 */

const {
  RecipeHub,
  Recipe,
  RecipeVersion,
  ApprovalRecord
} = require('../../lib/business/recipe/RecipeHub');

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function run() {
  console.log('🧪 RecipeHub 单元测试\n');

  for (const t of tests) {
  try {
    await t.fn();
    console.log(`✅ ${t.name}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${t.name}`);
    console.error(`   ${err.message}`);
    failed++;
  }
  }

  console.log(`\n📊 结果: ${passed} 通过, ${failed} 失败\n`);
  process.exit(failed > 0 ? 1 : 0);
}

function assert(condition, message) {
  if (!condition) {
  throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(a, b, message) {
  if (a !== b) {
  throw new Error(message || `Expected ${b}, got ${a}`);
  }
}

// ============ 测试用例开始 ============

test('Recipe 应该创建实例', () => {
  const recipe = new Recipe({
  title: 'Test Recipe',
  content: '# Test',
  author: 'test-user'
  });

  assertEqual(recipe.title, 'Test Recipe');
  assertEqual(recipe.author, 'test-user');
  assertEqual(recipe.status, 'draft');
  assert(recipe.id);
  assert(recipe.currentVersion);
});

test('Recipe 应该支持内容更新', () => {
  const recipe = new Recipe({
  title: 'Test',
  content: '# Version 1'
  });

  const version1 = recipe.currentVersion;
  recipe.update('# Version 2', { author: 'editor', changes: 'Updated content' });

  assert(recipe.versions.length === 2);
  assert(recipe.currentVersion.id !== version1.id);
  assertEqual(recipe.currentVersion.content, '# Version 2');
});

test('Recipe 应该支持审批流程', () => {
  const recipe = new Recipe({
  title: 'Test',
  content: '# Test'
  });

  // 提交审批
  recipe.submitForReview('reviewer1');
  assertEqual(recipe.status, 'review');
  assertEqual(recipe.approvals.length, 1);
  assertEqual(recipe.approvals[0].status, 'pending');

  // 通过审批
  recipe.approve('reviewer1', { comment: 'Looks good' });
  assertEqual(recipe.status, 'approved');
  assertEqual(recipe.approvals[0].status, 'approved');
});

test('Recipe 应该支持拒绝审批', () => {
  const recipe = new Recipe({
  title: 'Test',
  content: '# Test'
  });

  recipe.submitForReview('reviewer1');
  recipe.reject('reviewer1', { comment: 'Need more details' });

  assertEqual(recipe.status, 'draft');
  assertEqual(recipe.approvals[0].status, 'rejected');
});

test('Recipe 应该支持发布', () => {
  const recipe = new Recipe({
  title: 'Test',
  content: '# Test'
  });

  recipe.submitForReview('reviewer1');
  recipe.approve('reviewer1');
  recipe.publish();

  assertEqual(recipe.status, 'published');
});

test('Recipe 应该支持浏览计数', () => {
  const recipe = new Recipe({ title: 'Test', content: '# Test' });

  recipe.view();
  recipe.view();

  assertEqual(recipe.views, 2);
});

test('Recipe 应该支持点赞', () => {
  const recipe = new Recipe({ title: 'Test', content: '# Test' });

  recipe.like();
  recipe.like();
  recipe.like();

  assertEqual(recipe.likes, 3);
});

test('Recipe 应该支持评分', () => {
  const recipe = new Recipe({ title: 'Test', content: '# Test' });

  recipe.setRating(4.5);
  assertEqual(recipe.rating, 4.5);

  try {
  recipe.setRating(6);
  throw new Error('Should have thrown');
  } catch (err) {
  assert(err.message.includes('Rating'));
  }
});

test('Recipe 应该支持版本历史', () => {
  const recipe = new Recipe({
  title: 'Test',
  content: '# v1'
  });

  recipe.update('# v2');
  recipe.update('# v3');

  const history = recipe.getVersionHistory();

  assertEqual(history.length, 3);
  assert(history[2].isCurrent === true);
});

test('Recipe 应该支持获取特定版本内容', () => {
  const recipe = new Recipe({
  title: 'Test',
  content: '# Version 1'
  });

  const v1Id = recipe.currentVersion.id;
  recipe.update('# Version 2');

  const content = recipe.getVersionContent(v1Id);
  assertEqual(content, '# Version 1');
});

test('Recipe 应该支持使用计数', () => {
  const recipe = new Recipe({ title: 'Test', content: '# Test' });

  recipe.recordUsage();
  recipe.recordUsage(5);

  assertEqual(recipe.usageCount, 6);
});

test('RecipeHub 应该创建实例', () => {
  const hub = new RecipeHub();

  assert(hub instanceof RecipeHub);
  assert(hub.recipes instanceof Map);
  assertEqual(hub.getStats().total, 0);
});

test('RecipeHub 应该创建 Recipe', () => {
  const hub = new RecipeHub();

  const recipe = hub.create({
  title: 'My Recipe',
  content: '# Test',
  category: 'architecture'
  });

  assert(recipe instanceof Recipe);
  assertEqual(hub.recipes.size, 1);
  assertEqual(hub.getStats().total, 1);
});

test('RecipeHub 应该获取 Recipe', () => {
  const hub = new RecipeHub();

  const created = hub.create({ title: 'Test', content: '# Test' });
  const fetched = hub.get(created.id);

  assert(fetched === created);
});

test('RecipeHub 应该删除 Recipe', () => {
  const hub = new RecipeHub();

  const recipe = hub.create({ title: 'Test', content: '# Test' });
  const deleted = hub.delete(recipe.id);

  assert(deleted === true);
  assertEqual(hub.recipes.size, 0);
});

test('RecipeHub 应该按分类查询', () => {
  const hub = new RecipeHub();

  hub.create({ title: 'Recipe 1', category: 'architecture', content: '# 1' });
  hub.create({ title: 'Recipe 2', category: 'patterns', content: '# 2' });
  hub.create({ title: 'Recipe 3', category: 'architecture', content: '# 3' });

  const arch = hub.findByCategory('architecture');

  assertEqual(arch.length, 2);
});

test('RecipeHub 应该按标签查询', () => {
  const hub = new RecipeHub();

  hub.create({
  title: 'Recipe 1',
  tags: ['performance', 'caching'],
  content: '# 1'
  });
  hub.create({
  title: 'Recipe 2',
  tags: ['performance'],
  content: '# 2'
  });
  hub.create({
  title: 'Recipe 3',
  tags: ['security'],
  content: '# 3'
  });

  const perf = hub.findByTag('performance');

  assertEqual(perf.length, 2);
});

test('RecipeHub 应该按状态查询', () => {
  const hub = new RecipeHub();

  const r1 = hub.create({ title: 'Recipe 1', content: '# 1' });
  const r2 = hub.create({ title: 'Recipe 2', content: '# 2' });

  r1.submitForReview('reviewer1');
  r1.approve('reviewer1');
  r1.publish();

  const published = hub.findByStatus('published');

  assertEqual(published.length, 1);
});

test('RecipeHub 应该获取热门 Recipe', () => {
  const hub = new RecipeHub();

  const r1 = hub.create({ title: 'Recipe 1', content: '# 1' });
  const r2 = hub.create({ title: 'Recipe 2', content: '# 2' });
  const r3 = hub.create({ title: 'Recipe 3', content: '# 3' });

  r1.submitForReview('r');
  r1.approve('r');
  r1.publish();
  r1.like();

  r2.submitForReview('r');
  r2.approve('r');
  r2.publish();
  r2.like();
  r2.like();
  r2.like();

  r3.submitForReview('r');
  r3.approve('r');
  r3.publish();

  const popular = hub.getPopular(2);

  assertEqual(popular.length, 2);
  assertEqual(popular[0].title, 'Recipe 2'); // 最多点赞
});

test('RecipeHub 应该获取最常用的 Recipe', () => {
  const hub = new RecipeHub();

  const r1 = hub.create({ title: 'Recipe 1', content: '# 1' });
  const r2 = hub.create({ title: 'Recipe 2', content: '# 2' });

  r1.submitForReview('r');
  r1.approve('r');
  r1.publish();
  r1.recordUsage(10);

  r2.submitForReview('r');
  r2.approve('r');
  r2.publish();
  r2.recordUsage(5);

  const mostUsed = hub.getMostUsed(1);

  assertEqual(mostUsed[0].title, 'Recipe 1');
});

test('RecipeHub 应该获取待审批的 Recipe', () => {
  const hub = new RecipeHub();

  const r1 = hub.create({ title: 'Recipe 1', content: '# 1' });
  const r2 = hub.create({ title: 'Recipe 2', content: '# 2' });

  r1.submitForReview('reviewer');

  const pending = hub.getPendingApproval();

  assertEqual(pending.length, 1);
  assertEqual(pending[0].title, 'Recipe 1');
});

test('RecipeHub 应该搜索 Recipe', () => {
  const hub = new RecipeHub();

  hub.create({
  title: 'Caching Strategy',
  description: 'How to implement cache',
  content: '# Cache'
  });
  hub.create({
  title: 'API Design',
  description: 'REST API patterns',
  content: '# API'
  });

  const results = hub.search('cache');

  assertEqual(results.length, 1);
  assertEqual(results[0].title, 'Caching Strategy');
});

test('RecipeHub 应该支持统计信息', () => {
  const hub = new RecipeHub();

  const r1 = hub.create({ title: 'R1', category: 'architecture', content: '# 1' });
  const r2 = hub.create({ title: 'R2', category: 'patterns', content: '# 2' });

  r1.view();
  r1.view();
  r1.recordUsage(5);

  r2.view();
  r2.recordUsage(3);

  const stats = hub.getStats();

  assertEqual(stats.total, 2);
  assertEqual(stats.byCategory['architecture'], 1);
  assertEqual(stats.byCategory['patterns'], 1);
  assertEqual(stats.totalViews, 3);
  assertEqual(stats.totalUsage, 8);
});

test('RecipeHub 应该清空所有 Recipe', () => {
  const hub = new RecipeHub();

  hub.create({ title: 'R1', content: '# 1' });
  hub.create({ title: 'R2', content: '# 2' });

  hub.clear();

  assertEqual(hub.recipes.size, 0);
});

test('RecipeHub 应该管理分类', () => {
  const hub = new RecipeHub();

  const cats = hub.getCategories();
  assert(cats.includes('architecture'));

  hub.addCategory('custom');
  assert(hub.getCategories().includes('custom'));
});

test('Recipe 应该转换为 JSON', () => {
  const recipe = new Recipe({
  title: 'Test',
  category: 'patterns',
  content: '# Test'
  });

  recipe.like();
  recipe.view();

  const json = recipe.toJSON();

  assert(typeof json === 'object');
  assertEqual(json.title, 'Test');
  assertEqual(json.stats.likes, 1);
  assertEqual(json.stats.views, 1);
});

test('RecipeHub 应该导出为 JSON', () => {
  const hub = new RecipeHub();

  hub.create({ title: 'R1', content: '# 1' });
  hub.create({ title: 'R2', content: '# 2' });

  const json = hub.exportAsJSON();

  assert(json.timestamp);
  assert(json.stats);
  assertEqual(json.recipes.length, 2);
});

test('Recipe 应该支持链式调用', () => {
  const recipe = new Recipe({ title: 'Test', content: '# Test' });

  const result = recipe
  .view()
  .like()
  .like()
  .recordUsage(5)
  .setRating(4);

  assert(result instanceof Recipe);
  assertEqual(recipe.views, 1);
  assertEqual(recipe.likes, 2);
  assertEqual(recipe.usageCount, 5);
  assertEqual(recipe.rating, 4);
});

test('RecipeHub 应该支持链式调用', () => {
  const hub = new RecipeHub();

  const result = hub.addCategory('new-cat').clear();

  assert(result instanceof RecipeHub);
  assert(hub.getCategories().includes('new-cat'));
});

// ============ 测试运行 ============

run();
