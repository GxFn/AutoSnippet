/**
 * API Gateway 单元测试
 * 
 * 测试范围：
 * 1. 路由注册和匹配
 * 2. 请求解析和验证
 * 3. 响应格式化
 * 4. 错误处理
 * 5. 服务器启动和停止
 */

const { APIGateway } = require('../../lib/api/APIGateway');
const { Agent } = require('../../lib/agent/Agent');
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

// ===== 单元测试 =====

test('APIGateway 应该创建实例', () => {
  const agent = new Agent({ name: 'TestAgent' });
  const gateway = new APIGateway(agent, { port: 9000 });

  assert(gateway.agent === agent);
  assertEqual(gateway.port, 9000);
  assertEqual(gateway.host, 'localhost');
  assert(gateway.routes.size > 0, '应该有初始化的路由');
});

test('APIGateway 应该注册路由', () => {
  const agent = new Agent({ name: 'TestAgent' });
  const gateway = new APIGateway(agent);

  const initialRouteCount = gateway.routes.size;

  gateway.register('GET', '/api/custom', async () => ({
    statusCode: 200,
    body: { message: 'custom' },
  }));

  assertEqual(gateway.routes.size, initialRouteCount + 1);
});

test('APIGateway 应该匹配精确路由', () => {
  const agent = new Agent({ name: 'TestAgent' });
  const gateway = new APIGateway(agent);

  gateway.register('GET', '/api/test', async () => ({
    statusCode: 200,
    body: { message: 'test' },
  }));

  const match = gateway._matchRoute('GET', '/api/test');
  assert(match !== null, '应该匹配路由');
  assert(match.params !== null, '应该有参数对象');
});

test('APIGateway 应该匹配动态路由', () => {
  const agent = new Agent({ name: 'TestAgent' });
  const gateway = new APIGateway(agent);

  gateway.register('GET', '/api/items/:id', async () => ({
    statusCode: 200,
  }));

  const match = gateway._matchRoute('GET', '/api/items/123');
  assert(match !== null, '应该匹配动态路由');
  assertEqual(match.params.id, '123', '应该提取参数');
});

test('APIGateway 应该不匹配不存在的路由', () => {
  const agent = new Agent({ name: 'TestAgent' });
  const gateway = new APIGateway(agent);

  const match = gateway._matchRoute('GET', '/api/nonexistent');
  assert(match === null, '不应该匹配不存在的路由');
});

test('APIGateway 应该解析 JSON 请求体', () => {
  const agent = new Agent({ name: 'TestAgent' });
  const gateway = new APIGateway(agent);

  const json = '{"name": "Test", "value": 123}';
  const parsed = gateway._parseBody(json, 'application/json');

  assertEqual(parsed.name, 'Test');
  assertEqual(parsed.value, 123);
});

test('APIGateway 应该解析 URL 编码请求体', () => {
  const agent = new Agent({ name: 'TestAgent' });
  const gateway = new APIGateway(agent);

  const urlEncoded = 'name=Test&value=123';
  const parsed = gateway._parseBody(urlEncoded, 'application/x-www-form-urlencoded');

  assertEqual(parsed.name, 'Test');
  assertEqual(parsed.value, '123'); // URL 编码都是字符串
});

test('APIGateway 应该处理无效 JSON', () => {
  const agent = new Agent({ name: 'TestAgent' });
  const gateway = new APIGateway(agent);

  try {
    gateway._parseBody('{invalid json}', 'application/json');
    assert(false, '应该抛出错误');
  } catch (error) {
    assert(error.message.includes('Invalid JSON'));
  }
});

test('APIGateway 应该构建健康检查端点', async () => {
  const agent = new Agent({ name: 'TestAgent' });
  const gateway = new APIGateway(agent);

  const response = await gateway._handleHealth({});

  assertEqual(response.statusCode, 200);
  assert(response.body.status === 'healthy');
  assert(response.body.timestamp);
});

test('APIGateway 应该获取 Agent 信息', async () => {
  const agent = new Agent({ name: 'TestAgent' });
  const gateway = new APIGateway(agent);

  const response = await gateway._handleGetAgentInfo({});

  assertEqual(response.statusCode, 200);
  assert(response.body.success === true);
  assert(response.body.data);
  assertEqual(response.body.data.name, 'TestAgent');
});

