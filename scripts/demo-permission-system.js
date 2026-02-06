#!/usr/bin/env node

/**
 * 权限和项目发现的完整演示
 * 
 * 展示如何在实际项目中使用 XcodeSimulator 的权限管理功能
 */

const path = require('path');
const { XcodeSimulator } = require('../lib/simulation');

// 配置
const CONFIG = {
  // 你的项目路径
  projectRoot: process.env.PROJECT_ROOT || process.cwd(),
  
  // Dashboard 地址
  dashboardUrl: process.env.DASHBOARD_URL || 'http://localhost:3000',
  
  // 是否使用磁盘同步
  syncToDisk: process.env.SYNC_DISK === 'true'
};

// 彩色输出
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m'
};

const log = {
  title: (msg) => {
    console.log('\n' + colors.blue + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + colors.reset);
    console.log(colors.blue + msg + colors.reset);
    console.log(colors.blue + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + colors.reset);
  },
  section: (msg) => console.log(`\n${colors.blue}▶ ${msg}${colors.reset}`),
  info: (msg) => console.log(`  ℹ️  ${msg}`),
  success: (msg) => console.log(`  ${colors.green}✓ ${msg}${colors.reset}`),
  error: (msg) => console.log(`  ${colors.red}✗ ${msg}${colors.reset}`),
  warn: (msg) => console.log(`  ${colors.yellow}⚠ ${msg}${colors.reset}`),
  code: (msg) => console.log(`  ${colors.dim}${msg}${colors.reset}`),
  blank: () => console.log()
};

/**
 * 演示 1: 基础初始化和发现
 */
async function demo1_BasicDiscovery() {
  log.section('演示 1: 初始化和 Dashboard 发现');

  const simulator = new XcodeSimulator({
    projectRoot: CONFIG.projectRoot,
    dashboardUrl: CONFIG.dashboardUrl,
    syncToDisk: CONFIG.syncToDisk
  });

  log.info(`本地项目: ${simulator.projectRoot}`);
  log.info(`Dashboard: ${simulator.dashboardUrl}`);

  try {
    await simulator.init();
    log.success('模拟器初始化成功');
  } catch (error) {
    log.warn(`初始化警告: ${error.message}`);
  }

  const discovered = await simulator.getDiscoveredProjectRoot();
  log.info(`发现的 asd ui 项目: ${discovered || '(使用本地路径)'}`);

  return simulator;
}

/**
 * 演示 2: 权限检查
 */
async function demo2_PermissionChecks(simulator) {
  log.section('演示 2: 权限检查');

  // 要检查的路径列表
  const pathsToCheck = [
    { path: 'AutoSnippet/recipes', desc: 'recipes 目录 (标准位置)' },
    { path: 'AutoSnippet', desc: 'AutoSnippet 项目目录' },
    { path: 'src', desc: '源代码目录' },
    { path: 'lib', desc: '库目录' }
  ];

  log.info('检查多个目录的写权限:');
  log.blank();

  const results = [];
  for (const item of pathsToCheck) {
    const perm = await simulator.requestPermission(item.path);
    results.push(perm);

    const symbol = perm.ok ? colors.green + '✓' + colors.reset : colors.red + '✗' + colors.reset;
    const status = perm.ok ? 'OK' : 'DENIED';
    
    console.log(`  ${symbol} ${item.path.padEnd(25)} [${status}, ${perm.reason}]`);
  }

  return results;
}

/**
 * 演示 3: 权限缓存
 */
async function demo3_CachingBehavior(simulator) {
  log.section('演示 3: 权限缓存机制');

  log.info('演示权限缓存如何提高性能:');
  log.blank();

  const testPath = 'AutoSnippet/recipes';

  // 第一次 - 真实检查
  log.info(`第 1 次申请: ${testPath}`);
  console.time('  耗时');
  const result1 = await simulator.requestPermission(testPath);
  console.timeEnd('  耗时');
  log.code(`  结果: ${result1.reason}`);
  log.blank();

  // 第二次 - 缓存
  log.info(`第 2 次申请: ${testPath} (应从缓存获取)`);
  console.time('  耗时');
  const result2 = await simulator.requestPermission(testPath);
  console.timeEnd('  耗时');
  log.code(`  结果: ${result2.reason}`);
  log.blank();

  // 第三次 - 缓存
  log.info(`第 3 次申请: ${testPath} (应从缓存获取)`);
  console.time('  耗时');
  const result3 = await simulator.requestPermission(testPath);
  console.timeEnd('  耗时');
  log.code(`  结果: ${result3.reason}`);
  log.blank();

  log.success('缓存可以显著减少重复检查的时间');
}

