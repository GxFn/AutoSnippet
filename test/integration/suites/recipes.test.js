/**
 * Recipe API 集成测试
 * 覆盖 Recipe 完整 CRUD 操作和相关功能
 */

const { TestRunner, TestClient, TestAssert, TestContext } = require('../framework/test-framework');
const { testRecipes, generateTestCombinations, validateRecipeStructure } = require('../fixtures/test-data');

const runner = new TestRunner('Recipe API 测试套件');
const client = new TestClient();

// 测试 1: 保存基础 Recipe
runner.test('应该能保存基础 Recipe', async (ctx) => {
  const response = await client.post('/api/recipes/save', testRecipes.basicRecipe);
  
  TestAssert.assertStatusCode(response, 200);
  TestAssert.assertTrue(response.body.success, 'Response should indicate success');
  
  ctx.set('savedRecipe', testRecipes.basicRecipe.name);
});

// 测试 2: 保存高级 Recipe（带元数据）
runner.test('应该能保存包含元数据的高级 Recipe', async (ctx) => {
  const response = await client.post('/api/recipes/save', testRecipes.advancedRecipe);
  
  TestAssert.assertStatusCode(response, 200);
  TestAssert.assertTrue(response.body.success);
  
  ctx.set('advancedRecipe', testRecipes.advancedRecipe.name);
});

// 测试 3: 获取保存的 Recipe
runner.test('应该能获取已保存的 Recipe', async (ctx) => {
  // 先保存
  await client.post('/api/recipes/save', testRecipes.basicRecipe);
  
  // 再获取
  const response = await client.get(`/api/recipes/get?name=${testRecipes.basicRecipe.name}`);
  
  TestAssert.assertStatusCode(response, 200);
  TestAssert.assertExists(response.body.content, 'Recipe content should exist');
  TestAssert.assertTrue(response.body.content.includes(testRecipes.basicRecipe.title));
  
  ctx.onCleanup(async () => {
    await client.post('/api/recipes/delete', { name: testRecipes.basicRecipe.name });
  });
});

// 测试 4: 获取不存在的 Recipe
runner.test('获取不存在的 Recipe 应返回错误', async (ctx) => {
  const response = await client.get('/api/recipes/get?name=non-existent-recipe-xyz');
  
  TestAssert.assertTrue(response.status !== 200 || response.body.error, 'Should fail for non-existent recipe');
});

// 测试 5: 设置权威度评分
runner.test('应该能设置 Recipe 权威度评分', async (ctx) => {
  // 先保存
  const recipeName = 'test-authority-recipe';
  await client.post('/api/recipes/save', {
    name: recipeName,
    title: 'Authority Test',
    content: '# Test\nContent for testing authority.'
  });
  
  // 设置权威度
  const response = await client.post('/api/recipes/set-authority', {
    name: recipeName,
    authority: 5
  });
  
  TestAssert.assertStatusCode(response, 200);
  TestAssert.assertTrue(response.body.success);
  TestAssert.assertEquals(response.body.authority, 5);
  
  ctx.onCleanup(async () => {
    await client.post('/api/recipes/delete', { name: recipeName });
  });
});

// 测试 6: 权威度范围验证
runner.test('权威度应在有效范围内 (0-5)', async (ctx) => {
  const recipeName = 'test-authority-range';
  await client.post('/api/recipes/save', {
    name: recipeName,
    title: 'Range Test',
    content: '# Test'
  });
  
  // 测试有效范围
  for (let i = 0; i <= 5; i++) {
    const response = await client.post('/api/recipes/set-authority', {
      name: recipeName,
      authority: i
    });
    TestAssert.assertTrue(response.body.success || response.body.authority === i);
  }
  
  ctx.onCleanup(async () => {
    await client.post('/api/recipes/delete', { name: recipeName });
  });
});

// 测试 7: 记录 Recipe 使用
runner.test('应该能记录 Recipe 使用次数', async (ctx) => {
  const recipeName = 'test-usage-record';
  await client.post('/api/recipes/save', {
    name: recipeName,
    title: 'Usage Test',
    content: '# Test'
  });
  
  const response = await client.post('/api/recipes/record-usage', {
    name: recipeName,
    source: 'human'
  });
  
  TestAssert.assertStatusCode(response, 200);
  TestAssert.assertTrue(response.body.success || response.body.count >= 1);
  
  ctx.onCleanup(async () => {
    await client.post('/api/recipes/delete', { name: recipeName });
  });
});

