/**
 * Agent 集成测试 - Agent 与各 Hub 的协作
 * 
 * 验证场景：
 * 1. Agent + RecipeHub 集成
 * 2. Agent + SearchHub 集成
 * 3. Agent + MetricsHub 集成
 * 4. Agent 任务工作流
 * 5. Agent 错误恢复
 */

const { Agent } = require('../../lib/agent/Agent');
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

// ===== 集成测试 =====

test('Agent 应该与 RecipeHub 协作', async () => {
  const agent = new Agent({ name: 'RecipeAgent' });
  const recipeHub = new RecipeHub();

  agent.registerHub('recipe', recipeHub);

  const task = agent.addTask({
  name: 'Create Recipe',
  type: 'recipe',
  params: {
    action: 'create',
    title: 'Agent Created Recipe',
    description: 'Created by Agent',
    category: 'Testing'
  }
  });

  const result = await agent.executeTask(task);

  assert(result.id);
  assertEqual(result.title, 'Agent Created Recipe');
  assertEqual(recipeHub.getStats().total, 1);
});

test('Agent 应该与 SearchHub 协作', async () => {
  const agent = new Agent({ name: 'SearchAgent' });
  const searchHub = new SearchHub();

  agent.registerHub('search', searchHub);

  // 添加索引任务
  const indexTaskId = agent.addTask({
  name: 'Index Document',
  type: 'search',
  params: {
    action: 'index',
    doc: {
    id: 'doc1',
    title: 'Test Document',
    content: 'Document content for testing'
    }
  }
  });

  const indexTask = agent.queue.getTask(indexTaskId);
  await agent.executeTask(indexTask);

  // 添加搜索任务
  const searchTask = agent.addTask({
  name: 'Search Documents',
  type: 'search',
  params: {
    action: 'searchKeyword',
    query: 'test',
    options: {}
  }
  });

  const results = await agent.executeTask(searchTask);

  assert(Array.isArray(results));
});

test('Agent 应该与 MetricsHub 协作', async () => {
  const agent = new Agent({ name: 'MetricsAgent' });
  const metricsHub = new MetricsHub();

  agent.registerHub('metrics', metricsHub);

  const task = agent.addTask({
  name: 'Record Metric',
  type: 'metric',
  params: {
    action: 'record',
    name: 'test.metric',
    value: 42.5,
    tags: { source: 'agent' },
    unit: 'ms'
  }
  });

  await agent.executeTask(task);

  const latest = metricsHub.getLatest('test.metric');
  assert(latest !== null);
  assertEqual(latest.value, 42.5);
});

test('Agent 应该处理任务依赖关系', async () => {
  const agent = new Agent({ name: 'DependencyAgent' });
  const recipeHub = new RecipeHub();

  agent.registerHub('recipe', recipeHub);

  // 创建第一个任务
  const task1Id = agent.addTask({
  name: 'Create Recipe 1',
  type: 'recipe',
  params: {
    action: 'create',
    title: 'Recipe 1',
    category: 'Testing'
  }
  });

  const task1 = agent.queue.getTask(task1Id);
  await agent.executeTask(task1);

  // 创建依赖第一个任务的第二个任务
  const task2Id = agent.addTask({
  name: 'Create Recipe 2',
  type: 'recipe',
  params: {
    action: 'create',
    title: 'Recipe 2',
    category: 'Testing'
  },
  dependencies: [task1Id]
  });

  const task2 = agent.queue.getTask(task2Id);
  
  // 在完成第一个任务之前，第二个任务不应该出队
  const dequeued = agent.queue.dequeue();
  assert(dequeued === null);

  // 现在第一个任务已完成，第二个任务应该出队
  const dequeued2 = agent.queue.dequeue();
  assert(dequeued2 !== null);
  assertEqual(dequeued2.id, task2Id);
});

test('Agent 应该支持自定义处理器', async () => {
  const agent = new Agent({ name: 'CustomAgent' });

  let customHandlerCalled = false;
  const taskId = agent.addTask({
  name: 'Custom Task',
  handler: async (params) => {
    customHandlerCalled = true;
    return { custom: 'result', param: params.value };
  },
  params: { value: 'test' }
  });

  const task = agent.queue.getTask(taskId);
  const result = await agent.executeTask(task);

  assert(customHandlerCalled);
  assertEqual(result.custom, 'result');
  assertEqual(result.param, 'test');
});

test('Agent 应该管理任务优先级', () => {
  const agent = new Agent({ name: 'PriorityAgent' });

  const lowTask = agent.addTask({
  name: 'Low Priority',
  priority: 'low',
  handler: async () => {}
  });

  const highTask = agent.addTask({
  name: 'High Priority',
  priority: 'high',
  handler: async () => {}
  });

  const normalTask = agent.addTask({
  name: 'Normal Priority',
  priority: 'normal',
  handler: async () => {}
  });

  // 获取下一个任务，应该是高优先级
  const first = agent.queue.dequeue();
  assert(first.id === highTask.id, `Expected first task to be high priority (${highTask.id}), got ${first.id}`);

  // 下一个应该是普通优先级
  const second = agent.queue.dequeue();
  assert(second.id === normalTask.id, `Expected second task to be normal priority (${normalTask.id}), got ${second.id}`);

  // 最后是低优先级
  const third = agent.queue.dequeue();
  assert(third.id === lowTask.id, `Expected third task to be low priority (${lowTask.id}), got ${third.id}`);
});