/**
 * 演示 4: 权限历史和统计
 */
async function demo4_HistoryAndStats(simulator) {
  log.section('演示 4: 权限历史和统计');

  // 获取历史
  const history = simulator.getPermissionHistory();
  log.info(`总权限检查数: ${history.length}`);
  log.blank();

  // 显示最近的检查
  log.info('最近的 5 次检查:');
  const recent = history.slice(-5);
  recent.forEach((record, idx) => {
    const status = record.ok ? colors.green + '✓' + colors.reset : colors.red + '✗' + colors.reset;
    console.log(`  ${idx + 1}. [${status}] ${record.targetPath}`);
    console.log(`     ${colors.dim}${record.reason}${colors.reset}`);
  });
  log.blank();

  // 获取统计
  const stats = simulator.getPermissionStats();
  log.info('权限检查统计:');
  console.log(`  总检查数:      ${stats.total}`);
  console.log(`  成功:          ${stats.passed}`);
  console.log(`  失败:          ${stats.failed}`);
  console.log(`  成功率:        ${stats.successRate}%`);
  console.log(`  缓存项数:      ${stats.cacheSize}`);
}

/**
 * 演示 5: 实际使用场景
 */
async function demo5_RealUsageScenarios(simulator) {
  log.section('演示 5: 实际使用场景');

  // 场景 1: 条件执行
  log.info('场景 1: 条件执行 - 只有有权限才执行操作');
  const perm1 = await simulator.requestPermission('AutoSnippet/recipes');
  
  if (perm1.ok) {
    log.success('✓ 有权限，可以执行操作');
    log.info('  可以调用: simulator.openFile(), editFile(), saveFile() 等');
  } else {
    log.error('✗ 无权限，跳过操作');
    log.info(`  原因: ${perm1.reason}`);
  }
  log.blank();

  // 场景 2: 批量检查
  log.info('场景 2: 批量权限检查');
  const paths = ['src', 'lib', 'AutoSnippet'];
  const batchResults = [];
  
  for (const p of paths) {
    const perm = await simulator.requestPermission(p);
    batchResults.push({ path: p, ok: perm.ok });
    const status = perm.ok ? '✓' : '✗';
    log.code(`  ${status} ${p}`);
  }
  
  const passedCount = batchResults.filter(r => r.ok).length;
  log.success(`${passedCount}/${paths.length} 目录有写权限`);
  log.blank();

  // 场景 3: 显式项目路径
  log.info('场景 3: 用于 CI/CD 检查');
  const discovered = await simulator.getDiscoveredProjectRoot();
  log.code(`  已发现项目: ${discovered || '(未发现，使用本地路径)'}`);
  log.code(`  用于审计: 记录所有权限检查到日志`);
  log.blank();
}

/**
 * 演示 6: 测试模式
 */
async function demo6_TestingMode(simulator) {
  log.section('演示 6: 测试模式 (禁用权限检查)');

  log.info('在本地测试中禁用权限检查:');
  log.blank();

  // 获取初始统计
  const statsBefore = simulator.getPermissionStats();
  log.code(`  统计前: ${statsBefore.total} 次检查`);

  // 禁用
  simulator.disablePermissionChecks();
  log.success('✓ 权限检查已禁用');
  log.info(`  环境变量: ASD_SKIP_WRITE_GUARD=${process.env.ASD_SKIP_WRITE_GUARD}`);
  log.blank();

  // 测试期间的检查会被跳过
  log.info('在禁用期间，权限检查会立即返回 true:');
  const testPerm = await simulator.requestPermission('any/path');
  log.code(`  结果: ok=${testPerm.ok}, reason="${testPerm.reason}"`);
  log.blank();

  // 启用
  simulator.enablePermissionChecks();
  log.success('✓ 权限检查已启用');
  log.blank();

  const statsAfter = simulator.getPermissionStats();
  log.info(`  统计后: ${statsAfter.total} 次检查`);
}

