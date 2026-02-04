/**
 * CacheHub 单元测试
 * 测试三层缓存的所有功能
 */

const { CacheHub } = require('../../lib/infrastructure/cache/CacheHub');
const fs = require('fs');
const path = require('path');

// 简洁的测试框架
const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function run() {
  console.log('🧪 CacheHub 单元测试\n');

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

// 辅助断言
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

test('CacheHub 应该创建实例', () => {
  const cache = new CacheHub();
  assert(cache instanceof CacheHub);
  assert(cache.l1 instanceof Map);
  assert(typeof cache.get === 'function');
});

test('CacheHub 应该支持 L1 内存缓存', async () => {
  const cache = new CacheHub();
  
  // 第一次调用，执行 fallback
  const result1 = await cache.get('key1', async () => 'value1');
  assertEqual(result1, 'value1');
  assertEqual(cache.stats.l3Hit, 1);
  
  // 第二次调用，命中 L1
  const result2 = await cache.get('key1', async () => 'wrong');
  assertEqual(result2, 'value1');
  assertEqual(cache.stats.l1Hit, 1);
});

test('CacheHub 应该支持 set 方法', async () => {
  const cache = new CacheHub();
  
  cache.set('key1', 'data1');
  const result = await cache.get('key1', null);
  assertEqual(result, 'data1');
});

test('CacheHub 应该支持删除缓存', async () => {
  const cache = new CacheHub();
  
  cache.set('key1', 'data1');
  cache.delete('key1');
  const result = await cache.get('key1', async () => 'new-data');
  assertEqual(result, 'new-data');
  assertEqual(cache.stats.l3Hit, 1);
});

test('CacheHub 应该支持 TTL 过期', async () => {
  const cache = new CacheHub();
  
  // 设置 TTL = 1 秒
  cache.set('key1', 'data1', { ttl: 1 });
  
  // 立即读取，应该命中
  let result = await cache.get('key1', async () => 'new-data');
  assertEqual(result, 'data1');
  
  // 等待 1.2 秒后，缓存过期
  await new Promise(resolve => setTimeout(resolve, 1200));
  result = await cache.get('key1', async () => 'new-data');
  assertEqual(result, 'new-data');
});

test('CacheHub 应该支持清空所有缓存', async () => {
  const cache = new CacheHub();
  
  cache.set('key1', 'data1');
  cache.set('key2', 'data2');
  assertEqual(cache.l1.size, 2);
  
  cache.clear();
  assertEqual(cache.l1.size, 0);
});

test('CacheHub 应该跟踪统计信息', async () => {
  const cache = new CacheHub();
  
  // L3 命中
  await cache.get('key1', async () => 'data1');
  assertEqual(cache.stats.l3Hit, 1);
  
  // L1 命中
  await cache.get('key1', async () => 'wrong');
  assertEqual(cache.stats.l1Hit, 1);
  
  // Miss（没有 fallback）
  await cache.get('key2', null);
  assertEqual(cache.stats.miss, 1);
});

test('CacheHub 应该计算命中率', () => {
  const cache = new CacheHub();
  
  // 设置统计数据
  cache.stats.l1Hit = 8;
  cache.stats.l2Hit = 2;
  cache.stats.l3Hit = 0;
  cache.stats.miss = 0;
  
  const stats = cache.getStats();
  assertEqual(stats.hitRate, 100);
  assertEqual(stats.total, 10);
});

test('CacheHub 应该计算内存使用量', () => {
  const cache = new CacheHub();
  
  cache.set('key1', { data: 'large' });
  cache.set('key2', { data: 'small' });
  
  const memory = cache.getMemoryUsage();
  assert(memory.l1Items === 2);
  assert(memory.l1SizeBytes > 0);
});

test('CacheHub 应该支持选择缓存层级', async () => {
  const cache = new CacheHub();
  
  // 只使用 L1（内存），不使用 L2
  const result = await cache.get('key1', async () => 'data1', {
    level: ['memory', 'rebuild']
  });
  assertEqual(result, 'data1');
  
  // 验证 L1 中有数据
  assert(cache.l1.has('key1'));
  
  // 再次获取应该命中 L1
  const result2 = await cache.get('key1', async () => 'wrong');
  assertEqual(result2, 'data1');
  assertEqual(cache.stats.l1Hit, 1);
});

test('CacheHub 应该重置统计信息', () => {
  const cache = new CacheHub();
  
  cache.stats.l1Hit = 5;
  cache.stats.l3Hit = 3;
  
  cache.resetStats();
  assertEqual(cache.stats.l1Hit, 0);
  assertEqual(cache.stats.l3Hit, 0);
});

test('CacheHub 应该处理异步 fallback 函数', async () => {
  const cache = new CacheHub();
  
  const result = await cache.get('async-key', async () => {
    return new Promise(resolve => {
      setTimeout(() => resolve('async-data'), 50);
    });
  });
  
  assertEqual(result, 'async-data');
});

test('CacheHub 应该在 fallback 异常时传播错误', async () => {
  const cache = new CacheHub();
  
  try {
    await cache.get('error-key', async () => {
      throw new Error('Deliberate error');
    });
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err.message.includes('Deliberate error'));
  }
});

test('CacheHub 应该支持链式调用', () => {
  const cache = new CacheHub();
  
  const result = cache
    .set('key1', 'data1')
    .set('key2', 'data2')
    .delete('key1')
    .resetStats();
  
  assert(result instanceof CacheHub);
  assert(cache.l1.has('key2'));
  assert(!cache.l1.has('key1'));
});

// ============ 测试运行 ============

run();
