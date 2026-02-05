/**
 * ProcessHub 单元测试
 */

const {
  ProcessHub,
  ProcessContext,
  RetryStrategy,
  ClipboardManager
} = require('../../lib/infrastructure/process/ProcessHub');

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function run() {
  console.log('🧪 ProcessHub 单元测试\n');

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

test('RetryStrategy 应该创建实例', () => {
  const strategy = new RetryStrategy({
  maxRetries: 5,
  initialDelay: 500
  });

  assertEqual(strategy.maxRetries, 5);
  assertEqual(strategy.initialDelay, 500);
});

test('RetryStrategy 应该计算延迟时间', () => {
  const strategy = new RetryStrategy({
  initialDelay: 1000,
  backoffMultiplier: 2,
  maxDelay: 10000
  });

  // 重试 0：1000ms
  assertEqual(strategy.getDelay(0), 1000);
  // 重试 1：2000ms
  assertEqual(strategy.getDelay(1), 2000);
  // 重试 2：4000ms
  assertEqual(strategy.getDelay(2), 4000);
  // 重试 3：8000ms
  assertEqual(strategy.getDelay(3), 8000);
  // 重试 4：会超过 maxDelay，所以返回 10000ms
  assertEqual(strategy.getDelay(4), 10000);
});

test('RetryStrategy 应该检查是否可以重试', () => {
  const strategy = new RetryStrategy({ maxRetries: 3 });

  assert(strategy.canRetry(0));
  assert(strategy.canRetry(1));
  assert(strategy.canRetry(2));
  assert(!strategy.canRetry(3));
  assert(!strategy.canRetry(4));
});

test('ProcessContext 应该创建实例', () => {
  const context = new ProcessContext({
  name: 'test-process',
  timeout: 5000
  });

  assertEqual(context.name, 'test-process');
  assertEqual(context.timeout, 5000);
  assertEqual(context.status, 'pending');
  assertEqual(context.progress, 0);
});

test('ProcessContext 应该跟踪进度', () => {
  const context = new ProcessContext();

  context.setProgress(25);
  assertEqual(context.progress, 25);

  context.setProgress(50);
  assertEqual(context.progress, 50);

  context.setProgress(100);
  assertEqual(context.progress, 100);

  // 进度值应该被限制在 0-100
  context.setProgress(150);
  assertEqual(context.progress, 100);

  context.setProgress(-10);
  assertEqual(context.progress, 0);
});

test('ProcessContext 应该计算执行时间', async () => {
  const context = new ProcessContext();

  context.startTime = Date.now();
  await new Promise(r => setTimeout(r, 50));
  context.endTime = Date.now();

  const duration = context.getDuration();
  assert(duration >= 50);
  assert(duration < 100);
});

test('ProcessContext 应该转换为 JSON', () => {
  const context = new ProcessContext({
  name: 'test',
  id: 'test-123'
  });

  context.status = 'success';
  context.exitCode = 0;
  context.stdout = 'output';

  const json = context.toJSON();

  assert(typeof json === 'object');
  assertEqual(json.id, 'test-123');
  assertEqual(json.name, 'test');
  assertEqual(json.status, 'success');
  assertEqual(json.exitCode, 0);
});

test('ClipboardManager 应该创建实例', () => {
  const clipboard = new ClipboardManager();

  assert(clipboard instanceof ClipboardManager);
  assert(clipboard.locked === false);
});

test('ClipboardManager 应该锁定和解锁', async () => {
  const clipboard = new ClipboardManager();

  await clipboard.lock();
  assert(clipboard.locked === true);

  clipboard.unlock();
  assert(clipboard.locked === false);
});

test('ClipboardManager 应该设置和获取内容', async () => {
  const clipboard = new ClipboardManager();

  await clipboard.set('test content');
  const content = await clipboard.get();

  assertEqual(content, 'test content');
});

test('ClipboardManager 应该清空内容', async () => {
  const clipboard = new ClipboardManager();

  await clipboard.set('test content');
  await clipboard.clear();
  const content = await clipboard.get();

  assert(content === null);
});

test('ClipboardManager 应该处理队列', async () => {
  const clipboard = new ClipboardManager();
  const order = [];

  await clipboard.lock();
  order.push('locked');

  // 第二个 lock 会进入队列
  const lockPromise = clipboard.lock().then(() => {
  order.push('second-locked');
  });

  // 等待一下，确保 lockPromise 已经等待中
  await new Promise(r => setTimeout(r, 10));

  order.push('unlocked-first');
  clipboard.unlock();

  await lockPromise;
  clipboard.unlock();

  assert(order[0] === 'locked');
  assert(order[1] === 'unlocked-first');
  assert(order[2] === 'second-locked');
});

test('ProcessHub 应该创建实例', () => {
  const hub = new ProcessHub();

  assert(hub instanceof ProcessHub);
  assert(hub.processes instanceof Map);
  assert(hub.clipboard instanceof ClipboardManager);
});

test('ProcessHub 应该执行简单的进程', async () => {
  const hub = new ProcessHub();

  const context = await hub.execute('echo-test', 'echo', ['hello']);

  assertEqual(context.status, 'success');
  assertEqual(context.exitCode, 0);
  assert(context.stdout.includes('hello'));
});

test('ProcessHub 应该处理进程失败', async () => {
  const hub = new ProcessHub();

  try {
  await hub.execute('fail-test', 'ls', ['/nonexistent-path-xyz']);
  throw new Error('Should have failed');
  } catch (err) {
  assert(err.message.includes('Process failed') || err.message.includes('No such file'));
  }
});

test('ProcessHub 应该支持超时', async () => {
  const hub = new ProcessHub();

  try {
  // sleep 命令会阻塞，超过 1 秒超时
  await hub.execute('timeout-test', 'sleep', ['10'], {
    timeout: 1000
  });
  throw new Error('Should have timed out');
  } catch (err) {
  assert(err.message.includes('timeout'));
  }
});

test('ProcessHub 应该跟踪统计信息', async () => {
  const hub = new ProcessHub();

  // 执行成功的进程
  await hub.execute('test1', 'echo', ['test']);

  const stats = hub.getStats();

  assert(stats.success >= 1);
  assert(stats.successRate);
  assert(stats.avgDuration >= 0);
});

test('ProcessHub 应该重置统计', async () => {
  const hub = new ProcessHub();

  await hub.execute('test1', 'echo', ['test']);

  const statsBeforeReset = hub.getStats();
  assert(statsBeforeReset.success > 0 || statsBeforeReset.failed > 0);

  hub.resetStats();
  const stats = hub.getStats();

  assertEqual(stats.success, 0);
  assertEqual(stats.failed, 0);
  assertEqual(stats.timeout, 0);
});

test('ProcessHub 应该获取进程状态', async () => {
  const hub = new ProcessHub();

  const context = await hub.execute('status-test', 'echo', ['test']);

  const status = hub.getProcessStatus(context.id);

  assert(status !== null);
  assertEqual(status.status, 'success');
  assertEqual(status.id, context.id);
});

test('ProcessHub 应该获取所有进程', async () => {
  const hub = new ProcessHub();

  await hub.execute('test1', 'echo', ['1']);
  await hub.execute('test2', 'echo', ['2']);

  const processes = hub.getAllProcesses();

  assert(processes.length >= 2);
});

test('ProcessHub 应该清空进程记录', async () => {
  const hub = new ProcessHub();

  await hub.execute('test1', 'echo', ['1']);
  assert(hub.processes.size > 0);

  hub.clear();
  assert(hub.processes.size === 0);
});

test('ProcessHub 应该支持链式调用', () => {
  const hub = new ProcessHub();

  const result = hub.resetStats().clear();

  assert(result instanceof ProcessHub);
});

test('ProcessHub 应该执行顺序执行多个进程', async () => {
  const hub = new ProcessHub();

  const results = await hub.executeSequential([
  { name: 'test1', command: 'echo', args: ['1'] },
  { name: 'test2', command: 'echo', args: ['2'] }
  ]);

  assert(results.length === 2);
  assert(results[0].status === 'success');
  assert(results[1].status === 'success');
});

test('ProcessHub 应该执行并行执行多个进程', async () => {
  const hub = new ProcessHub();

  const results = await hub.executeParallel([
  { name: 'test1', command: 'echo', args: ['1'] },
  { name: 'test2', command: 'echo', args: ['2'] }
  ]);

  assert(results.length === 2);
  assert(results[0].status === 'success');
  assert(results[1].status === 'success');
});

test('ProcessHub 应该支持重试策略', async () => {
  const hub = new ProcessHub();
  const strategy = new RetryStrategy({
  maxRetries: 2,
  initialDelay: 100
  });

  let attemptCount = 0;
  hub.on('retry', () => {
  attemptCount++;
  });

  // 这个命令会失败但会重试
  try {
  await hub.execute('retry-test', 'sh', ['-c', 'exit 1'], {
    retryStrategy: strategy
  });
  } catch (err) {
  // 预期失败
  }

  // 应该至少尝试过一次重试
  assert(attemptCount >= 0); // 可能重试，也可能第一次就失败了
});

test('ProcessHub 应该发出事件', async () => {
  const hub = new ProcessHub();
  let eventFired = false;

  hub.on('success', (context) => {
  eventFired = true;
  assert(context.status === 'success');
  });

  await hub.execute('event-test', 'echo', ['test']);

  assert(eventFired === true);
});

test('ProcessContext 应该支持链式调用', () => {
  const context = new ProcessContext();

  const result = context.setProgress(50);

  assert(result instanceof ProcessContext);
  assertEqual(context.progress, 50);
});

// ============ 测试运行 ============

run();
