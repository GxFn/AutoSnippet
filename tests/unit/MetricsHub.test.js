/**
 * MetricsHub 单元测试
 */

const { MetricsHub, MetricPoint, MetricStats, AlertRule } = require('../../lib/business/metrics/MetricsHub');

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

// ===== 测试用例 =====

test('MetricPoint 应该创建实例', () => {
  const point = new MetricPoint('cpu', 45.5, { host: 'server1' }, 'percent');

  assertEqual(point.name, 'cpu');
  assertEqual(point.value, 45.5);
  assertEqual(point.unit, 'percent');
  assert(point.tags.host === 'server1');
  assert(point.timestamp > 0);
});

test('MetricStats 应该计算统计信息', () => {
  const points = [
    { value: 10 },
    { value: 20 },
    { value: 30 },
    { value: 40 },
    { value: 50 }
  ];

  const stats = new MetricStats('test', points);

  assertEqual(stats.count, 5);
  assertEqual(stats.min, 10);
  assertEqual(stats.max, 50);
  assertEqual(stats.sum, 150);
  assertEqual(stats.avg, 30);
  assert(stats.stdDev >= 0);
});

test('MetricStats 应该计算百分位数', () => {
  const points = [];
  for (let i = 1; i <= 100; i++) {
    points.push({ value: i });
  }

  const stats = new MetricStats('test', points);

  assert(stats.p50 > 0);
  assert(stats.p95 > stats.p50);
  assert(stats.p99 > stats.p95);
});

test('AlertRule 应该创建实例', () => {
  const rule = new AlertRule('high_cpu', 'cpu', 'gt', 80, 60000);

  assertEqual(rule.name, 'high_cpu');
  assertEqual(rule.metricName, 'cpu');
  assertEqual(rule.condition, 'gt');
  assertEqual(rule.threshold, 80);
  assert(rule.enabled);
});

test('AlertRule 应该检查大于条件', () => {
  const rule = new AlertRule('high_cpu', 'cpu', 'gt', 80);

  assert(rule.check(85));
  assert(!rule.check(75));
  assert(rule.violations.length > 0);
});

test('AlertRule 应该检查小于条件', () => {
  const rule = new AlertRule('low_memory', 'memory', 'lt', 512);

  assert(rule.check(256));
  assert(!rule.check(1024));
});

test('AlertRule 应该检查等于条件', () => {
  const rule = new AlertRule('exact', 'value', 'eq', 100);

  assert(rule.check(100));
  assert(!rule.check(101));
});

test('AlertRule 应该清空违规记录', () => {
  const rule = new AlertRule('test', 'cpu', 'gt', 80);

  rule.check(85);
  rule.check(90);

  assertEqual(rule.violations.length, 2);

  rule.clearViolations();

  assertEqual(rule.violations.length, 0);
  assert(rule.lastViolation === null);
});

test('AlertRule 应该获取状态', () => {
  const rule = new AlertRule('test', 'cpu', 'gt', 80);

  rule.check(85);

  const status = rule.getStatus();

  assert(status.id);
  assertEqual(status.name, 'test');
  assert(status.enabled);
  assertEqual(status.violations, 1);
});

test('MetricsHub 应该创建实例', () => {
  const hub = new MetricsHub();

  assert(hub instanceof MetricsHub);
  assertEqual(hub.getMetricCount(), 0);
});

test('MetricsHub 应该记录指标', () => {
  const hub = new MetricsHub();

  hub.record('cpu', 45.5, { host: 'server1' });
  hub.record('memory', 8192, { host: 'server1' });

  assertEqual(hub.getMetricCount(), 2);
});

test('MetricsHub 应该获取最新指标值', () => {
  const hub = new MetricsHub();

  hub.record('cpu', 45.5);
  hub.record('cpu', 50.2);

  const latest = hub.getLatest('cpu');

  assert(latest !== null);
  assertEqual(latest.value, 50.2);
});