/**
 * 演示 7: 导出和报告
 */
async function demo7_ExportAndReporting(simulator) {
  log.section('演示 7: 导出和审计报告');

  const report = simulator.export();

  log.info('导出的报告包含:');
  console.log(`  时间戳:        ${report.timestamp}`);
  console.log(`  项目根:        ${report.projectRoot}`);
  console.log(`  发现的项目:    ${report.discoveredProjectRoot || '(未发现)'}`);
  log.blank();

  log.info('权限统计:');
  console.log(`  总检查:        ${report.permissions.total}`);
  console.log(`  成功:          ${report.permissions.passed}`);
  console.log(`  失败:          ${report.permissions.failed}`);
  console.log(`  成功率:        ${report.permissions.successRate}%`);
  log.blank();

  log.success('✓ 报告可以保存到 JSON 进行审计');
  log.code(`  const fs = require('fs');`);
  log.code(`  fs.writeFileSync('permission-report.json', JSON.stringify(report, null, 2));`);
}

/**
 * 演示 8: 实际应用示例
 */
async function demo8_ApplicationExample(simulator) {
  log.section('演示 8: 实际应用示例');

  log.info('在 OperationExecutor 中集成权限检查:');
  log.blank();

  log.code(`// 执行操作前检查权限`);
  log.code(`async executeRequest(request) {`);
  log.code(`  const perm = await simulator.requestPermission(request.targetPath);`);
  log.code(`  if (!perm.ok) {`);
  log.code(`    throw new Error(\`无权限: \${perm.reason}\`);`);
  log.code(`  }`);
  log.code(`  return this.executeSearch(request);`);
  log.code(`}`);
  log.blank();

  log.info('在文件操作中记录权限信息:');
  log.blank();

  log.code(`async saveFile(filePath, content) {`);
  log.code(`  const perm = await simulator.requestPermission(filePath);`);
  log.code(`  logger.info('Save', {`);
  log.code(`    file: filePath,`);
  log.code(`    permission: perm.ok,`);
  log.code(`    projectRoot: perm.projectRoot`);
  log.code(`  });`);
  log.code(`  if (perm.ok) {`);
  log.code(`    return this.versionControl.saveFile(filePath, content);`);
  log.code(`  }`);
  log.code(`}`);
}

/**
 * 主函数
 */
async function main() {
  log.title('Xcode 模拟器 - 权限和发现系统演示');

  console.log();
  console.log(`配置:`);
  console.log(`  项目根: ${CONFIG.projectRoot}`);
  console.log(`  Dashboard: ${CONFIG.dashboardUrl}`);
  console.log(`  磁盘同步: ${CONFIG.syncToDisk}`);
  console.log();

  try {
    // 演示 1
    const simulator = await demo1_BasicDiscovery();
    log.blank();

    // 演示 2
    await demo2_PermissionChecks(simulator);
    log.blank();

    // 演示 3
    await demo3_CachingBehavior(simulator);
    log.blank();

    // 演示 4
    await demo4_HistoryAndStats(simulator);
    log.blank();

    // 演示 5
    await demo5_RealUsageScenarios(simulator);
    log.blank();

    // 演示 6
    await demo6_TestingMode(simulator);
    log.blank();

    // 演示 7
    await demo7_ExportAndReporting(simulator);
    log.blank();

    // 演示 8
    await demo8_ApplicationExample(simulator);
    log.blank();

    // 清理
    simulator.stop();

    // 总结
    log.title('演示完成');
    console.log();
    console.log('关键特性总结:');
    console.log('  ✓ 自动发现 asd ui 项目位置');
    console.log('  ✓ 真实的 WriteGuard 权限检查');
    console.log('  ✓ 智能权限缓存 (24 小时 TTL)');
    console.log('  ✓ 完整的权限历史和审计');
    console.log('  ✓ 灵活的测试模式');
    console.log('  ✓ JSON 格式的导出报告');
    console.log();
    console.log('下一步:');
    console.log('  1. 将权限检查集成到 OperationExecutor');
    console.log('  2. 启动 asd ui Dashboard 进行完整测试');
    console.log('  3. 在 CI/CD 流程中使用权限检查');
    console.log();

  } catch (error) {
    log.error(`发生错误: ${error.message}`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