// 测试 8: 删除 Recipe
runner.test('应该能删除 Recipe', async (ctx) => {
  const recipeName = 'test-delete-recipe';
  
  // 先保存
  await client.post('/api/recipes/save', {
    name: recipeName,
    title: 'Delete Test',
    content: '# Test'
  });
  
  // 验证存在
  let getResponse = await client.get(`/api/recipes/get?name=${recipeName}`);
  TestAssert.assertExists(getResponse.body.content);
  
  // 删除
  const deleteResponse = await client.post('/api/recipes/delete', { name: recipeName });
  TestAssert.assertStatusCode(deleteResponse, 200);
  TestAssert.assertTrue(deleteResponse.body.success);
  
  // 验证已删除
  getResponse = await client.get(`/api/recipes/get?name=${recipeName}`);
  TestAssert.assertTrue(getResponse.body.error || !getResponse.body.content);
});

// 测试 9: 删除不存在的 Recipe
runner.test('删除不存在的 Recipe 应返回错误', async (ctx) => {
  const response = await client.post('/api/recipes/delete', {
    name: 'non-existent-recipe-to-delete'
  });
  
  TestAssert.assertTrue(response.status !== 200 || response.body.error);
});

// 测试 10: Recipe 名称验证 (安全性)
runner.test('应该拒绝不安全的 Recipe 名称 (路径遍历)', async (ctx) => {
  const response = await client.post('/api/recipes/save', {
    name: '../../../etc/passwd',
    title: 'Malicious',
    content: 'Bad content'
  });
  
  TestAssert.assertTrue(
    response.status !== 200 || response.body.error,
    'Should reject path traversal attempts'
  );
});

// 测试 11: 批量操作测试
runner.test('应该能处理多个 Recipe 的连续保存', async (ctx) => {
  const recipes = generateTestCombinations();
  const savedNames = [];
  
  for (const recipe of recipes) {
    const response = await client.post('/api/recipes/save', recipe.recipe);
    TestAssert.assertTrue(response.body.success);
    savedNames.push(recipe.recipe.name);
  }
  
  ctx.set('batchSaved', savedNames);
  
  ctx.onCleanup(async () => {
    for (const name of savedNames) {
      await client.post('/api/recipes/delete', { name });
    }
  });
});

// 测试 12: Recipe 搜索
runner.test('应该能搜索 Recipe', async (ctx) => {
  const recipeName = 'test-search-recipe';
  
  // 保存
  await client.post('/api/recipes/save', {
    name: recipeName,
    title: 'Search Test Recipe',
    content: '# Test Content'
  });
  
  // 搜索
  const response = await client.get('/api/recipes/search?keyword=Search');
  
  TestAssert.assertStatusCode(response, 200);
  TestAssert.assertTrue(response.body.total >= 1 || response.body.items);
  
  ctx.onCleanup(async () => {
    await client.post('/api/recipes/delete', { name: recipeName });
  });
});

// 测试 13: 权限缓存清除
runner.test('应该能清除权限缓存', async (ctx) => {
  const response = await client.post('/api/admin/clear-permission-cache', {});
  
  TestAssert.assertStatusCode(response, 200);
  TestAssert.assertTrue(response.body === true || response.body.success);
});

// 测试 14: Health Check
runner.test('Health 检查应返回服务状态', async (ctx) => {
  const response = await client.get('/api/health');
  
  TestAssert.assertStatusCode(response, 200);
  TestAssert.assertExists(response.body.status);
  TestAssert.assertExists(response.body.projectRoot);
  TestAssert.assertEquals(response.body.status, 'running');
});

// 测试 15: 长期持久化验证
runner.test('Recipe 应被长期持久化到磁盘', async (ctx) => {
  const recipeName = 'test-persistence-' + Date.now();
  const content = 'Persistence test at ' + new Date().toISOString();
  
  // 保存
  const saveResponse = await client.post('/api/recipes/save', {
    name: recipeName,
    title: 'Persistence Test',
    content
  });
  
  TestAssert.assertTrue(saveResponse.body.success);
  
  // 等待文件系统同步
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // 重新获取验证
  const getResponse = await client.get(`/api/recipes/get?name=${recipeName}`);
  TestAssert.assertExists(getResponse.body.content);
  TestAssert.assertTrue(getResponse.body.content.includes(content));
  
  ctx.onCleanup(async () => {
    await client.post('/api/recipes/delete', { name: recipeName });
  });
});

module.exports = runner;
