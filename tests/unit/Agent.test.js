/**
 * Agent 与 TaskQueue 单元测试
 */

const { Agent } = require('../../lib/agent/Agent');
const { Task, TaskQueue } = require('../../lib/agent/Task');

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

// ===== Task 测试 =====

test('Task 应该创建实例', () => {
  const task = new Task({
    name: 'Test Task',
    type: 'action',
    priority: 'high'
  });

  assertEqual(task.name, 'Test Task');
  assertEqual(task.type, 'action');
  assertEqual(task.priority, 'high');
  assertEqual(task.status, 'pending');
  assert(task.id);
});

test('Task 应该管理状态转移', () => {
  const task = new Task({ name: 'Test' });

  task.start();
  assertEqual(task.status, 'running');
  assert(task.startedAt !== null);

  task.complete({ result: 'success' });
  assertEqual(task.status, 'completed');
  assert(task.completedAt !== null);
  assertEqual(task.result.result, 'success');
});

test('Task 应该处理失败和重试', () => {
  const task = new Task({ name: 'Test', retries: 3 });

  task.start();
  const error = new Error('Test error');
  task.fail(error);

  assertEqual(task.status, 'pending');
  assertEqual(task.retriesRemaining, 2);
  assert(task.shouldRetry());
});

test('Task 应该在重试次数用尽后标记失败', () => {
  const task = new Task({ name: 'Test', retries: 1 });

  task.start();
  task.fail(new Error('First failure'));
  assertEqual(task.status, 'pending');

  task.start();
  task.fail(new Error('Second failure'));
  assertEqual(task.status, 'failed');
  assertEqual(task.retriesRemaining, 0);
});

test('Task 应该计算执行时间', () => {
  const task = new Task({ name: 'Test' });

  task.start();
  task.complete({ result: 'ok' });

  const duration = task.getDuration();
  assert(duration >= 0);
});

test('Task 应该支持标签和依赖', () => {
  const task = new Task({
    name: 'Test',
    tags: ['urgent', 'important'],
    dependencies: ['task1', 'task2']
  });

  assert(task.tags.includes('urgent'));
  assertEqual(task.dependencies.length, 2);
});

test('Task 应该取消操作', () => {
  const task = new Task({ name: 'Test' });

  task.cancel();
  assertEqual(task.status, 'cancelled');
  assert(task.completedAt !== null);
});

test('Task 应该获取信息快照', () => {
  const task = new Task({ name: 'Test Task', type: 'action' });

  task.start();
  const info = task.getInfo();

  assertEqual(info.name, 'Test Task');
  assertEqual(info.type, 'action');
  assertEqual(info.status, 'running');
  assert(info.attempts > 0);
});

// ===== TaskQueue 测试 =====

test('TaskQueue 应该创建实例', () => {
  const queue = new TaskQueue();

  assert(queue instanceof TaskQueue);
  assertEqual(queue.size(), 0);
});

test('TaskQueue 应该入队和出队任务', () => {
  const queue = new TaskQueue();

  const task1 = new Task({ name: 'Task 1' });
  const task2 = new Task({ name: 'Task 2' });

  queue.enqueue(task1);
  queue.enqueue(task2);

  assertEqual(queue.size(), 2);

  const dequeued = queue.dequeue();
  assertEqual(dequeued.id, task1.id);
  assertEqual(queue.size(), 1);
});

test('TaskQueue 应该按优先级排序', () => {
  const queue = new TaskQueue();

  const low = new Task({ name: 'Low', priority: 'low' });
  const high = new Task({ name: 'High', priority: 'high' });
  const normal = new Task({ name: 'Normal', priority: 'normal' });

  queue.enqueue(low);
  queue.enqueue(normal);
  queue.enqueue(high);

  const first = queue.dequeue();
  assertEqual(first.priority, 'high');

  const second = queue.dequeue();
  assertEqual(second.priority, 'normal');

  const third = queue.dequeue();
  assertEqual(third.priority, 'low');
});

