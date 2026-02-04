/**
 * DepReport 单元测试
 */

const DepReport = require('../../lib/infrastructure/external/spm/DepReport');

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

// ===== Tests =====

test('应生成缺失依赖提示文本', () => {
  const report = new DepReport();
  const text = report.buildMissingDependencyReport('/path/Package.swift', 'App', 'Core');
  assert(text.includes('Package.swift: /path/Package.swift'));
  assert(text.includes('App'));
  assert(text.includes('Core'));
});

// ===== 运行测试 =====

console.log('🧪 DepReport 单元测试\n');

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
