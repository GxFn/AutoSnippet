/**
 * LogFactory 单元测试
 * 
 * 运行：node tests/unit/LogFactory.test.js
 */

const { LogFactory, Logger } = require('../../lib/infrastructure/logging/LogFactory');

class TestRunner {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  test(name, fn) {
    this.tests.push({ name, fn });
  }

  assert(condition, message) {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  async run() {
    console.log('\n🧪 LogFactory 单元测试\n');

    for (const test of this.tests) {
      try {
        await test.fn(this.assert.bind(this));
        console.log(`✅ ${test.name}`);
        this.passed++;
      } catch (err) {
        console.log(`❌ ${test.name}`);
        console.log(`   ${err.message}`);
        this.failed++;
      }
    }

    console.log(`\n📊 结果: ${this.passed} 通过, ${this.failed} 失败\n`);
    return this.failed === 0;
  }
}

// ========== 测试用例 ==========

const runner = new TestRunner();

// Test 1: LogFactory 创建
runner.test('LogFactory 应该创建 Logger 实例', (assert) => {
  const factory = new LogFactory();
  const logger = factory.createLogger('test-logger');
  assert(logger instanceof Logger, 'logger 应该是 Logger 实例');
  assert(logger.name === 'test-logger', 'logger 名字应该正确');
});

// Test 2: 日志上下文
runner.test('Logger 应该支持上下文设置', (assert) => {
  const logger = new Logger('test');
  logger.setContext('userId', 'user123');
  logger.setContext('traceId', 'trace456');
  
  assert(logger.context.userId === 'user123', 'userId 应该被设置');
  assert(logger.context.traceId === 'trace456', 'traceId 应该被设置');
});

// Test 3: 上下文清空
runner.test('Logger 应该支持清空上下文', (assert) => {
  const logger = new Logger('test');
  logger.setContext('key', 'value');
  logger.clearContext();
  
  assert(Object.keys(logger.context).length === 0, '上下文应该被清空');
});

// Test 4: 日志级别
runner.test('Logger 应该支持不同日志级别', (assert) => {
  const logger = new Logger('test', { level: 'warn' });
  assert(logger.level === 'warn', '日志级别应该正确设置');
});

// Test 5: 性能计时
runner.test('Logger 应该支持性能计时', (assert) => {
  const logger = new Logger('test');
  const timer = logger.startTimer('test-operation');
  
  // 模拟延迟
  const start = Date.now();
  while (Date.now() - start < 10) {}
  
  const duration = timer.end();
  assert(duration >= 10, '计时应该准确（至少 10ms）');
  assert(duration < 100, '计时不应该太长（少于 100ms）');
});

// Test 6: Logger 缓存
runner.test('LogFactory 应该缓存 Logger 实例', (assert) => {
  const factory = new LogFactory();
  const logger1 = factory.createLogger('cached');
  const logger2 = factory.createLogger('cached');
  
  assert(logger1 === logger2, '相同名字的 Logger 应该返回同一实例');
});

// Test 7: 多个 Logger 实例
runner.test('LogFactory 应该管理多个 Logger 实例', (assert) => {
  const factory = new LogFactory();
  factory.createLogger('logger1');
  factory.createLogger('logger2');
  factory.createLogger('logger3');
  
  const loggers = factory.getLoggers();
  assert(loggers.length === 3, '应该有 3 个 Logger 实例');
});

// Test 8: Logger 清空
runner.test('LogFactory 应该支持清空所有 Logger', (assert) => {
  const factory = new LogFactory();
  factory.createLogger('test1');
  factory.createLogger('test2');
  factory.clear();
  
  const loggers = factory.getLoggers();
  assert(loggers.length === 0, '清空后不应该有任何 Logger');
});

// Test 9: 默认选项
runner.test('LogFactory 应该使用默认选项', (assert) => {
  const factory = new LogFactory();
  const logger = factory.createLogger('test');
  
  assert(logger.enableTimer === true, '默认应该启用计时');
  assert(logger.enableMemoryStats === true, '默认应该启用内存统计');
});

// Test 10: 自定义选项覆盖
runner.test('Logger 选项应该能覆盖 factory 默认选项', (assert) => {
  const factory = new LogFactory({ level: 'debug' });
  const logger = factory.createLogger('test', { level: 'error' });
  
  assert(logger.level === 'error', 'Logger 选项应该覆盖 factory 选项');
});

// 运行所有测试
runner.run().then(success => {
  process.exit(success ? 0 : 1);
});
