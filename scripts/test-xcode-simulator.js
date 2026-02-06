#!/usr/bin/env node

/**
 * 测试脚本：Xcode 模拟器基础使用示例
 * 
 * 用法：
 *   node scripts/test-xcode-simulator.js [options]
 *
 * 选项：
 *   --project <path>     项目路径 (默认: 当前目录)
 *   --dashboard <url>    Dashboard URL (默认: http://localhost:3000)
 *   --verbose            详细输出
 *   --scenario <name>    运行特定场景
 */

const { XcodeSimulator } = require('../lib/simulation');
const path = require('path');
const fs = require('fs');

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    project: process.cwd(),
    dashboard: 'http://localhost:3000',
    verbose: false,
    scenario: null
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project') {
      options.project = args[++i];
    } else if (args[i] === '--dashboard') {
      options.dashboard = args[++i];
    } else if (args[i] === '--verbose') {
      options.verbose = true;
    } else if (args[i] === '--scenario') {
      options.scenario = args[++i];
    }
  }

  return options;
}

// 创建日志记录
function createLogger(verbose) {
  return {
    log: (msg) => {
      if (verbose) console.log(`📝 ${msg}`);
    },
    warn: (msg) => console.warn(`⚠️  ${msg}`),
    error: (msg) => console.error(`❌ ${msg}`),
    success: (msg) => console.log(`✅ ${msg}`)
  };
}

// 基础测试场景
async function runBasicSearchTest(simulator, logger) {
  logger.log('Running: Search Test');
  
  try {
    // 1. 打开虚拟文件
    logger.log('Step 1: Opening virtual file');
    simulator.openFile(
      'src/ViewController.swift',
      `
import UIKit

class ViewController: // as:search UIViewController {
  // code
}
`
    );

    // 2. 保存文件（触发 MarkerLine 检测）
    logger.log('Step 2: Saving file');
    simulator.saveFile();

    // 3. 检测指令
    logger.log('Step 3: Detecting directives');
    const directives = simulator.detectDirectives();
    logger.log(`Found ${directives.length} directive(s)`);

    if (directives.length === 0) {
      throw new Error('Expected to find SEARCH directive');
    }

    const directive = directives[0];
    simulator.assertOperationSuccess(
      { status: 'success' },
      'Directive detection'
    );

    // 4. 执行搜索
    logger.log('Step 4: Executing search');
    const searchResult = await simulator.handleDirective(directive);

    logger.log(`Search completed with status: ${searchResult.status}`);

    return {
      passed: true,
      directive,
      result: searchResult
    };
  } catch (error) {
    logger.error(`Search test failed: ${error.message}`);
    return {
      passed: false,
      error: error.message
    };
  }
}

// 创建候选测试
async function runBasicCreateTest(simulator, logger) {
  logger.log('Running: Create Candidate Test');

  try {
    // 1. 打开虚拟文件
    logger.log('Step 1: Opening virtual file');
    simulator.openFile(
      'src/NetworkManager.swift',
      `
import Alamofire

class NetworkManager {
  // as:create
  func fetchData() {
    // sample code
  }
}
`
    );

    // 2. 保存文件
    logger.log('Step 2: Saving file');
    simulator.saveFile();

    // 3. 检测指令
    logger.log('Step 3: Detecting directives');
    const directives = simulator.detectDirectives();

    if (directives.length === 0) {
      throw new Error('Expected to find CREATE directive');
    }

    const directive = directives[0];

    // 4. 执行创建
    logger.log('Step 4: Creating candidate');
    const createResult = await simulator.handleDirective(directive);

    logger.log(`Create completed with status: ${createResult.status}`);

    return {
      passed: true,
      directive,
      result: createResult
    };
  } catch (error) {
    logger.error(`Create test failed: ${error.message}`);
    return {
      passed: false,
      error: error.message
    };
  }
}

// 审查测试
async function runBasicAuditTest(simulator, logger) {
  logger.log('Running: Audit Test');

  try {
    // 1. 打开虚拟文件
    logger.log('Step 1: Opening virtual file');
    simulator.openFile(
      'src/DataModel.swift',
      `
import Foundation

class DataModel {
  // as:audit database
  var id: String?
  var name: String?
}
`
    );

    // 2. 保存文件
    logger.log('Step 2: Saving file');
    simulator.saveFile();

    // 3. 检测指令
    logger.log('Step 3: Detecting directives');
    const directives = simulator.detectDirectives();

    if (directives.length === 0) {
      throw new Error('Expected to find AUDIT directive');
    }

    const directive = directives[0];

    // 4. 执行审查
    logger.log('Step 4: Executing audit');
    const auditResult = await simulator.handleDirective(directive);

    logger.log(`Audit completed with status: ${auditResult.status}`);

    return {
      passed: true,
      directive,
      result: auditResult
    };
  } catch (error) {
    logger.error(`Audit test failed: ${error.message}`);
    return {
      passed: false,
      error: error.message
    };
  }
}

// 主函数
async function main() {
  const options = parseArgs();
  const logger = createLogger(options.verbose);

  console.log('🚀 Xcode Simulator Test Suite\n');
  console.log(`📁 Project: ${options.project}`);
  console.log(`🌐 Dashboard: ${options.dashboard}\n`);

  try {
    // 初始化模拟器
    logger.log('Initializing simulator...');
    const simulator = new XcodeSimulator({
      projectRoot: options.project,
      dashboardUrl: options.dashboard,
      syncToDisk: false,
      logger
    });

    await simulator.init({ autoHealthCheck: true });
    logger.success('Simulator initialized');

    // 运行测试
    const results = [];

    if (!options.scenario || options.scenario === 'search') {
      logger.log('\n─── Running Search Test ───\n');
      const result = await runBasicSearchTest(simulator, logger);
      results.push({ name: 'Search', ...result });
      simulator.reset();
    }

    if (!options.scenario || options.scenario === 'create') {
      logger.log('\n─── Running Create Test ───\n');
      const result = await runBasicCreateTest(simulator, logger);
      results.push({ name: 'Create', ...result });
      simulator.reset();
    }

    if (!options.scenario || options.scenario === 'audit') {
      logger.log('\n─── Running Audit Test ───\n');
      const result = await runBasicAuditTest(simulator, logger);
      results.push({ name: 'Audit', ...result });
      simulator.reset();
    }

    // 输出结果摘要
    console.log('\n═══════════════════════════════════════\n');
    console.log('📊 Test Results Summary:\n');

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    results.forEach(r => {
      const status = r.passed ? '✅' : '❌';
      console.log(`${status} ${r.name}`);
      if (!r.passed) {
        console.log(`   Error: ${r.error}`);
      }
    });

    console.log(`\n📈 Total: ${passed}/${results.length} passed`);

    // 输出操作统计
    const stats = simulator.getOperationStats();
    console.log('\n📈 Operation Statistics:');
    console.log(`   SEARCH: ${stats.SEARCH}`);
    console.log(`   CREATE: ${stats.CREATE}`);
    console.log(`   AUDIT:  ${stats.AUDIT}`);
    console.log(`   Success: ${stats.succeeded}, Failed: ${stats.failed}`);

    // 清理
    simulator.stop();
    logger.success('\nAll tests completed');

    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    logger.error(`Fatal error: ${error.message}`);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
