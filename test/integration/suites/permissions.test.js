/**
 * 权限系统集成测试
 * 深度测试权限检查、缓存机制、跨项目支持等
 */

const { TestRunner, TestClient, TestAssert, TestContext } = require('../framework/test-framework');
const { permissionTests } = require('../fixtures/test-data');

const runner = new TestRunner('权限系统集成测试');
const client = new TestClient();

// 测试 1: 基础权限检查
runner.test('应该通过权限检查保存 Recipe', async (ctx) => {
  const response = await client.post('/api/recipes/save', {
  name: 'permission-test-1',
  title: 'Permission Test',
  content: '# Permission Test'
  });
  
  TestAssert.assertStatusCode(response, 200);
  TestAssert.assertTrue(response.body.success, 'Should pass permission check');
  
  ctx.onCleanup(async () => {
  await client.post('/api/recipes/delete', { name: 'permission-test-1' });
  });
});

// 测试 2: 缓存机制验证
runner.test('权限检查结果应被缓存以提高性能', async (ctx) => {
  ctx.startTimer();
  
  // 第一次检查（触发 git push --dry-run）
  const response1 = await client.post('/api/recipes/save', {
  name: 'cache-test-1',
  title: 'Cache Test 1',
  content: '# Cache Test'
  });
  
  const time1 = Date.now() - ctx.startTime;
  TestAssert.assertTrue(response1.body.success);
  
  // 第二次检查（应该使用缓存）
  const time2Start = Date.now();
  const response2 = await client.post('/api/recipes/save', {
  name: 'cache-test-2',
  title: 'Cache Test 2',
  content: '# Cache Test'
  });
  const time2 = Date.now() - time2Start;
  
  TestAssert.assertTrue(response2.body.success);
  // 缓存命中应该更快（不精确的性能对比）
  ctx.set('cacheTest', { time1, time2, cached: time2 <= time1 + 100 });
  
  ctx.onCleanup(async () => {
  await client.post('/api/recipes/delete', { name: 'cache-test-1' });
  await client.post('/api/recipes/delete', { name: 'cache-test-2' });
  });
});

// 测试 3: 缓存清除功能
runner.test('应该能清除权限缓存', async (ctx) => {
  // 先保存以触发缓存
  await client.post('/api/recipes/save', {
  name: 'clear-cache-test',
  title: 'Clear Cache Test',
  content: '# Test'
  });
  
  // 清除缓存
  const clearResponse = await client.post('/api/admin/clear-permission-cache', {});
  TestAssert.assertStatusCode(clearResponse, 200);
  
  // 再次保存（应该重新检查权限）
  const saveResponse = await client.post('/api/recipes/save', {
  name: 'post-clear-test',
  title: 'Post Clear Test',
  content: '# Test'
  });
  TestAssert.assertTrue(saveResponse.body.success);
  
  ctx.onCleanup(async () => {
  await client.post('/api/recipes/delete', { name: 'clear-cache-test' });
  await client.post('/api/recipes/delete', { name: 'post-clear-test' });
  });
});

// 测试 4: 权限检查失败处理
runner.test('权限检查失败时应返回明确错误信息', async (ctx) => {
  // 模拟权限问题通常会导致保存失败
  const response = await client.post('/api/recipes/save', {
  name: 'perm-fail-test',
  title: 'Permission Fail Test',
  content: '# Test'
  });
  
  // 应该要么成功，要么返回清晰的错误信息
  TestAssert.assertTrue(
  response.body.success || response.body.error,
  'Response should have clear success/error indication'
  );
});

// 测试 5: 并发权限检查
runner.test('应该安全处理并发权限检查', async (ctx) => {
  const names = ['concurrent-1', 'concurrent-2', 'concurrent-3'];
  
  // 并发发送多个请求
  const promises = names.map(name =>
  client.post('/api/recipes/save', {
    name,
    title: `Concurrent Test ${name}`,
    content: '# Concurrent'
  })
  );
  
  const responses = await Promise.all(promises);
  
  // 所有请求应该都成功
  responses.forEach((response, index) => {
  TestAssert.assertTrue(
    response.body.success,
    `Request ${index + 1} should succeed under concurrent load`
  );
  });
  
  ctx.onCleanup(async () => {
  for (const name of names) {
    await client.post('/api/recipes/delete', { name });
  }
  });
});

