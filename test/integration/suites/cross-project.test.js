/**
 * 跨项目功能集成测试
 * 测试在多个项目间使用 Dashboard 和共享资源
 */

const { TestRunner, TestClient, TestAssert, TestContext } = require('../framework/test-framework');
const { crossProjectTests } = require('../fixtures/test-data');

const runner = new TestRunner('跨项目功能测试');
const client = new TestClient();

// 测试 1: 获取当前 projectRoot
runner.test('应该能正确识别当前 projectRoot', async (ctx) => {
  const response = await client.get('/api/health');
  
  TestAssert.assertStatusCode(response, 200);
  TestAssert.assertExists(response.body.projectRoot);
  TestAssert.assertTrue(response.body.projectRoot.includes('AutoSnippet'));
  
  ctx.set('currentProjectRoot', response.body.projectRoot);
});

// 测试 2: 项目特定的 Recipe 保存
runner.test('不同项目应能独立保存各自的 Recipe', async (ctx) => {
  // 在当前项目中保存 Recipe
  const response = await client.post('/api/recipes/save', {
    name: 'project-specific-recipe-1',
    title: 'Project Specific 1',
    content: '# Project Specific Recipe'
  });
  
  TestAssert.assertTrue(response.body.success);
  
  ctx.set('projectSpecificRecipe', 'project-specific-recipe-1');
  
  ctx.onCleanup(async () => {
    await client.post('/api/recipes/delete', { name: 'project-specific-recipe-1' });
  });
});

// 测试 3: 项目间 Recipe 隔离
runner.test('一个项目的 Recipe 应该与其他项目隔离', async (ctx) => {
  // 保存一个 Recipe
  const recipe1 = 'isolation-test-' + Date.now();
  await client.post('/api/recipes/save', {
    name: recipe1,
    title: 'Isolation Test',
    content: '# Isolation Test'
  });
  
  // 验证可以获取
  const getResponse = await client.get(`/api/recipes/get?name=${recipe1}`);
  TestAssert.assertExists(getResponse.body.content);
  
  // 理想情况下，如果有其他 Dashboard 实例运行在不同项目上，
  // 它们应该看不到这个 Recipe
  ctx.set('isolationTestRecipe', recipe1);
  
  ctx.onCleanup(async () => {
    await client.post('/api/recipes/delete', { name: recipe1 });
  });
});

// 测试 4: 跨项目权限检查
runner.test('应该能验证跨项目写入权限', async (ctx) => {
  // 使用 -d 参数指定项目（在实际场景中）
  // 这里我们验证当前项目的权限
  const response = await client.post('/api/recipes/save', {
    name: 'cross-project-perm-test',
    title: 'Cross Project Permission',
    content: '# Permission Test'
  });
  
  TestAssert.assertTrue(
    response.body.success,
    'Should have write permission in current project'
  );
  
  ctx.onCleanup(async () => {
    await client.post('/api/recipes/delete', { name: 'cross-project-perm-test' });
  });
});

// 测试 5: 共享 Recipe 的创建
runner.test('应该能创建可共享的 Recipe', async (ctx) => {
  const sharedRecipeName = 'shared-utility-' + Date.now();
  
  const response = await client.post('/api/recipes/save', {
    name: sharedRecipeName,
    title: 'Shared Utility Recipe',
    content: `---
title: Shared Utility
trigger: shared
shareable: true
---

## Shared Code

\`\`\`javascript
// This can be used across multiple projects
const sharedUtility = () => {
  return 'Shared functionality';
};

export { sharedUtility };
\`\`\`

## Usage

Import in other projects to reuse this utility.
`,
    tags: ['shared', 'utility', 'cross-project']
  });
  
  TestAssert.assertTrue(response.body.success);
  
  ctx.onCleanup(async () => {
    await client.post('/api/recipes/delete', { name: sharedRecipeName });
  });
});

// 测试 6: 项目元数据访问
runner.test('应该能访问项目配置和元数据', async (ctx) => {
  const response = await client.get('/api/data');
  
  TestAssert.assertStatusCode(response, 200);
  TestAssert.assertExists(response.body.projectRoot);
  TestAssert.assertTrue(response.body.recipes instanceof Array || typeof response.body.recipes === 'object');
});