test('Agent 应该记录事件', () => {
  const agent = new Agent({ name: 'EventAgent' });

  const events = [];
  agent.on('task:added', (data) => {
  events.push({ type: 'added', taskId: data.taskId });
  });

  agent.addTask({ name: 'Task 1', handler: async () => {} });

  assert(events.length > 0);
  assert(events[0].type === 'added');
});

test('Agent 应该统计任务执行情况', async () => {
  const agent = new Agent({ name: 'StatsAgent' });

  const task1 = agent.addTask({
  name: 'Task 1',
  handler: async () => ({ result: 'success' })
  });

  const task2 = agent.addTask({
  name: 'Task 2',
  handler: async () => ({ result: 'success' })
  });

  const dequeued1 = agent.queue.dequeue();
  const dequeued2 = agent.queue.dequeue();

  await agent.executeTask(dequeued1);
  await agent.executeTask(dequeued2);

  const stats = agent.getStats();

  assertEqual(stats.totalTasks, 2);
  assertEqual(stats.completedTasks, 2);
  assert(stats.completed === 2);
});

test('Agent 应该处理任务失败和恢复', async () => {
  const agent = new Agent({ name: 'RecoveryAgent' });

  let attempts = 0;
  const taskId = agent.addTask({
  name: 'Failing Task',
  retries: 2,
  handler: async () => {
    attempts++;
    if (attempts < 2) {
    throw new Error('First attempt failure');
    }
    return { recovered: true };
  }
  });

  const task = agent.queue.getTask(taskId);

  // 第一次执行失败
  try {
  await agent.executeTask(task);
  } catch (error) {
  // 预期失败
  }

  assert(task.shouldRetry());

  // 重试
  const retriedTask = agent.queue.dequeue();
  assert(retriedTask !== null);

  const result = await agent.executeTask(retriedTask);

  assert(result.recovered);
  assertEqual(attempts, 2);
});

test('Agent 应该与多个 Hub 协作', async () => {
  const agent = new Agent({ name: 'MultiHubAgent' });
  const recipeHub = new RecipeHub();
  const searchHub = new SearchHub();
  const metricsHub = new MetricsHub();

  agent.registerHub('recipe', recipeHub);
  agent.registerHub('search', searchHub);
  agent.registerHub('metrics', metricsHub);

  // 创建 Recipe
  const createTaskId = agent.addTask({
  name: 'Create Recipe',
  type: 'recipe',
  params: {
    action: 'create',
    title: 'Multi-Hub Recipe',
    category: 'Testing'
  }
  });

  const createTask = agent.queue.getTask(createTaskId);
  const recipe = await agent.executeTask(createTask);

  // 索引到搜索
  const indexTaskId = agent.addTask({
  name: 'Index Recipe',
  type: 'search',
  params: {
    action: 'index',
    doc: {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description
    }
  }
  });

  const indexTask = agent.queue.getTask(indexTaskId);
  await agent.executeTask(indexTask);

  // 记录指标
  const metricTaskId = agent.addTask({
  name: 'Record Metric',
  type: 'metric',
  params: {
    action: 'counter',
    name: 'recipe.created',
    delta: 1
  }
  });

  const metricTask = agent.queue.getTask(metricTaskId);
  await agent.executeTask(metricTask);

  // 验证所有 Hub
  assertEqual(recipeHub.getStats().total, 1);
  assertEqual(searchHub.getIndexSize(), 1);
  assert(metricsHub.getLatest('recipe.created') !== null);
});

test('Agent 应该清空队列和重置统计', () => {
  const agent = new Agent({ name: 'CleanupAgent' });

  agent.addTask({ name: 'Task 1', handler: async () => {} });
  agent.addTask({ name: 'Task 2', handler: async () => {} });

  agent.stats.completedTasks = 10;

  agent.clear();
  agent.resetStats();

  assertEqual(agent.getQueueInfo().queueSize, 0);
  assertEqual(agent.stats.completedTasks, 0);
});

test('Agent 应该支持暂停和恢复', () => {
  const agent = new Agent({ name: 'PauseAgent' });

  assertEqual(agent.state, 'idle');

  agent.pause();
  assertEqual(agent.state, 'paused');

  agent.resume();
  assertEqual(agent.state, 'running');
});

test('Agent 应该获取完整的 Agent 信息', () => {
  const agent = new Agent({ name: 'InfoAgent' });

  agent.registerHub('recipe', {});
  agent.registerHub('search', {});

  agent.addTask({ name: 'Task 1', handler: async () => {} });

  const info = agent.getInfo();

  assertEqual(info.name, 'InfoAgent');
  assert(info.id);
  assert(info.stats);
  assert(info.queue);
  assert(info.hubs.includes('recipe'));
  assert(info.hubs.includes('search'));
});

// ===== 运行测试 =====

console.log('🧪 Agent 集成测试\n');

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
