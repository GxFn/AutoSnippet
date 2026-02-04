/**
 * DepPolicyEngine 单元测试
 */

const DepPolicyEngine = require('../../lib/infrastructure/external/spm/DepPolicyEngine');

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

test('检测到循环依赖应阻断', () => {
  const engine = new DepPolicyEngine();
  const policy = engine.checkPolicy({
    fromTarget: 'A',
    toTarget: 'B',
    depGraph: {},
    analysis: { levels: {}, systemModules: [] },
    isReachable: () => true
  });

  assertEqual(policy.blocked, true);
  assertEqual(policy.reason, 'cycleBlocked');
});

test('向下依赖应阻断', () => {
  const engine = new DepPolicyEngine();
  const policy = engine.checkPolicy({
    fromTarget: 'Core',
    toTarget: 'Feature',
    depGraph: {},
    analysis: {
      levels: { Core: 1, Feature: 3 },
      systemModules: []
    },
    isReachable: () => false
  });

  assertEqual(policy.blocked, true);
  assertEqual(policy.reason, 'downwardDependency');
});

test('向上依赖不阻断', () => {
  const engine = new DepPolicyEngine();
  const policy = engine.checkPolicy({
    fromTarget: 'Feature',
    toTarget: 'Core',
    depGraph: {},
    analysis: {
      levels: { Core: 1, Feature: 3 },
      systemModules: []
    },
    isReachable: () => false
  });

  assertEqual(policy.blocked, false);
  assertEqual(policy.direction, 'upward');
});

test('同层依赖不阻断', () => {
  const engine = new DepPolicyEngine();
  const policy = engine.checkPolicy({
    fromTarget: 'A',
    toTarget: 'B',
    depGraph: {},
    analysis: {
      levels: { A: 2, B: 2 },
      systemModules: []
    },
    isReachable: () => false
  });

  assertEqual(policy.blocked, false);
  assertEqual(policy.direction, 'same-level');
});

// ===== 运行测试 =====

console.log('🧪 DepPolicyEngine 单元测试\n');

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
