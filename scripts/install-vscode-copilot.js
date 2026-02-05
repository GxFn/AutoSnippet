#!/usr/bin/env node

/**
 * AutoSnippet VSCode Copilot 安装脚本
 * 
 * 功能：
 * 1. 自动配置 VSCode 全局和工作区 settings.json
 * 2. 创建推荐扩展配置 (.vscode/extensions.json)
 * 3. 生成或更新项目指令 (.github/copilot-instructions.md)
 * 4. 验证 MCP 服务器连接
 * 5. 提供快速启动指导
 *
 * 使用:
 *   node scripts/install-vscode-copilot.js [--path /path/to/project] [--global|--workspace]
 *   npm run install:vscode-copilot
 *
 * 选项:
 *   --path <path>      指定项目根目录（默认为 cwd）
 *   --global           仅配置全局 settings.json（~/.config/Code/User/settings.json）
 *   --workspace        仅配置工作区 settings.json（.vscode/settings.json）
 *   --skip-verify      跳过验证步骤
 *   --quiet            安静模式（无输出）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const args = require('minimist')(process.argv.slice(2));
const projectPath = args.path || args.p || process.cwd();

// 检测是否在 AutoSnippet 仓库内执行
const isAutoSnippetRepo = fs.existsSync(path.join(projectPath, 'scripts/mcp-server.js')) &&
  fs.existsSync(path.join(projectPath, 'bin/asd')) &&
  fs.existsSync(path.join(projectPath, 'package.json'));

// 默认只做工作区配置，不做全局配置
// 如果在 AutoSnippet 仓库内执行且未明确指定 --path，跳过所有配置
const configGlobal = args.global && !isAutoSnippetRepo;
const configWorkspace = !args.global && !isAutoSnippetRepo && (args.path || !isAutoSnippetRepo);
const skipVerify = args['skip-verify'];
const isQuiet = args.quiet || process.env.ASD_QUIET === 'true';

// ============ 颜色定义 ============
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m'
};

function log(msg, color = 'reset') {
  if (!isQuiet) {
  console.log(colors[color] + msg + colors.reset);
  }
}

function error(msg) {
  console.error(colors.red + msg + colors.reset);
}

// ============ 助手函数 ============

function getVSCodeSettingsPath(isGlobal = true) {
  const platform = os.platform();
  
  if (isGlobal) {
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library/Application Support/Code/User/settings.json');
  } else if (platform === 'win32') {
    return path.join(os.getenv('APPDATA') || os.homedir(), 'Code/User/settings.json');
  } else {
    return path.join(os.homedir(), '.config/Code/User/settings.json');
  }
  } else {
  return path.join(projectPath, '.vscode/settings.json');
  }
}

function readJsonFile(filePath, defaultValue = {}) {
  if (!fs.existsSync(filePath)) {
  return defaultValue;
  }
  try {
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
  } catch (e) {
  log(`⚠️  无法解析 ${filePath}: ${e.message}`, 'yellow');
  return defaultValue;
  }
}

function writeJsonFile(filePath, data) {
  try {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return true;
  } catch (e) {
  error(`✗ 无法写入 ${filePath}: ${e.message}`);
  return false;
  }
}

// ============ 获取 MCP 服务器路径 ============

function getMcpServerPath() {
  const scriptPath = path.join(projectPath, 'scripts/mcp-server.js');
  if (!fs.existsSync(scriptPath)) {
  error(`✗ MCP Server 不存在: ${scriptPath}`);
  error(`  请确保在 AutoSnippet 项目目录下运行此脚本`);
  process.exit(1);
  }
  return scriptPath;
}

// ============ 配置 VSCode settings.json ============

function configureVSCodeSettings() {
  log('\n📝 配置 VSCode settings.json...', 'blue');
  
  if (isAutoSnippetRepo && !args.path) {
  log('ℹ️  检测到在 AutoSnippet 仓库内执行，仅配置全局设置', 'yellow');
  log('   如需为其他项目配置，请使用: --path /path/to/project', 'yellow');
  }
  
  const mcpServerPath = getMcpServerPath();
  const mcpConfig = {
  name: 'autosnippet',
  command: 'node',
  args: [mcpServerPath],
  env: {
    ASD_UI_URL: 'http://localhost:3000'
  }
  };

  let globalConfigured = false;
  let workspaceConfigured = false;

  // 全局配置
  if (configGlobal) {
  const globalSettingsPath = getVSCodeSettingsPath(true);
  const globalSettings = readJsonFile(globalSettingsPath, {});

  if (!globalSettings['github.copilot.mcp']) {
    globalSettings['github.copilot.mcp'] = {};
  }
  if (!globalSettings['github.copilot.mcp'].servers) {
    globalSettings['github.copilot.mcp'].servers = [];
  }

  const existingIndex = globalSettings['github.copilot.mcp'].servers.findIndex(
    s => s.name === 'autosnippet'
  );

  if (existingIndex >= 0) {
    globalSettings['github.copilot.mcp'].servers[existingIndex] = mcpConfig;
  } else {
    globalSettings['github.copilot.mcp'].servers.push(mcpConfig);
  }

  // 添加推荐的全局设置
  globalSettings['github.copilot.enable'] = globalSettings['github.copilot.enable'] || {};
  globalSettings['github.copilot.enable']['*'] = true;
  globalSettings['github.copilot.chat.localeOverride'] = 'zh-CN';

  if (writeJsonFile(globalSettingsPath, globalSettings)) {
    log(`✅ 全局配置完成: ${globalSettingsPath}`, 'green');
    globalConfigured = true;
  }
  }

  // 工作区配置
  if (configWorkspace) {
  const workspaceSettingsPath = getVSCodeSettingsPath(false);
  const workspaceSettings = readJsonFile(workspaceSettingsPath, {});

  if (!workspaceSettings['github.copilot.mcp']) {
    workspaceSettings['github.copilot.mcp'] = {};
  }
  if (!workspaceSettings['github.copilot.mcp'].servers) {
    workspaceSettings['github.copilot.mcp'].servers = [];
  }

  const existingIndex = workspaceSettings['github.copilot.mcp'].servers.findIndex(
    s => s.name === 'autosnippet'
  );

  if (existingIndex >= 0) {
    workspaceSettings['github.copilot.mcp'].servers[existingIndex] = mcpConfig;
  } else {
    workspaceSettings['github.copilot.mcp'].servers.push(mcpConfig);
  }

  if (writeJsonFile(workspaceSettingsPath, workspaceSettings)) {
    log(`✅ 工作区配置完成: ${workspaceSettingsPath}`, 'green');
    workspaceConfigured = true;
  }
  }

  return globalConfigured || workspaceConfigured;
}

// ============ 创建推荐扩展配置 ============

function createExtensionsJson() {
  log('\n📦 创建推荐扩展配置...', 'blue');

  const extensionsPath = path.join(projectPath, '.vscode/extensions.json');
  const extensions = {
  recommendations: [
    'GitHub.copilot',
    'GitHub.copilot-chat'
  ],
  unwantedRecommendations: []
  };

  if (writeJsonFile(extensionsPath, extensions)) {
  log(`✅ 扩展推荐配置完成: ${extensionsPath}`, 'green');
  return true;
  }
  return false;
}

// ============ 生成项目指令 ============

function createCopilotInstructions() {
  log('\n📖 生成项目指令 (.github/copilot-instructions.md)...', 'blue');

  const instructionsPath = path.join(projectPath, '.github/copilot-instructions.md');
  
  // 检查是否已存在
  if (fs.existsSync(instructionsPath)) {
  log(`✓ 项目指令已存在，跳过创建`, 'yellow');
  return true;
  }

  const instructions = `# AutoSnippet Copilot Instructions

## 项目概览
- 项目名称：AutoSnippet
- 目标：通过 Recipe/Snippet/向量检索构建团队知识库与代码复用工作流。
- 项目根：包含 \`*.boxspec.json\` 的目录（当前仓库为 \`AutoSnippet.boxspec.json\`）。

## 知识库与结构
- 知识库根目录：\`AutoSnippet/\`（默认，**用户项目可通过 \`boxspec.knowledgeBase.dir\` 配置改为 \`Knowledge/\` 或其他**）
- Recipe：\`AutoSnippet/recipes/*.md\`（或用户配置的 \`{knowledgeBase.dir}/recipes/\`）
- Snippet：\`AutoSnippet/snippets/*.json\` 或 root spec \`list\`
- Candidates：\`AutoSnippet/.autosnippet/candidates.json\`
- 向量索引：\`AutoSnippet/.autosnippet/context/\`（\`asd embed\` 生成）
- Recipe 统计：\`AutoSnippet/.autosnippet/recipe-stats.json\`
 - 统计权重：\`AutoSnippet/.autosnippet/recipe-stats-weights.json\` 或 boxspec \`recipes.statsWeights\`

## 强制规则（必须遵守）
1. **禁止直接修改** 知识库目录内容（如 \`AutoSnippet/recipes/\`、\`AutoSnippet/snippets/\`、\`AutoSnippet/.autosnippet/candidates.json\`）。
2. 创建或入库必须走 **Dashboard** 或 MCP 流程（如 \`autosnippet_open_create\`、\`autosnippet_submit_candidates\`）。
3. **优先使用 Recipe** 作为项目标准；源代码仅作补充。
4. MCP 检索优先：可用 \`autosnippet_context_search\` 获取语义检索结果。
5. MCP 调用失败时，**不要在同一轮重复重试**，回退到已读文档或静态上下文。
6. Skills 负责语义与流程，MCP 负责能力与调用；不要在 Skill 内硬编码 URL/HTTP。

## Recipe 结构要点
- 必须包含：Frontmatter（\`title\`、\`trigger\` 必填）+ \`## Snippet / Code Reference\` + \`## AI Context / Usage Guide\`。
- 多段 Recipe 可用「空行 + \`---\` + 下一段 Frontmatter」分隔。
 - 已是完整 Recipe Markdown 时可直接解析入库，无需 AI 重写。

## 推荐工作流
- 查找：先用 \`autosnippet_context_search\` 或 Dashboard Search。
- 产出候选：生成结构化候选并提交到 Candidates。
- 采纳与评分：可使用 \`autosnippet_confirm_recipe_usage\`、\`autosnippet_request_recipe_rating\`。

## 与 Cursor 规则联动
- 本文件与 \`scripts/cursor-rules/autosnippet-conventions.mdc\` 保持一致，均用于提供 AI 的基础项目认知与必要说明。
- 如有冲突，以 **禁止修改 Knowledge** 与 **Recipe 优先** 原则为准。
`;

  try {
  fs.mkdirSync(path.dirname(instructionsPath), { recursive: true });
  fs.writeFileSync(instructionsPath, instructions, 'utf8');
  log(`✅ 项目指令生成完成: ${instructionsPath}`, 'green');
  return true;
  } catch (e) {
  error(`✗ 生成项目指令失败: ${e.message}`);
  return false;
  }
}

// ============ 验证配置 ============

function verifyConfiguration() {
  if (skipVerify) return;

  log('\n🔍 验证配置...', 'blue');

  // 检查全局设置
  if (configGlobal) {
  const globalSettingsPath = getVSCodeSettingsPath(true);
  if (fs.existsSync(globalSettingsPath)) {
    const settings = readJsonFile(globalSettingsPath, {});
    if (settings['github.copilot.mcp'] && settings['github.copilot.mcp'].servers) {
    const hasAutosnippet = settings['github.copilot.mcp'].servers.some(
      s => s.name === 'autosnippet'
    );
    if (hasAutosnippet) {
      log(`✅ VSCode 全局 MCP 配置验证成功`, 'green');
    } else {
      log(`⚠️  未在全局设置中找到 autosnippet MCP 服务器`, 'yellow');
    }
    } else {
    log(`⚠️  全局设置中未找到 MCP 配置`, 'yellow');
    }
  }
  }

  // 检查工作区设置
  if (configWorkspace) {
  const workspaceSettingsPath = getVSCodeSettingsPath(false);
  if (fs.existsSync(workspaceSettingsPath)) {
    const settings = readJsonFile(workspaceSettingsPath, {});
    if (settings['github.copilot.mcp'] && settings['github.copilot.mcp'].servers) {
    const hasAutosnippet = settings['github.copilot.mcp'].servers.some(
      s => s.name === 'autosnippet'
    );
    if (hasAutosnippet) {
      log(`✅ VSCode 工作区 MCP 配置验证成功`, 'green');
    } else {
      log(`⚠️  未在工作区设置中找到 autosnippet MCP 服务器`, 'yellow');
    }
    }
  }
  }

  // 检查推荐扩展
  const extensionsPath = path.join(projectPath, '.vscode/extensions.json');
  if (fs.existsSync(extensionsPath)) {
  log(`✅ 推荐扩展配置存在`, 'green');
  }

  // 检查项目指令
  const instructionsPath = path.join(projectPath, '.github/copilot-instructions.md');
  if (fs.existsSync(instructionsPath)) {
  log(`✅ 项目指令存在`, 'green');
  }
}

// ============ 提供快速启动指导 ============

function printQuickStart() {
  log('\n' + '='.repeat(60), 'blue');
  log('🎉 VSCode Copilot 配置完成！', 'green');
  log('='.repeat(60), 'blue');

  log('\n⚡ 3 步快速启动：\n', 'blue');

  log('1️⃣  启动 Dashboard');
  log('   $ asd ui', 'yellow');
  log('   确认输出: ✓ Server running on http://localhost:3000\n');

  log('2️⃣  重启 VSCode');
  log('   $ code -r\n');

  log('3️⃣  在 VSCode Copilot Chat 中测试');
  log('   ⌘+⇧+I 打开 Copilot Chat');
  log('   输入: @autosnippet search async', 'yellow');
  log('   预期: 返回 async/await 代码片段\n');

  log('📚 可用命令：\n', 'blue');
  log('   @autosnippet search <关键词>      # 代码搜索');
  log('   @autosnippet recipes list          # 查看 Recipe');
  log('   @autosnippet create                # 创建 Recipe');
  log('   @autosnippet guard                 # 代码审查');
  log('   @autosnippet when <场景>           # 决策辅助\n');

  log('📖 项目指令位置：');
  log(`   ${path.join(projectPath, '.github/copilot-instructions.md')}`, 'yellow');

  log('\n📝 配置位置：');
  if (configGlobal) {
  log(`   全局: ${getVSCodeSettingsPath(true)}`, 'yellow');
  }
  if (configWorkspace) {
  log(`   工作区: ${getVSCodeSettingsPath(false)}`, 'yellow');
  }

  log('\n💡 提示：');
  log('   - 首次配置需要重启 VSCode');
  log('   - MCP 服务器需要 Node.js 18.0+');
  log('   - Dashboard 运行在 http://localhost:3000');
  log('   - 可在 VSCode 设置中搜索 "copilot.mcp" 查看配置\n');

  log('='.repeat(60) + '\n', 'blue');
}

// ============ 主程序 ============

async function main() {
  log('\n🚀 AutoSnippet VSCode Copilot 安装程序', 'blue');
  log(`📍 项目路径: ${projectPath}\n`, 'blue');

  const results = {
  settings: false,
  extensions: false,
  instructions: false
  };

  // 配置 settings.json
  results.settings = configureVSCodeSettings();

  // 创建推荐扩展配置
  results.extensions = createExtensionsJson();

  // 生成项目指令
  results.instructions = createCopilotInstructions();

  // 验证配置
  verifyConfiguration();

  // 提供快速启动指导
  printQuickStart();

  // 返回状态
  const allSuccess = Object.values(results).every(v => v);
  if (allSuccess) {
  log('✅ 所有配置完成！', 'green');
  process.exit(0);
  } else {
  log('⚠️  部分配置可能未完成，请检查上述消息', 'yellow');
  process.exit(1);
  }
}

// 运行
main().catch(err => {
  error(`✗ 配置失败: ${err.message}`);
  process.exit(1);
});
