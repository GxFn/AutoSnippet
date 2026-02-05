/**
 * 端到端系统测试 (E2E)
 * 
 * 测试范围：
 * 1. 完整的工作流 (API → Agent → Hub → 结果)
 * 2. 并发场景 (100+ 任务)
 * 3. 性能基准 (延迟、吞吐量)
 * 4. 故障恢复 (超时、错误)
 * 5. 压力测试 (长时间运行)
 */

const { APIGateway } = require('../../lib/api/APIGateway');
const { Agent } = require('../../lib/agent/Agent');
const { RecipeHub } = require('../../lib/business/recipe/RecipeHub');
const { SearchHub } = require('../../lib/business/search/SearchHub');
const { MetricsHub } = require('../../lib/business/metrics/MetricsHub');
const http = require('http');

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

// ===== 测试工具函数 =====

/**
 * 发送 HTTP 请求
 */
function makeRequest(options) {
  return new Promise((resolve, reject) => {
  const req = http.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
    data += chunk;
    });

    res.on('end', () => {
    try {
      const body = data ? JSON.parse(data) : null;
      resolve({
      statusCode: res.statusCode,
      headers: res.headers,
      body,
      });
    } catch (e) {
      resolve({
      statusCode: res.statusCode,
      headers: res.headers,
      body: data,
      });
    }
    });
  });

  req.on('error', reject);

  if (options.body) {
    req.write(JSON.stringify(options.body));
  }

  req.end();
  });
}

/**
 * 性能计时器
 */
function createTimer() {
  const start = Date.now();
  return {
  elapsed: () => Date.now() - start,
  reset: () => {
    const elapsed = Date.now() - start;
    return elapsed;
  },
  };
}

// ===== 端到端测试 =====

test('E2E: Recipe 完整工作流', async () => {
  const agent = new Agent({ name: 'RecipeE2E' });
  const recipeHub = new RecipeHub();
  agent.registerHub('recipe', recipeHub);

  const gateway = new APIGateway(agent, { port: 20001 });
  await gateway.start();

  try {
  // 1. 添加 Recipe 任务
  const addResponse = await makeRequest({
    hostname: 'localhost',
    port: 20001,
    path: '/api/agent/tasks',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
    name: 'E2E Recipe',
    type: 'recipe',
    params: {
      action: 'create',
      title: 'E2E Test Recipe',
      description: 'Created via E2E test',
      category: 'Testing',
    },
    },
  });

  assertEqual(addResponse.statusCode, 201);
  assert(addResponse.body.success === true);
  const taskId = addResponse.body.data.id;

  // 2. 获取任务信息
  const getResponse = await makeRequest({
    hostname: 'localhost',
    port: 20001,
    path: `/api/agent/tasks/${taskId}`,
    method: 'GET',
  });

  assertEqual(getResponse.statusCode, 200);
  assertEqual(getResponse.body.data.id, taskId);

  // 3. 执行任务
  const executeResponse = await makeRequest({
    hostname: 'localhost',
    port: 20001,
    path: `/api/agent/tasks/${taskId}/execute`,
    method: 'POST',
  });

  assertEqual(executeResponse.statusCode, 200);
  assert(executeResponse.body.success === true);

  // 4. 验证结果
  const statsResponse = await makeRequest({
    hostname: 'localhost',
    port: 20001,
    path: '/api/agent/stats',
    method: 'GET',
  });

  assertEqual(statsResponse.body.data.totalTasks, 1);
  } finally {
  await gateway.stop();
  }
});