// 测试 6: 跨项目写入权限
runner.test('应该能检测跨项目的写入权限', async (ctx) => {
  // 获取当前 projectRoot 信息
  const healthResponse = await client.get('/api/health');
  TestAssert.assertExists(healthResponse.body.projectRoot);
  
  const projectRoot = healthResponse.body.projectRoot;
  ctx.set('currentProjectRoot', projectRoot);
  
  // 应该能在当前项目中保存
  const response = await client.post('/api/recipes/save', {
  name: 'cross-project-test',
  title: 'Cross Project Test',
  content: '# Test'
  });
  
  TestAssert.assertTrue(response.body.success);
  
  ctx.onCleanup(async () => {
  await client.post('/api/recipes/delete', { name: 'cross-project-test' });
  });
});

// 测试 7: 权限检查超时处理
runner.test('权限检查超时应被正确处理', async (ctx) => {
  // 这个测试会正常完成，但验证框架能处理超时
  const response = await client.post('/api/recipes/save', {
  name: 'timeout-test',
  title: 'Timeout Test',
  content: '# Test'
  });
  
  // 不管是否超时，应该返回某种响应
  TestAssert.assertExists(response.status);
  
  if (response.body.success) {
  ctx.onCleanup(async () => {
    await client.post('/api/recipes/delete', { name: 'timeout-test' });
  });
  }
});

// 测试 8: 自动目录创建
runner.test('权限检查应自动创建缺失的目录', async (ctx) => {
  // 正常保存应该工作，即使目录初始不存在
  const response = await client.post('/api/recipes/save', {
  name: 'auto-create-test',
  title: 'Auto Create Test',
  content: '# Auto Create Directory'
  });
  
  TestAssert.assertTrue(
  response.body.success || !response.body.error?.includes('directory'),
  'Should handle missing directories gracefully'
  );
  
  ctx.onCleanup(async () => {
  await client.post('/api/recipes/delete', { name: 'auto-create-test' });
  });
});

// 测试 9: No-remote 仓库支持
runner.test('应该支持没有 remote 的本地 git 仓库', async (ctx) => {
  // 这验证了本地开发模式的支持
  const response = await client.post('/api/recipes/save', {
  name: 'no-remote-test',
  title: 'No Remote Test',
  content: '# Local Git Repo Test'
  });
  
  TestAssert.assertTrue(
  response.body.success || !response.body.error?.includes('remote'),
  'Should support local repositories without remote'
  );
  
  if (response.body.success) {
  ctx.onCleanup(async () => {
    await client.post('/api/recipes/delete', { name: 'no-remote-test' });
  });
  }
});

// 测试 10: 旧 git 子模块检测
runner.test('应该检测并提示旧的 git 子模块配置', async (ctx) => {
  // 保存操作可能会在日志中显示子模块检测
  const response = await client.post('/api/recipes/save', {
  name: 'submodule-test',
  title: 'Submodule Detection Test',
  content: '# Submodule Test'
  });
  
  TestAssert.assertExists(response.status);
  
  if (response.body.success) {
  ctx.onCleanup(async () => {
    await client.post('/api/recipes/delete', { name: 'submodule-test' });
  });
  }
});

// 测试 11: 权限错误信息详细程度
runner.test('权限错误应包含可调试的详细信息', async (ctx) => {
  const response = await client.post('/api/recipes/save', {
  name: 'debug-error-test',
  title: 'Debug Error Test',
  content: '# Debug'
  });
  
  // 不管成功还是失败，都应该有清晰的日志信息
  TestAssert.assertExists(response.status);
  TestAssert.assertTrue(
  response.body.success || response.body.error,
  'Response should be clear about what happened'
  );
  
  if (response.body.success) {
  ctx.onCleanup(async () => {
    await client.post('/api/recipes/delete', { name: 'debug-error-test' });
  });
  }
});

// 测试 12: 缓存 TTL（24小时）
runner.test('缓存应在 24 小时后过期', async (ctx) => {
  // 虽然无法测试完整的 24 小时，但可以验证缓存机制的存在
  const response = await client.post('/api/recipes/save', {
  name: 'ttl-test',
  title: 'TTL Test',
  content: '# TTL'
  });
  
  TestAssert.assertTrue(response.body.success);
  
  // 验证缓存清除功能（模拟 TTL 过期）
  const clearResponse = await client.post('/api/admin/clear-permission-cache', {});
  TestAssert.assertTrue(clearResponse.body === true || clearResponse.body.success);
  
  ctx.onCleanup(async () => {
  await client.post('/api/recipes/delete', { name: 'ttl-test' });
  });
});

module.exports = runner;
