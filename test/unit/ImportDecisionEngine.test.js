/**
 * ImportDecisionEngine 单元测试
 */

const ImportDecisionEngine = require('../../lib/injection/ImportDecisionEngine');

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

// ===== Tests =====

test('默认无结果时应继续', () => {
  const engine = new ImportDecisionEngine();
  const decision = engine.evaluate({ ensureResult: null });
  assertEqual(decision.action, 'continue');
});

test('ensureResult.ok 为 true 时应继续', () => {
  const engine = new ImportDecisionEngine();
  const decision = engine.evaluate({ ensureResult: { ok: true } });
  assertEqual(decision.action, 'continue');
});

test('cycleBlocked 应被阻断', () => {
  const engine = new ImportDecisionEngine();
  const decision = engine.evaluate({
  ensureResult: { ok: false, reason: 'cycleBlocked' },
  fromTarget: 'A',
  toTarget: 'B'
  });
  assertEqual(decision.action, 'block');
  assertEqual(decision.reason, 'cycleBlocked');
});

test('downwardDependency 应被阻断', () => {
  const engine = new ImportDecisionEngine();
  const decision = engine.evaluate({
  ensureResult: { ok: false, reason: 'downwardDependency' },
  fromTarget: 'Core',
  toTarget: 'Feature'
  });
  assertEqual(decision.action, 'block');
  assertEqual(decision.reason, 'downwardDependency');
});

test('缺失依赖应进入 review', () => {
  const engine = new ImportDecisionEngine();
  const decision = engine.evaluate({
  ensureResult: {
    ok: false,
    reason: 'missingDependency',
    allowActions: ['insertAnyway', 'suggestPatch']
  },
  fromTarget: 'A',
  toTarget: 'B'
  });
  assertEqual(decision.action, 'review');
  assert(Array.isArray(decision.allowActions));
});

// ===== 运行测试 =====

console.log('🧪 ImportDecisionEngine 单元测试\n');

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
