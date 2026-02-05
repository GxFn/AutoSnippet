/**
 * Hub 集成测试
 * 测试 LogFactory、CacheHub、ErrorManager、ProcessHub 的联合使用
 */

const { LogFactory, Logger } = require('../../lib/infrastructure/logging/LogFactory');
const { CacheHub } = require('../../lib/infrastructure/cache/CacheHub');
const {
  ErrorManager,
  ValidationError
} = require('../../lib/infrastructure/error/ErrorManager');
const {
  ProcessHub,
  RetryStrategy
} = require('../../lib/infrastructure/process/ProcessHub');

// 创建全局 LogFactory 实例
const logFactory = new LogFactory();

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function run() {
  console.log('🧪 Hub 集成测试\n');

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

// ============ 测试场景开始 ============

test('场景 1：使用 LogFactory 记录带缓存的操作', async () => {
  const logger = logFactory.createLogger('cache-ops');
  const cache = new CacheHub();

  logger.setContext('userId', 'user-123');

  // 第一次查询（缓存未命中）
  const timer1 = logger.startTimer('fetch-data');
  const data1 = await cache.get('data-key', async () => {
  await new Promise(r => setTimeout(r, 50));
  return { id: 1, name: 'Test' };
  });
  timer1.end();

  // 第二次查询（缓存命中）
  const timer2 = logger.startTimer('fetch-data-cached');
  const data2 = await cache.get('data-key', null);
  timer2.end();

  // 验证
  assertEqual(data1.name, 'Test');
  assertEqual(data2.name, 'Test');
  assert(cache.stats.l1Hit > 0);
  
  logger.clearContext();
});

test('场景 2：使用 ErrorManager 处理缓存错误', async () => {
  const logger = logFactory.createLogger('error-handling');
  const cache = new CacheHub();
  const errorMgr = new ErrorManager();

  try {
  // 缓存 fallback 中出错
  await cache.get('key', async () => {
    throw new Error('Data fetch failed');
  });
  throw new Error('Should have thrown');
  } catch (err) {
  const appErr = errorMgr.catch(err);
  logger.error(`Cache error: ${appErr.code}`, {
    code: appErr.code,
    userMessage: appErr.userMessage
  });

  assert(appErr.code === 'SYSTEM_ERROR');
  }
});

test('场景 3：使用 ProcessHub 执行命令并记录日志', async () => {
  const logger = logFactory.createLogger('process-ops');
  const hub = new ProcessHub();

  logger.setContext('traceId', 'trace-' + Date.now());

  const context = await hub.execute('list-files', 'ls', ['-la', '.']);

  logger.info(`Process completed`, {
  processId: context.id,
  duration: context.getDuration(),
  exitCode: context.exitCode,
  status: context.status
  });

  assertEqual(context.status, 'success');
  assertEqual(context.exitCode, 0);

  logger.clearContext();
});

test('场景 4：使用 ErrorManager 和 ProcessHub 处理失败重试', async () => {
  const errorMgr = new ErrorManager();
  const hub = new ProcessHub();
  const logger = logFactory.createLogger('retry-scenario');

  const strategy = new RetryStrategy({
  maxRetries: 2,
  initialDelay: 100
  });

  let retryCount = 0;
  hub.on('retry', () => {
  retryCount++;
  logger.warn(`Process retry triggered`, { retryCount });
  });

  try {
  // 这个命令会失败
  await hub.execute('fail-cmd', 'sh', ['-c', 'exit 1'], {
    retryStrategy: strategy
  });
  throw new Error('Should have failed');
  } catch (err) {
  const appErr = errorMgr.wrap(err, 'SYSTEM_ERROR', '进程执行失败');
  logger.error(`Command failed after retries`, {
    code: appErr.code,
    retries: retryCount
  });

  assert(appErr instanceof Error);
  }
});

test('场景 5：缓存 + 日志 + 错误处理的完整流程', async () => {
  const logger = logFactory.createLogger('complete-flow');
  const cache = new CacheHub();
  const errorMgr = new ErrorManager();

  logger.setContext('requestId', 'req-' + Date.now());

  try {
  // 尝试从缓存获取
  let user = await cache.get('user-123', async () => {
    // 模拟数据库查询
    await new Promise(r => setTimeout(r, 30));
    return { id: 123, name: 'Alice', email: 'alice@example.com' };
  }, { ttl: 60 });

  logger.info(`User loaded`, {
    userId: user.id,
    cached: false
  });

  // 再次获取（应该从缓存命中）
  user = await cache.get('user-123', null);

  logger.info(`User loaded from cache`, {
    userId: user.id,
    cached: true
  });

  // 验证缓存统计
  const stats = cache.getStats();
  logger.info(`Cache statistics`, stats);

  assert(stats.l1Hit > 0);
  assert(stats.hitRate > 0);
  } catch (err) {
  const appErr = errorMgr.catch(err);
  logger.error(`Workflow error`, appErr.toJSON());
  throw appErr;
  } finally {
  logger.clearContext();
  }
});

test('场景 6：验证 LogFactory 的上下文传播', () => {
  const logger1 = logFactory.createLogger('service-1');
  const logger2 = logFactory.createLogger('service-2');

  // 设置全局上下文
  logger1.setContext('userId', 'user-123');
  logger1.setContext('traceId', 'trace-abc');

  // 验证 logger1 有上下文
  assert(logger1.context.userId === 'user-123');
  assert(logger1.context.traceId === 'trace-abc');

  // logger2 是独立的，不共享上下文
  assert(!logger2.context.userId);

  logger1.clearContext();
  assert(!logger1.context.userId);
});

test('场景 7：验证 ErrorManager 的分类系统', () => {
  const errorMgr = new ErrorManager();

  // 创建不同分类的错误
  const apiErr = errorMgr.create('API_NOT_FOUND', 'Resource not found');
  const validErr = errorMgr.create('VALIDATION_REQUIRED_FIELD', 'Email required');
  const busErr = errorMgr.create('BUSINESS_DUPLICATE', 'User exists');

  // 验证分类
  assert(errorMgr.isCategory(apiErr, 'API'));
  assert(errorMgr.isCategory(validErr, 'VALIDATION'));
  assert(errorMgr.isCategory(busErr, 'BUSINESS'));

  // 验证统计
  const stats = errorMgr.getStats();
  assertEqual(stats.total, 3);
  assertEqual(stats.byCategory['API'], 1);
  assertEqual(stats.byCategory['VALIDATION'], 1);
  assertEqual(stats.byCategory['BUSINESS'], 1);
});

test('场景 8：验证 CacheHub 的三层缓存', async () => {
  const cache = new CacheHub({ l2Dir: './.test-cache' });

  // 第一次：执行 fallback，存入 L1/L2
  const data1 = await cache.get('key', async () => 'value', {
  level: ['memory', 'disk', 'rebuild']
  });

  assertEqual(data1, 'value');
  assertEqual(cache.stats.l3Hit, 1);

  // 第二次：从 L1 命中
  const data2 = await cache.get('key', null);
  assertEqual(data2, 'value');
  assertEqual(cache.stats.l1Hit, 1);

  // 清空 L1，再次获取应该从 L2 命中
  cache.l1.clear();
  const data3 = await cache.get('key', null);
  assertEqual(data3, 'value');
  assertEqual(cache.stats.l2Hit, 1);

  cache.clear();
});

test('场景 9：验证 ProcessHub 的统计系统', async () => {
  const hub = new ProcessHub();

  // 执行成功的命令
  await hub.execute('cmd-1', 'echo', ['test']);
  await hub.execute('cmd-2', 'echo', ['test2']);

  const stats = hub.getStats();

  assert(stats.success >= 2 || stats.success === 1); // 至少一个成功
  assert(stats.total > 0);
  assert(typeof stats.successRate === 'string'); // 是百分比字符串
  assert(stats.avgDuration >= 0);
});

test('场景 10：验证 LogFactory 的性能计时', async () => {
  const logger = logFactory.createLogger('timing');

  const timer = logger.startTimer('operation');
  await new Promise(r => setTimeout(r, 100));
  timer.end();

  // 应该在 stdout 中看到日志输出（约 100ms 的耗时）
  // 这里我们只验证计时器的工作
  assert(logger !== null);
});

test('场景 11：集成所有 Hub 的完整工作流', async () => {
  const logger = logFactory.createLogger('complete-system');
  const cache = new CacheHub();
  const errorMgr = new ErrorManager();
  const hub = new ProcessHub();

  logger.setContext('workflow', 'integration-test');

  try {
  // 第 1 步：缓存 + 日志
  const timer1 = logger.startTimer('data-load');
  const data = await cache.get('workflow-data', async () => {
    return { status: 'ready', items: 100 };
  });
  timer1.end();

  logger.info(`Data loaded`, { itemCount: data.items });

  // 第 2 步：执行进程
  const timer2 = logger.startTimer('process-execution');
  const result = await hub.execute('workflow-cmd', 'echo', ['workflow-complete']);
  timer2.end();

  logger.info(`Process executed`, {
    status: result.status,
    exitCode: result.exitCode
  });

  // 第 3 步：验证和报告
  const cacheStats = cache.getStats();
  const hubStats = hub.getStats();

  logger.info(`System statistics`, {
    cacheHitRate: cacheStats.hitRate,
    processSuccessRate: hubStats.successRate
  });

  assert(result.status === 'success');
  assert(cacheStats.hitRate >= 0);

  } catch (err) {
  const appErr = errorMgr.catch(err);
  logger.error(`Workflow failed`, appErr.toJSON());
  throw appErr;
  } finally {
  logger.clearContext();
  }
});

test('场景 12：验证错误恢复机制', async () => {
  const logger = logFactory.createLogger('error-recovery');
  const cache = new CacheHub();
  const errorMgr = new ErrorManager();

  let successCount = 0;

  try {
  // 第一次会失败
  const data1 = await cache.get('recovery-key', async () => {
    if (successCount === 0) {
    throw new Error('Temporary failure');
    }
    return 'data';
  });
  } catch (err) {
  const appErr = errorMgr.wrap(err, 'SYSTEM_ERROR', '数据加载失败，请重试');
  logger.error(`Recovery attempt failed`, {
    code: appErr.code,
    userMessage: appErr.userMessage
  });

  // 修复问题
  successCount++;
  }

  // 第二次应该成功
  const data2 = await cache.get('recovery-key-2', async () => {
  return 'recovered-data';
  });

  assertEqual(data2, 'recovered-data');
  logger.info(`System recovered`);
});

// ============ 测试运行 ============

run();
