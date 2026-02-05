/**
 * Guard 系统单元测试
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const GuardRuleLearner = require('../../../lib/guard/GuardRuleLearner');
const GuardExclusionManager = require('../../../lib/guard/GuardExclusionManager');
const EnhancedGuardChecker = require('../../../lib/guard/EnhancedGuardChecker');

// 临时目录用于测试
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-test-'));

async function testGuardRuleLearner() {
  console.log('  测试 GuardRuleLearner...');
  const learner = new GuardRuleLearner(tempDir);

  // 记录触发
  learner.recordTrigger('rule-1', { isApplied: true });
  learner.recordTrigger('rule-1', { isApplied: true });
  learner.recordTrigger('rule-1', { isApplied: true });

  // 记录反馈
  learner.recordFeedback('rule-1', 'correct');
  learner.recordFeedback('rule-1', 'correct');
  learner.recordFeedback('rule-1', 'falsePositive');

  const metrics = learner.getMetrics('rule-1');
  console.log(`    ✓ 规则 rule-1 指标: precision=${metrics.precision.toFixed(2)}, recall=${metrics.recall.toFixed(2)}, f1=${metrics.f1.toFixed(2)}`);
  
  const allStats = learner.getAllStats();
  console.assert(allStats['rule-1'], '✓ 规则统计正确');
}

async function testGuardExclusionManager() {
  console.log('  测试 GuardExclusionManager...');
  const mgr = new GuardExclusionManager(tempDir);

  // 添加路径排除
  mgr.addPathExclusion('Pods/**', 'Third party');
  const isExcluded = mgr.isPathExcluded('Pods/AFNetworking/AFHTTPSessionManager.m');
  console.assert(isExcluded, '✓ 路径排除生效');

  // 添加规则排除
  mgr.addRuleExclusion('Main.m', 'rule-1', 'False positive');
  const isRuleExcluded = mgr.isRuleExcluded('Main.m', 'rule-1');
  console.assert(isRuleExcluded, '✓ 规则排除生效');

  // 全局规则禁用
  mgr.addGlobalRuleExclusion('rule-2', 'High FP rate');
  const isGlobalDisabled = mgr.isRuleGloballyDisabled('rule-2');
  console.assert(isGlobalDisabled, '✓ 全局规则禁用生效');
}

async function testEnhancedGuardChecker() {
  console.log('  测试 EnhancedGuardChecker...');
  
  // 模拟基础 Guard 模块
  const mockGuardModule = {
  runStaticCheck: (projectRoot, code, language, scope) => [
    {
    ruleId: 'test-rule-1',
    severity: 'error',
    message: 'Test violation',
    line: 10
    }
  ]
  };

  const checker = new EnhancedGuardChecker(tempDir, mockGuardModule);

  // 运行增强检查
  const result = await checker.runEnhancedStaticCheck(
  'some code',
  'objc',
  'Main.m',
  'file'
  );

  console.assert(result.length > 0, '✓ 增强检查返回违反');
  console.assert(result[0].trustScore !== undefined, '✓ 违反包含信任分数');

  // 测试反馈
  checker.feedbackViolation('test-rule-1', 'correct');
  console.log('  ✓ 反馈记录成功');

  // 获取报告
  const report = checker.generateLearningReport();
  console.assert(report.timestamp, '✓ 学习报告生成');
}

async function runTests() {
  console.log('运行 Guard 系统测试...\n');
  
  try {
  await testGuardRuleLearner();
  await testGuardExclusionManager();
  await testEnhancedGuardChecker();
  console.log('\n✓ 所有 Guard 测试通过\n');
  } catch (e) {
  console.error('✗ Guard 测试失败:', e.message);
  process.exit(1);
  } finally {
  // 清理临时目录
  fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

module.exports = { runTests };

// 如果直接运行此文件
if (require.main === module) {
  runTests().catch(e => {
  console.error(e);
  process.exit(1);
  });
}