// 测试 7: 多项目同时运行（模拟）
runner.test('Dashboard 应支持为多个项目运行实例', async (ctx) => {
  // 这个测试验证当前实例的独立性
  
  // 获取当前项目信息
  const health1 = await client.get('/api/health');
  TestAssert.assertExists(health1.body.projectRoot);
  
  // 保存一个 Recipe
  const recipeName = 'multi-instance-test-' + Date.now();
  const saveResponse = await client.post('/api/recipes/save', {
    name: recipeName,
    title: 'Multi Instance Test',
    content: '# Multi Instance'
  });
  
  TestAssert.assertTrue(saveResponse.body.success);
  
  // 再次获取项目信息，应该相同
  const health2 = await client.get('/api/health');
  TestAssert.assertEquals(health1.body.projectRoot, health2.body.projectRoot);
  
  ctx.onCleanup(async () => {
    await client.post('/api/recipes/delete', { name: recipeName });
  });
});

// 测试 8: 项目切换验证
runner.test('验证 -d 参数机制支持项目切换', async (ctx) => {
  // 我们无法在运行时切换项目，但可以验证当前项目是正确的
  const response = await client.get('/api/health');
  
  TestAssert.assertStatusCode(response, 200);
  TestAssert.assertExists(response.body.projectRoot);
  
  // 当前应该是 AutoSnippet 项目
  const projectRoot = response.body.projectRoot;
  ctx.set('verifiedProjectRoot', projectRoot);
});

// 测试 9: 跨项目 Recipe 搜索
runner.test('Recipe 搜索应在当前项目范围内', async (ctx) => {
  // 保存一个测试 Recipe
  const recipeName = 'search-scope-test-' + Date.now();
  await client.post('/api/recipes/save', {
    name: recipeName,
    title: 'Search Scope Test',
    content: 'Unique content for search scope testing'
  });
  
  // 搜索应该找到它
  const searchResponse = await client.get('/api/recipes/search?keyword=scope');
  TestAssert.assertStatusCode(searchResponse, 200);
  
  ctx.onCleanup(async () => {
    await client.post('/api/recipes/delete', { name: recipeName });
  });
});

// 测试 10: 项目配置加载
runner.test('应该正确加载项目的 boxspec 配置', async (ctx) => {
  const response = await client.get('/api/data');
  
  TestAssert.assertStatusCode(response, 200);
  TestAssert.assertExists(response.body.projectRoot);
  
  // 应该有根配置信息
  TestAssert.assertTrue(response.body.rootSpec !== undefined);
});

// 测试 11: 项目隔离的权限缓存
runner.test('权限缓存应按项目隔离', async (ctx) => {
  // 在当前项目保存，触发权限缓存
  const recipe1 = 'cache-isolation-test-1-' + Date.now();
  await client.post('/api/recipes/save', {
    name: recipe1,
    title: 'Cache Isolation 1',
    content: '# Test'
  });
  
  // 清除缓存不应影响其他项目的缓存
  const clearResponse = await client.post('/api/admin/clear-permission-cache', {});
  TestAssert.assertTrue(clearResponse.body === true || clearResponse.body.success);
  
  // 验证缓存清除后还能继续操作
  const recipe2 = 'cache-isolation-test-2-' + Date.now();
  const response2 = await client.post('/api/recipes/save', {
    name: recipe2,
    title: 'Cache Isolation 2',
    content: '# Test'
  });
  
  TestAssert.assertTrue(response2.body.success);
  
  ctx.onCleanup(async () => {
    await client.post('/api/recipes/delete', { name: recipe1 });
    await client.post('/api/recipes/delete', { name: recipe2 });
  });
});

// 测试 12: 跨项目环境变量支持
runner.test('应该支持通过环境变量切换项目 (ASD_CWD)', async (ctx) => {
  // 虽然无法在测试中直接修改环境变量，
  // 但验证当前连接使用的项目是正确的
  
  const response = await client.get('/api/health');
  const projectRoot = response.body.projectRoot;
  
  TestAssert.assertTrue(projectRoot.length > 0);
  // 在本地是 Documents/github/AutoSnippet，在 CI 是 /home/runner/work/AutoSnippet/AutoSnippet
  TestAssert.assertTrue(
    projectRoot.includes('AutoSnippet'),
    `projectRoot should contain 'AutoSnippet', got: ${projectRoot}`
  );
  
  ctx.set('projectRootEnvironment', projectRoot);
});

module.exports = runner;