test('TaskQueue 应该检查任务依赖', () => {
  const queue = new TaskQueue();

  const task1 = new Task({ name: 'Task 1' });
  const task2 = new Task({ name: 'Task 2', dependencies: [task1.id] });

  queue.enqueue(task1);
  queue.enqueue(task2);

  // Task 1 没有依赖，应该先执行
  const first = queue.dequeue();
  assertEqual(first.id, task1.id);

  // Task 2 依赖 Task 1，Task 1 尚未完成，不应该出队
  const second = queue.dequeue();
  assert(second === null);

  // 完成 Task 1
  task1.complete();

  // 现在 Task 2 应该可以出队
  const third = queue.dequeue();
  assertEqual(third.id, task2.id);
});

test('TaskQueue 应该批量入队', () => {
  const queue = new TaskQueue();

  const tasks = [
    new Task({ name: 'Task 1' }),
    new Task({ name: 'Task 2' }),
    new Task({ name: 'Task 3' })
  ];

  const ids = queue.enqueueBatch(tasks);

  assertEqual(ids.length, 3);
  assertEqual(queue.size(), 3);
});

test('TaskQueue 应该获取运行中的任务', () => {
  const queue = new TaskQueue();

  const task1 = new Task({ name: 'Task 1' });
  const task2 = new Task({ name: 'Task 2' });

  queue.enqueue(task1);
  queue.enqueue(task2);

  task1.start();

  const running = queue.getRunning();
  assertEqual(running.length, 1);
  assertEqual(running[0].id, task1.id);
});

test('TaskQueue 应该获取已完成的任务', () => {
  const queue = new TaskQueue();

  const task = new Task({ name: 'Task' });
  queue.enqueue(task);

  task.complete({ result: 'ok' });

  const completed = queue.getCompleted();
  assertEqual(completed.length, 1);
});

test('TaskQueue 应该获取失败的任务', () => {
  const queue = new TaskQueue();

  const task = new Task({ name: 'Task', retries: 0 });
  queue.enqueue(task);

  // 从队列出队并开始执行
  const dequeued = queue.dequeue();
  dequeued.start();
  dequeued.fail(new Error('Failed'));

  const failed = queue.getFailed();
  assertEqual(failed.length, 1);
});

test('TaskQueue 应该统计任务', () => {
  const queue = new TaskQueue();

  const task1 = new Task({ name: 'Task 1' });
  const task2 = new Task({ name: 'Task 2', retries: 0 });

  queue.enqueue(task1);
  queue.enqueue(task2);

  // 完成第一个任务
  const dequeued1 = queue.dequeue();
  dequeued1.start();
  dequeued1.complete();

  // 失败第二个任务
  const dequeued2 = queue.dequeue();
  dequeued2.start();
  dequeued2.fail(new Error('Failed'));

  const stats = queue.getStats();

  assertEqual(stats.total, 2);
  assertEqual(stats.completed, 1);
  assertEqual(stats.failed, 1);
});

test('TaskQueue 应该清空队列', () => {
  const queue = new TaskQueue();

  queue.enqueue(new Task({ name: 'Task 1' }));
  queue.enqueue(new Task({ name: 'Task 2' }));

  assertEqual(queue.size(), 2);

  queue.clear();
  assertEqual(queue.size(), 0);
});

test('TaskQueue 应该取消任务', () => {
  const queue = new TaskQueue();

  const task = new Task({ name: 'Task' });
  queue.enqueue(task);

  queue.cancel(task.id);
  assertEqual(task.status, 'cancelled');
});

// ===== Agent 测试 =====

test('Agent 应该创建实例', () => {
  const agent = new Agent({ name: 'TestAgent' });

  assert(agent instanceof Agent);
  assertEqual(agent.name, 'TestAgent');
  assertEqual(agent.state, 'idle');
});

test('Agent 应该注册和获取 Hub', () => {
  const agent = new Agent();

  const mockHub = { name: 'mock' };
  agent.registerHub('test', mockHub);

  const retrieved = agent.getHub('test');
  assertEqual(retrieved.name, 'mock');
});

test('Agent 应该获取所有已注册的 Hub', () => {
  const agent = new Agent();

  agent.registerHub('hub1', { name: 'hub1' });
  agent.registerHub('hub2', { name: 'hub2' });

  const hubs = agent.getAllHubs();
  assertEqual(hubs.length, 2);
});

