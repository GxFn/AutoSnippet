#!/usr/bin/env node

/**
 * Guard 规则迁移 CLI
 * 
 * 用法：
 *   node scripts/migrate-guard-rules.js --rules path/to/rules.json
 *   node scripts/migrate-guard-rules.js --full-migration --rules /path/to/rules.json --violations /path/to/violations.json
 */

const path = require('path');
const fs = require('fs');
const GuardRuleMigrator = require('../lib/guard/GuardRuleMigrator');

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {};

  for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--rules') {
    config.rulesFile = args[++i];
  } else if (arg === '--violations') {
    config.violationsFile = args[++i];
  } else if (arg === '--exclusions') {
    config.exclusionsFile = args[++i];
  } else if (arg === '--output') {
    config.outputDir = args[++i];
  } else if (arg === '--full-migration') {
    config.fullMigration = true;
  } else if (arg === '--help') {
    printHelp();
    process.exit(0);
  }
  }

  return config;
}

function printHelp() {
  console.log(`
Guard 规则迁移工具

用法：
  node scripts/migrate-guard-rules.js [选项]

选项：
  --rules FILE            规则文件路径 (JSON 格式)
  --violations FILE       违反历史文件路径 (JSON 格式)
  --exclusions FILE       排除配置文件路径 (JSON 格式)
  --output DIR            输出目录 (默认: Knowledge/.autosnippet)
  --full-migration        运行完整迁移流程（包含所有步骤）
  --help                  显示此帮助信息

示例：
  # 导入规则并初始化学习系统
  node scripts/migrate-guard-rules.js --rules guard-rules.json

  # 完整迁移：规则 + 历史 + 排除
  node scripts/migrate-guard-rules.js --full-migration \\
  --rules guard-rules.json \\
  --violations guard-violations.json \\
  --exclusions guard-exclusions.json
  `);
}

async function main() {
  const config = parseArgs();
  const projectRoot = path.resolve(__dirname, '..');

  if (!config.rulesFile && !config.fullMigration) {
  console.error('错误: 需要指定 --rules 或 --full-migration');
  printHelp();
  process.exit(1);
  }

  const migrator = new GuardRuleMigrator(projectRoot);

  console.log('🔄 Guard 规则迁移开始\n');

  try {
  let result;

  if (config.fullMigration) {
    result = migrator.runFullMigration(config);
  } else if (config.rulesFile) {
    console.log(`📚 导入规则文件: ${config.rulesFile}`);
    const rulesContent = JSON.parse(fs.readFileSync(config.rulesFile, 'utf8'));
    const rules = Array.isArray(rulesContent) ? rulesContent : rulesContent.rules;
    result = migrator.importRules(rules);
  }

  // 输出结果
  console.log('\n✅ 迁移完成\n');
  console.log('结果摘要：');
  console.log(JSON.stringify(result, null, 2));

  // 如果是完整迁移，显示详细信息
  if (result.steps) {
    console.log('\n📊 详细步骤结果：');
    Object.entries(result.steps).forEach(([step, stepResult]) => {
    const status = stepResult.success ? '✓' : '✗';
    console.log(`  ${status} ${step}: ${JSON.stringify(stepResult)}`);
    });
  }

  console.log('\n📁 数据保存位置:');
  console.log(`  - 学习统计: ${path.join(projectRoot, 'Knowledge/.autosnippet/guard-learner.json')}`);
  console.log(`  - 排除配置: ${path.join(projectRoot, 'Knowledge/.autosnippet/guard-exclusions.json')}`);

  } catch (e) {
  console.error('\n❌ 迁移失败:', e.message);
  process.exit(1);
  }
}

main();