test('APIGateway 应该获取统计信息', async () => {
  const agent = new Agent({ name: 'TestAgent' });
  const gateway = new APIGateway(agent);

  // 添加一个任务
  agent.addTask({ name: 'Test Task' });

  const response = await gateway._handleGetStats({});

  assertEqual(response.statusCode, 200);
  assert(response.body.success === true);
  assert(response.body.data);
  assertEqual(response.body.data.totalTasks, 1);
});

test('APIGateway 应该获取队列信息', async () => {
  const agent = new Agent({ name: 'TestAgent' });
  const gateway = new APIGateway(agent);

  // 添加一个任务
  agent.addTask({ name: 'Test Task' });

  const response = await gateway._handleGetQueueInfo({});

  assertEqual(response.statusCode, 200);
  assert(response.body.success === true);
  assert(response.body.data);
  assertEqual(response.body.data.queueSize, 1);
});

test('APIGateway 应该添加任务', async () => {
  const agent = new Agent({ name: 'TestAgent' });
  const gateway = new APIGateway(agent);

  const request = {
    body: {
      name: 'New Task',
      priority: 'high',
      handler: async () => {},
    },
  };

  const response = await gateway._handleAddTask(request);

  assertEqual(response.statusCode, 201);
  assert(response.body.success === true);
  assert(response.body.data);
  assertEqual(response.body.data.name, 'New Task');
  assertEqual(response.body.data.priority, 'high');
});

test('APIGateway 应该验证添加任务的请求', async () => {
  const agent = new Agent({ name: 'TestAgent' });
  const gateway = new APIGateway(agent);

  // 缺少 name 字段
  const request = {
    body: {
      priority: 'high',
    },
  };

  const response = await gateway._handleAddTask(request);

  assertEqual(response.statusCode, 400);
  assert(response.body.success === false);
  assert(response.body.error.includes('name'));
});

test('APIGateway 应该批量添加任务', async () => {
  const agent = new Agent({ name: 'TestAgent' });
  const gateway = new APIGateway(agent);

  const request = {
    body: [
      { name: 'Task 1' },
      { name: 'Task 2' },
      { name: 'Task 3' },
    ],
  };

  const response = await gateway._handleBatchAddTasks(request);

  assertEqual(response.statusCode, 201);
  assert(response.body.success === true);
  assertEqual(response.body.data.length, 3);
});

test('APIGateway 应该获取任务信息', async () => {
  const agent = new Agent({ name: 'TestAgent' });
  const gateway = new APIGateway(agent);

  const task = agent.addTask({ name: 'Test Task' });

  const request = {
    params: {
      id: task.id,
    },
  };

  const response = await gateway._handleGetTask(request);

  assertEqual(response.statusCode, 200);
  assert(response.body.success === true);
  assertEqual(response.body.data.id, task.id);
  assertEqual(response.body.data.name, 'Test Task');
});

test('APIGateway 应该处理不存在的任务', async () => {
  const agent = new Agent({ name: 'TestAgent' });
  const gateway = new APIGateway(agent);

  const request = {
    params: {
      id: 'nonexistent',
    },
  };

  const response = await gateway._handleGetTask(request);

  assertEqual(response.statusCode, 404);
  assert(response.body.success === false);
});

test('APIGateway 应该启动和停止服务器', async () => {
  const agent = new Agent({ name: 'TestAgent' });
  const gateway = new APIGateway(agent, { port: 19000 });

  const server = await gateway.start();
  assert(server !== null, '应该返回服务器实例');

  await gateway.stop();
  assert(true, '应该能够正常停止');
});

test('APIGateway 应该添加中间件', () => {
  const agent = new Agent({ name: 'TestAgent' });
  const gateway = new APIGateway(agent);

  let middlewareExecuted = false;

  gateway.use(async (req, res) => {
    middlewareExecuted = true;
  });

  assertEqual(gateway.middlewares.length, 1);
});

// ===== 运行测试 =====

async function runTests() {
  console.log('🧪 API Gateway 单元测试\n');

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