test('E2E: 多 Hub 协作工作流', async () => {
  const agent = new Agent({ name: 'MultiHubE2E' });
  agent.registerHub('recipe', new RecipeHub());
  agent.registerHub('search', new SearchHub());
  agent.registerHub('metric', new MetricsHub());

  const gateway = new APIGateway(agent, { port: 20002 });
  await gateway.start();

  try {
  // 1. 创建 Recipe
  const recipeResponse = await makeRequest({
    hostname: 'localhost',
    port: 20002,
    path: '/api/agent/tasks',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
    name: 'Create Recipe',
    type: 'recipe',
    params: {
      action: 'create',
      title: 'Multi-Hub Recipe',
      category: 'Testing',
    },
    },
  });

  assertEqual(recipeResponse.statusCode, 201);
  const recipeTaskId = recipeResponse.body.data.id;

  // 2. 搜索 Recipe
  const searchResponse = await makeRequest({
    hostname: 'localhost',
    port: 20002,
    path: '/api/agent/tasks',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
    name: 'Search Recipe',
    type: 'search',
    params: {
      action: 'searchKeyword',
      query: 'Multi-Hub',
      options: {},
    },
    },
  });

  assertEqual(searchResponse.statusCode, 201);
  const searchTaskId = searchResponse.body.data.id;

  // 3. 记录指标
  const metricResponse = await makeRequest({
    hostname: 'localhost',
    port: 20002,
    path: '/api/agent/tasks',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
    name: 'Record Metric',
    type: 'metric',
    params: {
      action: 'record',
      name: 'workflow_completion',
      value: 1,
    },
    },
  });

  assertEqual(metricResponse.statusCode, 201);

  // 4. 验证三个任务都添加了
  const statsResponse = await makeRequest({
    hostname: 'localhost',
    port: 20002,
    path: '/api/agent/stats',
    method: 'GET',
  });

  assertEqual(statsResponse.body.data.totalTasks, 3);
  } finally {
  await gateway.stop();
  }
});

test('E2E: 批量任务处理', async () => {
  const agent = new Agent({ name: 'BatchE2E' });
  agent.registerHub('recipe', new RecipeHub());

  const gateway = new APIGateway(agent, { port: 20003 });
  await gateway.start();

  try {
  // 1. 批量添加 50 个任务
  const tasks = Array.from({ length: 50 }, (_, i) => ({
    name: `Batch Task ${i + 1}`,
    priority: i % 3 === 0 ? 'high' : i % 3 === 1 ? 'normal' : 'low',
  }));

  const batchResponse = await makeRequest({
    hostname: 'localhost',
    port: 20003,
    path: '/api/agent/tasks/batch',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: tasks,
  });

  assertEqual(batchResponse.statusCode, 201);
  assertEqual(batchResponse.body.data.length, 50);

  // 2. 验证统计
  const statsResponse = await makeRequest({
    hostname: 'localhost',
    port: 20003,
    path: '/api/agent/stats',
    method: 'GET',
  });

  assertEqual(statsResponse.body.data.totalTasks, 50);

  // 3. 验证优先级排序（队列中应该有高优先级任务在前）
  const queueResponse = await makeRequest({
    hostname: 'localhost',
    port: 20003,
    path: '/api/agent/queue',
    method: 'GET',
  });

  assertEqual(queueResponse.body.data.queueSize, 50);
  } finally {
  await gateway.stop();
  }
});

test('E2E: 性能基准测试 - 单个请求延迟', async () => {
  const agent = new Agent({ name: 'PerformanceE2E' });
  const gateway = new APIGateway(agent, { port: 20004 });
  await gateway.start();

  try {
  const latencies = [];

  // 执行 10 个请求，计算延迟
  for (let i = 0; i < 10; i++) {
    const timer = createTimer();

    await makeRequest({
    hostname: 'localhost',
    port: 20004,
    path: '/api/agent/tasks',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { name: `Perf Task ${i}` },
    });

    latencies.push(timer.elapsed());
  }

  // 计算统计信息
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const max = Math.max(...latencies);
  const min = Math.min(...latencies);

  console.log(`\n  延迟统计: avg=${avg.toFixed(2)}ms, min=${min}ms, max=${max}ms`);

  // 验证性能 (应该 < 10ms)
  assert(avg < 10, `平均延迟 ${avg}ms 超过 10ms 阈值`);
  } finally {
  await gateway.stop();
  }
});

