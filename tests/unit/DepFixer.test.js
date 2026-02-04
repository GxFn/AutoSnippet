/**
 * DepFixer 单元测试
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const DepFixer = require('../../lib/infrastructure/external/spm/DepFixer');

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

function createTempPackage(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autosnippet-spm-'));
  const filePath = path.join(dir, 'Package.swift');
  fs.writeFileSync(filePath, content, 'utf8');
  return { dir, filePath };
}

// ===== Tests =====

test('应在目标依赖缺失时插入依赖', () => {
  const { filePath } = createTempPackage(`
// swift-tools-version:5.7
import PackageDescription

let package = Package(
  name: "Demo",
  targets: [
    .target(
      name: "App",
      dependencies: [
        "Core"
      ]
    )
  ]
)
`);

  const fixer = new DepFixer();
  const result = fixer.patchPackageSwiftAddTargetDependency(filePath, 'App', 'Feature');
  assertEqual(result.ok, true);
  assertEqual(result.changed, true);

  const updated = fs.readFileSync(filePath, 'utf8');
  assert(updated.includes('"Feature"'));
});

test('已存在依赖时不应重复插入', () => {
  const { filePath } = createTempPackage(`
// swift-tools-version:5.7
import PackageDescription

let package = Package(
  name: "Demo",
  targets: [
    .target(
      name: "App",
      dependencies: [
        "Core",
        "Feature"
      ]
    )
  ]
)
`);

  const fixer = new DepFixer();
  const result = fixer.patchPackageSwiftAddTargetDependency(filePath, 'App', 'Feature');
  assertEqual(result.ok, true);
  assertEqual(result.changed, false);
});

test('找不到目标时应返回错误', () => {
  const { filePath } = createTempPackage(`
// swift-tools-version:5.7
import PackageDescription

let package = Package(
  name: "Demo",
  targets: [
    .target(
      name: "App",
      dependencies: []
    )
  ]
)
`);

  const fixer = new DepFixer();
  const result = fixer.patchPackageSwiftAddTargetDependency(filePath, 'Missing', 'Core');
  assertEqual(result.ok, false);
  assert(result.error);
});

// ===== 运行测试 =====

console.log('🧪 DepFixer 单元测试\n');

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
