#!/usr/bin/env node

/**
 * 职责：
 * - 初始化工作空间配置
 * - 支持 VSCode Copilot + MCP 配置
 * - 支持 Cursor MCP 配置
 * - 注：不再创建 AutoSnippet.boxspec.json
 * - 用户项目自己定义 boxspec.json
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * 初始化规范
 * @param {string} projectPath 项目路径
 * @returns {Promise<void>}
 */
async function initSpec(projectPath = process.cwd()) {
  console.log('\n📦 AutoSnippet 工作空间初始化');
  console.log('=' + '='.repeat(50) + '\n');

  try {
  // Step 1: VSCode Copilot 配置
  await initVSCodeCopilot(projectPath);

  // Step 2: Cursor MCP 配置（如果在项目中）
  await initCursorMCP(projectPath);

  // Step 3: 显示完成信息
  console.log('\n✅ 工作空间初始化完成！\n');
  console.log('📍 已配置：');
  console.log('   ✓ VSCode Copilot MCP 连接');
  console.log('   ✓ Cursor MCP 连接（可选）');
  console.log('   ✓ 推荐扩展配置');
  console.log('   ✓ 项目指令');
  console.log('\n🚀 后续步骤：');
  console.log('   1. 启动 Dashboard: asd ui');
  console.log('   2. 重启 VSCode/Cursor');
  console.log('   3. 在 Copilot Chat 中测试: @autosnippet search');
  console.log('\n' + '='.repeat(53) + '\n');
  } catch (err) {
  console.error('\n❌ 初始化失败:', err.message);
  process.exit(1);
  }
}

/**
 * 初始化 VSCode Copilot 配置
 * @param {string} projectPath 项目路径
 */
async function initVSCodeCopilot(projectPath) {
  console.log('1️⃣  配置 VSCode Copilot...');

  const scriptPath = path.join(__dirname, '..', 'scripts', 'install-vscode-copilot.js');
  
  if (!fs.existsSync(scriptPath)) {
  console.log('   ⚠️  install-vscode-copilot.js 不存在，跳过 VSCode 配置');
  return;
  }

  try {
  // 静默运行配置脚本
  process.env.ASD_QUIET = 'false';
  const result = execSync(`node "${scriptPath}" --path "${projectPath}"`, {
    encoding: 'utf8',
    stdio: 'inherit',
    cwd: projectPath
  });
  console.log('   ✓ VSCode Copilot 配置完成');
  } catch (err) {
  console.log('   ⚠️  VSCode 配置步骤出错（非阻断性）:', err.message);
  console.log('   💡 您可以稍后运行: npm run install:vscode-copilot');
  }
}

/**
 * 初始化 Cursor MCP 配置
 * @param {string} projectPath 项目路径
 */
async function initCursorMCP(projectPath) {
  console.log('2️⃣  配置 Cursor MCP...');

  const scriptPath = path.join(__dirname, '..', 'scripts', 'setup-mcp-config.js');
  
  if (!fs.existsSync(scriptPath)) {
  console.log('   ⚠️  setup-mcp-config.js 不存在，跳过 Cursor 配置');
  return;
  }

  try {
  // 检查是否在 Cursor 中运行
  const isCursor = process.env.CURSOR || process.env.CURSOR_IDE;
  if (!isCursor) {
    console.log('   ℹ️  当前不在 Cursor 中运行，跳过 Cursor 配置');
    console.log('   💡 如需配置 Cursor，请运行: npm run install:cursor-skill --mcp');
    return;
  }

  process.env.ASD_QUIET = 'true';
  execSync(`node "${scriptPath}" --editor cursor --path "${projectPath}"`, {
    encoding: 'utf8',
    stdio: 'inherit',
    cwd: projectPath
  });
  console.log('   ✓ Cursor MCP 配置完成');
  } catch (err) {
  console.log('   ℹ️  Cursor 配置步骤（非必须）:', err.message);
  console.log('   💡 如需 Cursor 配置，请运行: npm run install:cursor-skill --mcp');
  }
}

module.exports = {
  initSpec
};