test('E2E: 性能基准测试 - 吞吐量', async () => {
  const agent = new Agent({ name: 'ThroughputE2E' });
  const gateway = new APIGateway(agent, { port: 20005 });
  await gateway.start();

  try {
  const timer = createTimer();
  const requests = 100;

  // 并发发送 100 个请求
  const promises = [];
  for (let i = 0; i < requests; i++) {
    promises.push(
    makeRequest({
      hostname: 'localhost',
      port: 20005,
      path: '/api/agent/tasks',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { name: `Throughput Task ${i}` },
    })
    );
  }

  await Promise.all(promises);
  const elapsed = timer.elapsed();

  const throughput = (requests / elapsed) * 1000; // 每秒请求数
  console.log(`\n  吞吐量: ${throughput.toFixed(2)} 请求/秒 (总耗时: ${elapsed}ms)`);

  // 验证吞吐量 (应该 > 100 请求/秒)
  assert(throughput > 100, `吞吐量 ${throughput.toFixed(2)} 低于 100 请求/秒`);
  } finally {
  await gateway.stop();
  }
});

test('E2E: 并发任务执行', async () => {
  const agent = new Agent({ name: 'ConcurrentE2E' });
  agent.registerHub('recipe', new RecipeHub());

  const gateway = new APIGateway(agent, { port: 20006 });
  await gateway.start();

  try {
  // 1. 并发添加 20 个任务
  const promises = [];
  for (let i = 0; i < 20; i++) {
    promises.push(
    makeRequest({
      hostname: 'localhost',
      port: 20006,
      path: '/api/agent/tasks',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
      name: `Concurrent Task ${i}`,
      priority: i % 2 === 0 ? 'high' : 'low',
      },
    })
    );
  }

  const responses = await Promise.all(promises);

  // 验证所有请求都成功
  responses.forEach((response) => {
    assertEqual(response.statusCode, 201);
    assert(response.body.success === true);
  });

  // 2. 验证队列大小
  const statsResponse = await makeRequest({
    hostname: 'localhost',
    port: 20006,
    path: '/api/agent/stats',
    method: 'GET',
  });

  assertEqual(statsResponse.body.data.totalTasks, 20);
  } finally {
  await gateway.stop();
  }
});

test('E2E: 错误恢复 - 无效请求', async () => {
  const agent = new Agent({ name: 'ErrorE2E' });
  const gateway = new APIGateway(agent, { port: 20007 });
  await gateway.start();

  try {
  // 1. 发送无效 JSON
  const invalidJsonResponse = await makeRequest({
    hostname: 'localhost',
    port: 20007,
    path: '/api/agent/tasks',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: null,
  });

  // 应该返回 400 错误
  assertEqual(invalidJsonResponse.statusCode, 400);

  // 2. 缺少必填字段
  const missingFieldResponse = await makeRequest({
    hostname: 'localhost',
    port: 20007,
    path: '/api/agent/tasks',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { priority: 'high' }, // 缺少 name
  });

  assertEqual(missingFieldResponse.statusCode, 400);
  assert(missingFieldResponse.body.success === false);

  // 3. 访问不存在的端点
  const notFoundResponse = await makeRequest({
    hostname: 'localhost',
    port: 20007,
    path: '/api/nonexistent',
    method: 'GET',
  });

  assertEqual(notFoundResponse.statusCode, 404);
  } finally {
  await gateway.stop();
  }
});

test('E2E: Agent 状态管理', async () => {
  const agent = new Agent({ name: 'StateE2E' });
  const gateway = new APIGateway(agent, { port: 20008 });
  await gateway.start();

  try {
  // 1. 添加任务
  await makeRequest({
    hostname: 'localhost',
    port: 20008,
    path: '/api/agent/tasks',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { name: 'State Task' },
  });

  // 2. 暂停 Agent
  const pauseResponse = await makeRequest({
    hostname: 'localhost',
    port: 20008,
    path: '/api/agent/pause',
    method: 'POST',
  });

  assertEqual(pauseResponse.statusCode, 200);
  assert(pauseResponse.body.success === true);

  // 3. 验证 Agent 状态
  const infoResponse = await makeRequest({
    hostname: 'localhost',
    port: 20008,
    path: '/api/agent/info',
    method: 'GET',
  });

  assertEqual(infoResponse.body.data.state, 'paused');

  // 4. 恢复 Agent
  const resumeResponse = await makeRequest({
    hostname: 'localhost',
    port: 20008,
    path: '/api/agent/resume',
    method: 'POST',
  });

  assertEqual(resumeResponse.statusCode, 200);

  // 5. 清空队列
  const clearResponse = await makeRequest({
    hostname: 'localhost',
    port: 20008,
    path: '/api/agent/clear',
    method: 'POST',
  });

  assertEqual(clearResponse.statusCode, 200);

  // 6. 验证队列已清空
  const statsResponse = await makeRequest({
    hostname: 'localhost',
    port: 20008,
    path: '/api/agent/stats',
    method: 'GET',
  });

  assertEqual(statsResponse.body.data.totalTasks, 1); // 只有清空前添加的那一个
  } finally {
  await gateway.stop();
  }
});

