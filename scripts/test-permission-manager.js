#!/usr/bin/env node

/**
 * 权限管理测试脚本
 * 
 * 演示：
 * 1. 从 asd ui 发现项目位置
 * 2. 申请项目文件权限
 * 3. 真实的权限检查（WriteGuard 机制）
 * 4. 权限历史和统计
 */

const { XcodeSimulator } = require('../lib/simulation');

const log = {
  info: (msg) => console.log(`ℹ️  ${msg}`),
  step: (msg) => console.log(`\n🔹 ${msg}`),
  result: (msg) => console.log(`✅ ${msg}`),
  error: (msg) => console.error(`❌ ${msg}`),
  warn: (msg) => console.warn(`⚠️  ${msg}`)
};

async function main() {
  log.info('Xcode Simulator - 权限管理和项目发现');
  log.info('================================================================\n');

  const simulator = new XcodeSimulator({
    projectRoot: process.cwd(),
    dashboardUrl: 'http://localhost:3000',
    syncToDisk: false
  });

  try {
    // 第 1 步: 初始化并发现项目
    log.step('1. 初始化模拟器并发现 asd ui 项目');
    
    try {
      await simulator.init({ autoHealthCheck: true });
      log.result('初始化成功');
    } catch (error) {
      log.warn(`初始化警告: ${error.message}`);
      log.info('继续使用本地项目路径...');
      // Dashboard 可能未启动，但我们可以继续演示权限检查功能
    }

    // 第 2 步: 获取发现的项目位置
    log.step('2. 获取发现的项目信息');

    const discoveredRoot = await simulator.getDiscoveredProjectRoot();
    log.info(`发现的项目根: ${discoveredRoot}`);
    log.info(`本地项目根: ${simulator.projectRoot}`);

    if (discoveredRoot !== simulator.projectRoot) {
      log.result('✓ 从 Dashboard 成功发现了 asd ui 的项目位置');
    } else {
      log.info('使用本地项目路径');
    }

    // 第 3 步: 申请权限 - 针对主项目目录
    log.step('3. 申请项目文件权限（使用真实 WriteGuard 机制）');

    log.info('申请权限: AutoSnippet/recipes 目录...');
    const permission1 = await simulator.requestPermission('AutoSnippet/recipes');
    
    if (permission1.ok) {
      log.result(`权限申请成功: ${permission1.reason}`);
    } else {
      log.warn(`权限申请失败: ${permission1.reason}`);
      log.info('(这可能是因为 AutoSnippet 目录不存在或权限受限)');
    }

    // 第 4 步: 申请多个不同的权限
    log.step('4. 批量申请权限（多个目录）');

    const paths = [
      'AutoSnippet/recipes',
      'AutoSnippet',
      'src'
    ];

    const permissionResults = [];
    for (const pathToCheck of paths) {
      try {
        const perm = await simulator.requestPermission(pathToCheck);
        permissionResults.push({ path: pathToCheck, ...perm });
        
        const status = perm.ok ? '✓' : '✗';
        log.info(`${status} ${pathToCheck}: ${perm.reason}`);
      } catch (error) {
        log.error(`${pathToCheck}: ${error.message}`);
        permissionResults.push({ path: pathToCheck, ok: false, error: error.message });
      }
    }

    // 第 5 步: 查看权限历史
    log.step('5. 权限检查历史');

    const history = simulator.getPermissionHistory();
    log.info(`总检查次数: ${history.length}`);

    const shortHistory = history.slice(-5);
    shortHistory.forEach((record, idx) => {
      const status = record.ok ? '✓' : '✗';
      const projectPath = record.projectRoot 
        ? record.projectRoot.split('/').slice(-2).join('/') 
        : '未知';
      log.info(`  ${idx + 1}. [${status}] ${record.targetPath} (${record.reason})`);
    });

    // 第 6 步: 权限统计
    log.step('6. 权限统计信息');

    const stats = simulator.getPermissionStats();
    log.info(`总检查: ${stats.total}`);
    log.info(`成功: ${stats.passed}`);
    log.info(`失败: ${stats.failed}`);
    log.info(`成功率: ${stats.successRate}`);
    log.info(`缓存大小: ${stats.cacheSize} 条缓存`);

    // 第 7 步: 权限缓存演示
    log.step('7. 权限缓存演示（第二次申请应该从缓存获取）');

    log.info('第一次申请权限（新请求）...');
    const time1Start = Date.now();
    const result1 = await simulator.requestPermission('AutoSnippet/recipes');
    const time1End = Date.now();
    log.info(`✓ 耗时: ${time1End - time1Start}ms`);

    log.info('第二次申请相同权限（应该从缓存获取）...');
    const time2Start = Date.now();
    const result2 = await simulator.requestPermission('AutoSnippet/recipes');
    const time2End = Date.now();
    log.info(`✓ 耗时: ${time2End - time2Start}ms (缓存命中应该更快)`);

    // 第 8 步: 导出完整报告
    log.step('8. 完整导出报告');

    const report = simulator.export();
    log.info('已导出的报告内容:');
    log.info(`  - 时间戳: ${report.timestamp}`);
    log.info(`  - 项目根: ${report.projectRoot}`);
    log.info(`  - 发现的项目: ${report.discoveredProjectRoot || '(未发现)'}`);
    log.info(`  - 权限统计:`);
    log.info(`    - 总检查: ${report.permissions.total}`);
    log.info(`    - 通过: ${report.permissions.passed}`);
    log.info(`    - 失败: ${report.permissions.failed}`);

    // 第 9 步: 演示权限禁用
    log.step('9. 权限模式演示');

    log.info('禁用权限检查（测试模式）...');
    simulator.disablePermissionChecks();
    log.info(`✓ 已禁用权限检查`);
    log.info(`  环境变量: ASD_SKIP_WRITE_GUARD=${process.env.ASD_SKIP_WRITE_GUARD}`);

    log.info('启用权限检查...');
    simulator.enablePermissionChecks();
    log.info(`✓ 已启用权限检查`);

    // 完成
    simulator.stop();
    log.result('\n权限管理测试完成！\n');

    // 输出最终总结
    console.log('═══════════════════════════════════════');
    console.log('权限管理功能总结:');
    console.log('═══════════════════════════════════════');
    console.log('');
    console.log('✅ 已实现功能:');
    console.log('  1. 从 asd ui 发现项目位置（通过 Dashboard API）');
    console.log('  2. 真实权限检查（通过 git push --dry-run 或文件写入测试）');
    console.log('  3. 权限申请接口（requestPermission）');
    console.log('  4. 权限缓存机制（24小时 TTL）');
    console.log('  5. 权限历史记录和统计');
    console.log('  6. 权限检查禁用/启用（测试模式支持）');
    console.log('');
    console.log('🔧 使用场景:');
    console.log('  1. 模拟器启动时自动发现 asd ui 项目位置');
    console.log('  2. 执行任何操作前只需调用 requestPermission()');
    console.log('  3. 在 CI/CD 中控制权限检查行为');
    console.log('  4. 完整审计权限检查历史');
    console.log('');

  } catch (error) {
    log.error(`测试过程中发生错误: ${error.message}`);
    if (process.env.VERBOSE) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