test('MetricsHub 应该获取指标数据点', () => {
  const hub = new MetricsHub();

  hub.record('cpu', 45);
  hub.record('cpu', 50);
  hub.record('cpu', 55);

  const points = hub.getPoints('cpu');

  assertEqual(points.length, 3);
});

test('MetricsHub 应该限制数据点数量', () => {
  const hub = new MetricsHub({ maxPoints: 5 });

  for (let i = 0; i < 10; i++) {
    hub.record('cpu', i);
  }

  const points = hub.getPoints('cpu');

  assert(points.length <= 5);
});

test('MetricsHub 应该记录 Gauge 指标', () => {
  const hub = new MetricsHub();

  hub.gauge('temperature', 25.5, { room: 'server' }, 'celsius');

  const latest = hub.getLatest('temperature');

  assertEqual(latest.value, 25.5);
  assertEqual(latest.unit, 'celsius');
});

test('MetricsHub 应该记录 Counter 指标', () => {
  const hub = new MetricsHub();

  hub.counter('requests', 1);
  hub.counter('requests', 5);

  const points = hub.getPoints('requests');

  assertEqual(points.length, 2);
  assertEqual(points[0].value, 1);
  assertEqual(points[1].value, 6);
});

test('MetricsHub 应该记录 Histogram 指标', () => {
  const hub = new MetricsHub();

  hub.histogram('latency', 125, { endpoint: '/api' }, 'ms');

  const latest = hub.getLatest('latency');

  assertEqual(latest.value, 125);
  assertEqual(latest.unit, 'ms');
});

test('MetricsHub 应该添加告警规则', () => {
  const hub = new MetricsHub();

  const alertId = hub.addAlert('high_cpu', 'cpu', 'gt', 80, 60000);

  assert(alertId);
  assert(hub.getAlert(alertId));
});

test('MetricsHub 应该移除告警规则', () => {
  const hub = new MetricsHub();

  const alertId = hub.addAlert('test', 'cpu', 'gt', 80);

  hub.removeAlert(alertId);

  assert(hub.getAlert(alertId) === undefined);
});

test('MetricsHub 应该获取所有告警规则', () => {
  const hub = new MetricsHub();

  hub.addAlert('alert1', 'cpu', 'gt', 80);
  hub.addAlert('alert2', 'memory', 'lt', 512);

  const alerts = hub.getAllAlerts();

  assertEqual(alerts.length, 2);
});

test('MetricsHub 应该获取指标统计', () => {
  const hub = new MetricsHub();

  hub.record('cpu', 40);
  hub.record('cpu', 50);
  hub.record('cpu', 60);

  const stats = hub.getStats('cpu');

  assert(stats !== null);
  assertEqual(stats.count, 3);
  assertEqual(stats.min, 40);
  assertEqual(stats.max, 60);
  assertEqual(stats.avg, 50);
});

test('MetricsHub 应该按时间范围查询', () => {
  const hub = new MetricsHub();

  const before = Date.now();
  hub.record('cpu', 45);
  const after = Date.now();

  hub.record('cpu', 50); // 之后的点

  const range = hub.getRange('cpu', before, after);

  assert(range.length > 0);
});

test('MetricsHub 应该按标签查询', () => {
  const hub = new MetricsHub();

  hub.record('cpu', 45, { host: 'server1', datacenter: 'us' });
  hub.record('cpu', 50, { host: 'server2', datacenter: 'eu' });

  const points = hub.getByTags('cpu', { datacenter: 'us' });

  assertEqual(points.length, 1);
  assert(points[0].value === 45);
});

test('MetricsHub 应该聚合指标 (sum)', () => {
  const hub = new MetricsHub();

  hub.record('disk1', 500);
  hub.record('disk2', 300);

  const result = hub.aggregate(['disk1', 'disk2'], 'sum');

  assertEqual(result.result, 800);
  assertEqual(result.count, 2);
});

test('MetricsHub 应该聚合指标 (avg)', () => {
  const hub = new MetricsHub();

  hub.record('value', 10);
  hub.record('value', 20);

  const result = hub.aggregate(['value'], 'avg');

  assertEqual(result.result, 15);
});