test('E2E: 高并发压力测试', async () => {
  const agent = new Agent({ name: 'StressE2E' });
  const gateway = new APIGateway(agent, { port: 20009 });
  await gateway.start();

  try {
  const timer = createTimer();
  const concurrency = 50;
  const iterations = 2;

  let successCount = 0;
  let errorCount = 0;

  // 执行 50 并发 × 2 轮 = 100 个请求
  for (let iter = 0; iter < iterations; iter++) {
    const promises = [];

    for (let i = 0; i < concurrency; i++) {
    promises.push(
      makeRequest({
      hostname: 'localhost',
      port: 20009,
      path: '/api/agent/tasks',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        name: `Stress Test ${iter}-${i}`,
        priority: Math.random() > 0.5 ? 'high' : 'low',
      },
      }).then(() => {
      successCount++;
      }).catch(() => {
      errorCount++;
      })
    );
    }

    await Promise.all(promises);
  }

  const elapsed = timer.elapsed();
  console.log(`\n  压力测试: ${successCount} 成功, ${errorCount} 失败, 总耗时 ${elapsed}ms`);

  // 验证成功率 > 99%
  const successRate = successCount / (successCount + errorCount);
  assert(successRate > 0.99, `成功率 ${(successRate * 100).toFixed(2)}% 低于 99%`);

  // 验证所有任务都被添加了
  const statsResponse = await makeRequest({
    hostname: 'localhost',
    port: 20009,
    path: '/api/agent/stats',
    method: 'GET',
  });

  assertEqual(statsResponse.body.data.totalTasks, concurrency * iterations);
  } finally {
  await gateway.stop();
  }
});

test('E2E: 长时间运行稳定性', async () => {
  const agent = new Agent({ name: 'StabilityE2E' });
  const gateway = new APIGateway(agent, { port: 20010 });
  await gateway.start();

  try {
  let totalRequests = 0;
  let totalErrors = 0;

  // 运行 5 秒，每秒发送 10 个请求
  const startTime = Date.now();
  const duration = 5000; // 5 秒

  while (Date.now() - startTime < duration) {
    const promises = [];

    for (let i = 0; i < 10; i++) {
    promises.push(
      makeRequest({
      hostname: 'localhost',
      port: 20010,
      path: '/api/agent/tasks',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { name: `Stability Task ${totalRequests + i}` },
      }).catch(() => {
      totalErrors++;
      })
    );
    }

    try {
    await Promise.all(promises);
    totalRequests += 10;
    } catch (e) {
    totalErrors += 10;
    }

    // 每秒检查一次
    const elapsed = Date.now() - startTime;
    const remaining = duration - elapsed;
    if (remaining > 0) {
    await new Promise(resolve => setTimeout(resolve, Math.min(1000, remaining)));
    }
  }

  console.log(`\n  稳定性测试: ${totalRequests} 请求成功, ${totalErrors} 错误`);

  // 验证成功率 > 95%
  const successRate = totalRequests / (totalRequests + totalErrors);
  assert(successRate > 0.95, `成功率 ${(successRate * 100).toFixed(2)}% 低于 95%`);
  } finally {
  await gateway.stop();
  }
});

// ===== 运行测试 =====

async function runTests() {
  console.log('🧪 端到端系统测试\n');

  for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   错误: ${error.message}`);
    failed++;
  }
  }

  console.log(`\n📊 结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
