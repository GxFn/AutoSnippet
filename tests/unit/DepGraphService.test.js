/**
 * DepGraphService 单元测试（基础行为）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const DepGraphService = require('../../lib/infrastructure/external/spm/DepGraphService');

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

function createTempPackage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autosnippet-spm-'));
  const filePath = path.join(dir, 'Package.swift');
  fs.writeFileSync(filePath, `
// swift-tools-version:5.7
import PackageDescription

let package = Package(
  name: "Demo",
  targets: [
    .target(
      name: "Core",
      dependencies: []
    )
  ]
)
`, 'utf8');
  return { dir, filePath };
}

// ===== Tests =====

test('缺少 Package.swift 时返回 null', async () => {
  const service = new DepGraphService(process.cwd());
  const graph = await service.getOrBuildDepGraph('/path/not-exists/Package.swift');
  assertEqual(graph, null);
});

test('有效 Package.swift 时返回依赖图', async () => {
  const { filePath } = createTempPackage();
  const service = new DepGraphService(process.cwd());
  const graph = await service.getOrBuildDepGraph(filePath);
  assert(graph && graph.schemaVersion === 1, 'graph.schemaVersion should be 1');
  assert(Array.isArray(graph.targetsList), 'graph.targetsList should be array');
});

// ===== 运行测试 =====

console.log('🧪 DepGraphService 单元测试\n');

(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
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
})();