test('Agent 应该添加任务', () => {
  const agent = new Agent();

  const taskId = agent.addTask({
    name: 'Test Task',
    type: 'action'
  });

  assert(taskId);
  assertEqual(agent.stats.totalTasks, 1);
});

test('Agent 应该批量添加任务', () => {
  const agent = new Agent();

  const ids = agent.addTasks([
    { name: 'Task 1', type: 'action' },
    { name: 'Task 2', type: 'action' },
    { name: 'Task 3', type: 'action' }
  ]);

  assertEqual(ids.length, 3);
  assertEqual(agent.stats.totalTasks, 3);
});

test('Agent 应该执行自定义处理器任务', async () => {
  const agent = new Agent();

  const taskId = agent.addTask({
    name: 'Custom Handler',
    handler: async (params) => {
      return { result: 'custom result', param: params.value };
    },
    params: { value: 42 }
  });

  const task = agent.queue.getTask(taskId);
  const result = await agent.executeTask(task);

  assertEqual(result.result, 'custom result');
  assertEqual(result.param, 42);
});

test('Agent 应该支持事件监听', async () => {
  const agent = new Agent();

  let eventFired = false;
  agent.on('task:added', (data) => {
    eventFired = true;
  });

  agent.addTask({ name: 'Test' });

  assert(eventFired);
});

test('Agent 应该获取队列信息', () => {
  const agent = new Agent();

  agent.addTask({ name: 'Task 1' });
  agent.addTask({ name: 'Task 2' });

  const info = agent.getQueueInfo();

  assert(info.queueSize > 0);
  assert(info.stats);
});

test('Agent 应该获取统计信息', () => {
  const agent = new Agent();

  agent.addTask({ name: 'Task 1' });
  agent.addTask({ name: 'Task 2' });

  const stats = agent.getStats();

  assertEqual(stats.totalTasks, 2);
  assertEqual(stats.completedTasks, 0);
});

test('Agent 应该获取信息快照', () => {
  const agent = new Agent({ name: 'TestAgent' });

  agent.registerHub('test', {});
  agent.addTask({ name: 'Task 1' });

  const info = agent.getInfo();

  assertEqual(info.name, 'TestAgent');
  assert(info.hubs.includes('test'));
  assert(info.stats);
});

test('Agent 应该清空队列', () => {
  const agent = new Agent();

  agent.addTask({ name: 'Task 1' });
  agent.addTask({ name: 'Task 2' });

  assert(agent.getQueueInfo().queueSize > 0);

  agent.clear();

  assertEqual(agent.getQueueInfo().queueSize, 0);
});

test('Agent 应该重置统计信息', () => {
  const agent = new Agent();

  agent.stats.completedTasks = 10;
  agent.stats.failedTasks = 5;

  agent.resetStats();

  assertEqual(agent.stats.completedTasks, 0);
  assertEqual(agent.stats.failedTasks, 0);
});

test('Agent 应该支持暂停和继续', () => {
  const agent = new Agent();

  agent.pause();
  assertEqual(agent.state, 'paused');

  agent.resume();
  assertEqual(agent.state, 'running');
});

test('Agent 应该处理任务超时', async () => {
  const agent = new Agent();

  const taskId = agent.addTask({
    name: 'Slow Task',
    timeout: 100,
    handler: async () => {
      return new Promise(resolve => setTimeout(resolve, 1000));
    }
  });

  const task = agent.queue.getTask(taskId);
  try {
    await agent.executeTask(task);
    assert(false, 'Should have timed out');
  } catch (error) {
    assert(error.message.includes('timeout'));
  }
});

test('Agent 应该处理任务失败和重试', async () => {
  const agent = new Agent();

  let attempts = 0;
  const taskId = agent.addTask({
    name: 'Failing Task',
    retries: 2,
    handler: async () => {
      attempts++;
      throw new Error('Intentional failure');
    }
  });

  const task = agent.queue.getTask(taskId);

  // 第一次执行
  try {
    await agent.executeTask(task);
  } catch (error) {
    // 预期失败
  }

  assertEqual(attempts, 1);
  assert(task.shouldRetry());
});

// ===== 运行测试 =====

console.log('🧪 Agent 单元测试\n');

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