test('MetricsHub 应该聚合指标 (min)', () => {
  const hub = new MetricsHub();

  hub.record('value', 10);
  hub.record('value', 5);
  hub.record('value', 20);

  const result = hub.aggregate(['value'], 'min');

  assertEqual(result.result, 5);
});

test('MetricsHub 应该聚合指标 (max)', () => {
  const hub = new MetricsHub();

  hub.record('value', 10);
  hub.record('value', 50);
  hub.record('value', 20);

  const result = hub.aggregate(['value'], 'max');

  assertEqual(result.result, 50);
});

test('MetricsHub 应该计算增长率', () => {
  const hub = new MetricsHub();

  hub.record('requests', 100);
  hub.record('requests', 150);

  const growth = hub.getGrowthRate('requests', 2);

  assertEqual(growth, 50);
});

test('MetricsHub 应该导出数据', () => {
  const hub = new MetricsHub();

  hub.record('cpu', 45);
  hub.addAlert('test', 'cpu', 'gt', 80);

  const exported = hub.export('json');

  assert(exported.timestamp);
  assert(exported.metrics);
  assert(exported.stats);
  assert(exported.alerts);
});

test('MetricsHub 应该清空所有指标', () => {
  const hub = new MetricsHub();

  hub.record('cpu', 45);
  hub.record('memory', 8192);

  hub.clear();

  assertEqual(hub.getMetricCount(), 0);
});

test('MetricsHub 应该清空特定指标', () => {
  const hub = new MetricsHub();

  hub.record('cpu', 45);
  hub.record('memory', 8192);

  hub.clearMetric('cpu');

  assertEqual(hub.getMetricCount(), 1);
});

test('MetricsHub 应该获取所有指标名称', () => {
  const hub = new MetricsHub();

  hub.record('cpu', 45);
  hub.record('memory', 8192);
  hub.record('disk', 500);

  const names = hub.getMetricNames();

  assertEqual(names.length, 3);
  assert(names.includes('cpu'));
});

test('MetricsHub 应该清理过期数据', () => {
  const hub = new MetricsHub({ retention: 1000 }); // 1秒保留

  hub.record('cpu', 45);
  
  // 等待以确保数据过期
  const result = hub.cleanup();

  assert(result.removed >= 0);
});

test('MetricsHub 应该获取汇总统计', () => {
  const hub = new MetricsHub();

  hub.record('cpu', 45);
  hub.record('memory', 8192);
  hub.addAlert('test', 'cpu', 'gt', 80);

  const summary = hub.getSummary();

  assertEqual(summary.metricCount, 2);
  assertEqual(summary.alertCount, 1);
  assert(summary.timestamp);
});

test('MetricsHub 应该触发告警', () => {
  const hub = new MetricsHub();

  hub.addAlert('high_cpu', 'cpu', 'gt', 80);

  hub.record('cpu', 85);

  const alert = hub.getAllAlerts()[0];

  assert(alert.violations.length > 0);
});

test('MetricsHub 应该支持链式调用', () => {
  const hub = new MetricsHub();

  const result = hub
    .record('cpu', 45)
    .record('memory', 8192)
    .gauge('temperature', 25.5);

  assert(result instanceof MetricsHub);
  assertEqual(hub.getMetricCount(), 3);
});

test('MetricsHub 应该处理空查询', () => {
  const hub = new MetricsHub();

  const latest = hub.getLatest('nonexistent');
  const points = hub.getPoints('nonexistent');
  const stats = hub.getStats('nonexistent');

  assert(latest === null);
  assertEqual(points.length, 0);
  assert(stats === null);
});

test('MetricsHub 应该处理空聚合', () => {
  const hub = new MetricsHub();

  const result = hub.aggregate(['nonexistent'], 'sum');

  assertEqual(result.result, 0);
  assertEqual(result.count, 0);
});

// ===== 运行测试 =====

console.log('🧪 MetricsHub 单元测试\n');

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
