/**
 * API Gateway 集成测试
 * 
 * 测试范围：
 * 1. 完整的 HTTP 请求-响应循环
 * 2. 与 Agent 的集成
 * 3. 与各 Hub 的协作
 * 4. 错误处理和边界情况
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

// ===== 集成测试 =====

test('API Gateway 应该响应健康检查请求', async () => {
  const agent = new Agent({ name: 'TestAgent' });
  const gateway = new APIGateway(agent, { port: 19001 });

  await gateway.start();

  try {
  const response = await makeRequest({
    hostname: 'localhost',
    port: 19001,
    path: '/api/health',
    method: 'GET',
  });

  assertEqual(response.statusCode, 200);
  assertEqual(response.body.status, 'healthy');
  } finally {
  await gateway.stop();
  }
});

test('API Gateway 应该返回 Agent 信息', async () => {
  const agent = new Agent({ name: 'InfoAgent' });
  const gateway = new APIGateway(agent, { port: 19002 });

  await gateway.start();

  try {
  const response = await makeRequest({
    hostname: 'localhost',
    port: 19002,
    path: '/api/agent/info',
    method: 'GET',
  });

  assertEqual(response.statusCode, 200);
  assert(response.body.success === true);
  assertEqual(response.body.data.name, 'InfoAgent');
  } finally {
  await gateway.stop();
  }
});

test('API Gateway 应该处理添加任务请求', async () => {
  const agent = new Agent({ name: 'TaskAgent' });
  const gateway = new APIGateway(agent, { port: 19003 });

  await gateway.start();

  try {
  const response = await makeRequest({
    hostname: 'localhost',
    port: 19003,
    path: '/api/agent/tasks',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
    name: 'HTTP Task',
    priority: 'normal',
    },
  });

  assertEqual(response.statusCode, 201);
  assert(response.body.success === true);
  assertEqual(response.body.data.name, 'HTTP Task');
  } finally {
  await gateway.stop();
  }
});

test('API Gateway 应该验证必填字段', async () => {
  const agent = new Agent({ name: 'ValidateAgent' });
  const gateway = new APIGateway(agent, { port: 19004 });

  await gateway.start();

  try {
  const response = await makeRequest({
    hostname: 'localhost',
    port: 19004,
    path: '/api/agent/tasks',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
    priority: 'high',
    // 缺少 name 字段
    },
  });

  assertEqual(response.statusCode, 400);
  assert(response.body.success === false);
  } finally {
  await gateway.stop();
  }
});

test('API Gateway 应该处理批量添加任务', async () => {
  const agent = new Agent({ name: 'BatchAgent' });
  const gateway = new APIGateway(agent, { port: 19005 });

  await gateway.start();

  try {
  const response = await makeRequest({
    hostname: 'localhost',
    port: 19005,
    path: '/api/agent/tasks/batch',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: [
    { name: 'Task 1' },
    { name: 'Task 2' },
    { name: 'Task 3' },
    ],
  });

  assertEqual(response.statusCode, 201);
  assert(response.body.success === true);
  assertEqual(response.body.data.length, 3);
  } finally {
  await gateway.stop();
  }
});

test('API Gateway 应该获取队列统计信息', async () => {
  const agent = new Agent({ name: 'StatsAgent' });
  const gateway = new APIGateway(agent, { port: 19006 });

  // 预先添加任务
  agent.addTask({ name: 'Task 1' });
  agent.addTask({ name: 'Task 2' });

  await gateway.start();

  try {
  const response = await makeRequest({
    hostname: 'localhost',
    port: 19006,
    path: '/api/agent/stats',
    method: 'GET',
  });

  assertEqual(response.statusCode, 200);
  assert(response.body.success === true);
  assertEqual(response.body.data.totalTasks, 2);
  } finally {
  await gateway.stop();
  }
});

test('API Gateway 应该返回 404 错误', async () => {
  const agent = new Agent({ name: 'NotFoundAgent' });
  const gateway = new APIGateway(agent, { port: 19007 });

  await gateway.start();

  try {
  const response = await makeRequest({
    hostname: 'localhost',
    port: 19007,
    path: '/api/nonexistent',
    method: 'GET',
  });

  assertEqual(response.statusCode, 404);
  assert(response.body.error === 'Not Found');
  } finally {
  await gateway.stop();
  }
});

test('API Gateway 应该处理 Recipe 任务', async () => {
  const agent = new Agent({ name: 'RecipeAgent' });
  const recipeHub = new RecipeHub();
  agent.registerHub('recipe', recipeHub);

  const gateway = new APIGateway(agent, { port: 19008 });

  await gateway.start();

  try {
  // 添加 Recipe 任务
  const response = await makeRequest({
    hostname: 'localhost',
    port: 19008,
    path: '/api/agent/tasks',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
    name: 'Create Recipe',
    type: 'recipe',
    params: {
      action: 'create',
      title: 'API Recipe',
      description: 'Created via API',
      category: 'Testing',
    },
    },
  });

  assertEqual(response.statusCode, 201);
  assert(response.body.success === true);
  } finally {
  await gateway.stop();
  }
});

test('API Gateway 应该处理搜索任务', async () => {
  const agent = new Agent({ name: 'SearchAgent' });
  const searchHub = new SearchHub();
  agent.registerHub('search', searchHub);

  const gateway = new APIGateway(agent, { port: 19009 });

  await gateway.start();

  try {
  // 添加搜索任务
  const response = await makeRequest({
    hostname: 'localhost',
    port: 19009,
    path: '/api/agent/tasks',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
    name: 'Search Query',
    type: 'search',
    params: {
      action: 'searchKeyword',
      query: 'test',
      options: {},
    },
    },
  });

  assertEqual(response.statusCode, 201);
  assert(response.body.success === true);
  } finally {
  await gateway.stop();
  }
});

test('API Gateway 应该处理指标任务', async () => {
  const agent = new Agent({ name: 'MetricsAgent' });
  const metricsHub = new MetricsHub();
  agent.registerHub('metric', metricsHub);

  const gateway = new APIGateway(agent, { port: 19010 });

  await gateway.start();

  try {
  // 添加指标任务
  const response = await makeRequest({
    hostname: 'localhost',
    port: 19010,
    path: '/api/agent/tasks',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
    name: 'Record Metric',
    type: 'metric',
    params: {
      action: 'record',
      name: 'api_requests',
      value: 100,
    },
    },
  });

  assertEqual(response.statusCode, 201);
  assert(response.body.success === true);
  } finally {
  await gateway.stop();
  }
});

test('API Gateway 应该获取任务详情', async () => {
  const agent = new Agent({ name: 'DetailAgent' });
  const gateway = new APIGateway(agent, { port: 19011 });

  // 预先添加任务
  const task = agent.addTask({ name: 'Detail Task' });

  await gateway.start();

  try {
  const response = await makeRequest({
    hostname: 'localhost',
    port: 19011,
    path: `/api/agent/tasks/${task.id}`,
    method: 'GET',
  });

  assertEqual(response.statusCode, 200);
  assert(response.body.success === true);
  assertEqual(response.body.data.id, task.id);
  assertEqual(response.body.data.name, 'Detail Task');
  } finally {
  await gateway.stop();
  }
});

test('API Gateway 应该处理多个并发请求', async () => {
  const agent = new Agent({ name: 'ConcurrentAgent' });
  const gateway = new APIGateway(agent, { port: 19012 });

  await gateway.start();

  try {
  const promises = [];

  // 并发发送 10 个请求
  for (let i = 0; i < 10; i++) {
    promises.push(
    makeRequest({
      hostname: 'localhost',
      port: 19012,
      path: '/api/agent/tasks',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
      name: `Concurrent Task ${i}`,
      },
    })
    );
  }

  const responses = await Promise.all(promises);

  // 验证所有请求都成功了
  responses.forEach((response) => {
    assertEqual(response.statusCode, 201);
    assert(response.body.success === true);
  });

  // 验证所有任务都被添加了
  const statsResponse = await makeRequest({
    hostname: 'localhost',
    port: 19012,
    path: '/api/agent/stats',
    method: 'GET',
  });

  assertEqual(statsResponse.body.data.totalTasks, 10);
  } finally {
  await gateway.stop();
  }
});

test('API Gateway 应该支持 Agent 控制操作', async () => {
  const agent = new Agent({ name: 'ControlAgent' });
  const gateway = new APIGateway(agent, { port: 19013 });

  await gateway.start();

  try {
  // 暂停 Agent
  const pauseResponse = await makeRequest({
    hostname: 'localhost',
    port: 19013,
    path: '/api/agent/pause',
    method: 'POST',
  });

  assertEqual(pauseResponse.statusCode, 200);
  assert(pauseResponse.body.success === true);

  // 恢复 Agent
  const resumeResponse = await makeRequest({
    hostname: 'localhost',
    port: 19013,
    path: '/api/agent/resume',
    method: 'POST',
  });

  assertEqual(resumeResponse.statusCode, 200);
  assert(resumeResponse.body.success === true);

  // 清空队列
  const clearResponse = await makeRequest({
    hostname: 'localhost',
    port: 19013,
    path: '/api/agent/clear',
    method: 'POST',
  });

  assertEqual(clearResponse.statusCode, 200);
  assert(clearResponse.body.success === true);
  } finally {
  await gateway.stop();
  }
});

// ===== 运行测试 =====

async function runTests() {
  console.log('🧪 API Gateway 集成测试\n');

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
