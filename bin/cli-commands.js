#!/usr/bin/env node

/**
 * 职责：
 * - AutoSnippet CLI 命令注册
 * - 负责解析参数/路由子命令，并串联 setup/install/create/extract/watch 等能力
 */

const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const commander = require('commander');
const { execSync } = require('child_process');
const findPath = require('../lib/infrastructure/paths/PathFinder');
const install = require('../lib/snippet/snippetInstaller.js');
const create = require('./create-snippet.js');
const watch = require('../lib/watch/fileWatcher.js');
const cache = require('../lib/infrastructure/cache/CacheStore.js');
const pjson = require('../package.json');
const swiftParserClient = require('../lib/infrastructure/external/spm/swiftParserClient');

function registerCommands(cmd, ctx) {
  const { CMD_PATH, findPath, install, create, watch, cache, helpers, inquirer, fs, execSync, pjson, spmDepMapUpdater } = ctx;

  // 配置 version 选项
  cmd.version(pjson.version, '-v, --version', 'output the current version');

  function getSpecFile(callback) {
  findPath.findASSpecPath(CMD_PATH, callback);
  }

  function getGlobalOptions() {
  try {
    const opts = cmd.opts ? cmd.opts() : {};
    return {
    preset: opts.preset,
    yes: !!opts.yes,
    };
  } catch {
    return { preset: null, yes: false };
  }
  }

  function loadPresetConfig(presetPathFromCli) {
  const presetPath = presetPathFromCli || process.env.ASD_TEST_PRESET || process.env.ASD_PRESET;
  if (!presetPath) return null;
  try {
    const content = fs.readFileSync(presetPath, 'utf8');
    if (!content) return null;
    return JSON.parse(content);
  } catch (err) {
    console.warn(`⚠️ 读取预置输入失败: ${presetPath}`);
    return null;
  }
  }

  // 标准 Recipe 文档所在目录（asd setup 时复制到项目 AutoSnippet/recipes/）
  const SETUP_RECIPES_TEMPLATE_DIR = path.join(__dirname, '..', 'templates', 'recipes-setup');
  const SETUP_RECIPE_FILES = ['README.md', 'example.md', '_template.md'];

  // setup 命令 - 一键初始化，自动完成所有工作
  cmd
  .command('setup')
  .description('one-shot setup: auto-initialize workspace and install dependencies')
  .action(async () => {
    console.log('🚀 开始初始化工作空间...\n');
    
    const projectRoot = CMD_PATH;
    const autosnippetDir = path.join(projectRoot, 'AutoSnippet');
    const specFilePath = path.join(autosnippetDir, 'AutoSnippet.boxspec.json');
    const recipesDir = path.join(autosnippetDir, 'recipes');
    
    // Step 1: 创建配置文件
    console.log('📝 步骤 1/4：创建配置文件...');
    try {
    if (!fs.existsSync(autosnippetDir)) {
      fs.mkdirSync(autosnippetDir, { recursive: true });
    }
    if (!fs.existsSync(specFilePath)) {
      const projectName = path.basename(projectRoot);
      const spec = {
      name: projectName,
      knowledgeBase: {
        dir: 'AutoSnippet'
      }
      };
      fs.writeFileSync(specFilePath, JSON.stringify(spec, null, 2), 'utf8');
      console.log(`✅ 已创建 ${specFilePath}\n`);
    } else {
      console.log('ℹ️  配置文件已存在，跳过\n');
    }
    } catch (err) {
    console.error(`❌ 创建配置文件失败：${err.message}\n`);
    return;
    }
    
    // Step 2: 创建目录结构
    console.log('📁 步骤 2/4：创建目录结构...');
    try {
    if (!fs.existsSync(recipesDir)) {
      fs.mkdirSync(recipesDir, { recursive: true });
      console.log(`✅ 已创建 ${recipesDir}\n`);
    } else {
      console.log('ℹ️  目录已存在，跳过\n');
    }
    } catch (err) {
    console.error(`❌ 创建目录失败：${err.message}\n`);
    return;
    }
    
    // Step 3: 放置标准 Recipe 文档（从仓库 templates/recipes-setup/ 复制到项目 recipes/）
    console.log('📖 步骤 3/4：放置 Recipe 标准文档...');
    if (!fs.existsSync(SETUP_RECIPES_TEMPLATE_DIR)) {
    console.log('ℹ️  未找到模板目录 templates/recipes-setup/，跳过\n');
    } else {
    for (const name of SETUP_RECIPE_FILES) {
      const src = path.join(SETUP_RECIPES_TEMPLATE_DIR, name);
      const dest = path.join(recipesDir, name);
      if (!fs.existsSync(src)) continue;
      if (fs.existsSync(dest)) {
      console.log(`ℹ️  ${name} 已存在，跳过\n`);
      continue;
      }
      try {
      fs.copyFileSync(src, dest);
      console.log(`✅ 已放置 ${name}\n`);
      } catch (err) {
      console.warn(`⚠️  放置 ${name} 失败：${err.message}\n`);
      }
    }
    }
    
    // Step 4: 安装依赖和配置工具链
    console.log('🔧 步骤 4/5：安装依赖和配置工具链...\n');
  
  // 查找 asd 安装位置（全局或本地）
  let asdPath;
  try {
    asdPath = execSync('which asd', { encoding: 'utf8' }).trim();
  } catch {
    asdPath = path.join(__dirname, 'asd');
  }
  const asdDir = path.dirname(path.dirname(asdPath)); // asd -> bin -> root
  const mcpServerPath = path.join(asdDir, 'scripts/mcp-server.js');
  
  const tasks = [
    { name: 'npm', label: 'npm 依赖', fn: () => {
    try {
      execSync('npm install', { stdio: 'inherit', cwd: projectRoot });
    } catch (err) {
      // npm install 失败不影响其他步骤
    }
    }},
    { name: 'vscode', label: 'VSCode MCP', fn: () => {
    // 创建工作区 MCP 配置
    const vscodeDir = path.join(projectRoot, '.vscode');
    const settingsPath = path.join(vscodeDir, 'settings.json');
    
    if (!fs.existsSync(vscodeDir)) {
      fs.mkdirSync(vscodeDir, { recursive: true });
    }
    
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      } catch {}
    }
    
    if (!settings['github.copilot.mcp']) {
      settings['github.copilot.mcp'] = {};
    }
    if (!settings['github.copilot.mcp'].servers) {
      settings['github.copilot.mcp'].servers = [];
    }
    
    const existingIndex = settings['github.copilot.mcp'].servers.findIndex(
      s => s.name === 'autosnippet'
    );
    
    const mcpConfig = {
      name: 'autosnippet',
      command: 'node',
      args: [mcpServerPath],
      env: {
      ASD_UI_URL: 'http://localhost:3000'
      }
    };
    
    if (existingIndex >= 0) {
      settings['github.copilot.mcp'].servers[existingIndex] = mcpConfig;
    } else {
      settings['github.copilot.mcp'].servers.push(mcpConfig);
    }
    
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    }},
    { name: 'cursor', label: 'Cursor MCP', fn: () => {
    const cursorDir = path.join(projectRoot, '.cursor');
    const cursorConfigPath = path.join(cursorDir, 'mcp.json');
    
    if (!fs.existsSync(cursorDir)) {
      fs.mkdirSync(cursorDir, { recursive: true });
    }
    
    const config = {
      mcpServers: {
      autosnippet: {
        command: 'node',
        args: [mcpServerPath],
        env: {
        ASD_UI_URL: 'http://localhost:3000'
        }
      }
      }
    };
    
    fs.writeFileSync(cursorConfigPath, JSON.stringify(config, null, 2), 'utf8');
    }}
  ];
  
  const total = tasks.length;
    for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    console.log(`  📦 ${task.label}...`);
    try {
      await task.fn();
    } catch (err) {
      console.warn(`  ⚠️  ${task.label}失败: ${err.message}，继续...\n`);
    }
    }
    
    // Step 5: 生成 spmmap（依赖 Swift 解析器）
    console.log('🧭 步骤 5/5：生成依赖图 AutoSnippet.spmmap.json...');
    const parserBin = swiftParserClient.getParserBin(projectRoot);
    if (!parserBin) {
    console.warn('⚠️ 未检测到 Swift 解析器（ParsePackage），已跳过 spmmap 生成。');
    console.warn('   请先安装解析器：asd install:full --parser');
    console.warn('   安装完成后请重新执行：asd setup\n');
    } else {
    try {
      const result = await spmDepMapUpdater.updateSpmDepMap(projectRoot, {
      aggressive: true,
      requireParser: true
      });
      if (result && result.ok) {
      console.log('✅ spmmap 已生成/更新\n');
      } else if (result && result.reason === 'parserMissing') {
      console.warn('⚠️ 未检测到 Swift 解析器（ParsePackage），已跳过 spmmap 生成。');
      console.warn('   请先安装解析器：asd install:full --parser');
      console.warn('   安装完成后请重新执行：asd setup\n');
      } else {
      console.warn('⚠️ spmmap 生成失败，请检查 Package.swift 或解析器状态\n');
      }
    } catch (err) {
      console.warn(`⚠️ spmmap 生成失败：${err.message}\n`);
    }
    }

    console.log('\n========================================');
    console.log('✅ 工作空间初始化完成！');
    console.log('========================================\n');
    console.log('� 配置文件: AutoSnippet/AutoSnippet.boxspec.json');
    console.log('📁 Recipe 目录: AutoSnippet/recipes/');
    console.log('⚙️  VSCode MCP: .vscode/settings.json');
    console.log('⚙️  Cursor MCP: .cursor/mcp.json\n');
    
    // Step 6: 初始化 Xcode Snippets（仅在 macOS）
    if (process.platform === 'darwin') {
    console.log('🚀 步骤 6/6：初始化 Xcode Snippets...');
    try {
      const { initialize: initXcodeSnippets } = require('../scripts/init-xcode-snippets.js');
      const success = await initXcodeSnippets();
      if (success) {
      console.log('✅ Xcode Snippets 已添加\n');
      }
    } catch (err) {
      console.warn(`⚠️  Xcode Snippets 初始化失败：${err.message}`);
      console.warn('   可稍后手动运行：npm run init:snippets\n');
    }
    }
    
    console.log('🎯 后续步骤：');
    console.log('  1. 重启编辑器 (VSCode/Cursor/Xcode)');
    console.log('  2. 测试 MCP: @autosnippet search');
    console.log('  3. 在 Xcode 中输入 "ass" 尝试 Snippet');
    console.log('  4. 启动面板: asd ui\n');
  });



  // install 命令
  cmd
  .command('install')
  .alias('i')
  .description('install AutoSnippet dependencies, skills, and MCP servers')
  .action(async () => {
    console.log('🔧 安装 AutoSnippet 环境...\n');
    
    const tasks = [
    { name: 'npm', label: 'npm 依赖', fn: () => execSync('npm install', { stdio: 'inherit', cwd: CMD_PATH }) },
    { name: 'vscode', label: 'VSCode Copilot', fn: async () => {
      const vscodeInstaller = require('../scripts/install-vscode-copilot.js');
      if (typeof vscodeInstaller === 'function') await vscodeInstaller();
    }},
    { name: 'skills', label: 'Cursor Skills', fn: async () => {
      const installer = require('../scripts/install-cursor-skill.js');
      if (typeof installer === 'function') await installer();
    }},
    { name: 'MCP', label: 'Cursor MCP 服务', fn: async () => {
      const setup = require('../scripts/setup-mcp-config.js');
      if (typeof setup === 'function') await setup();
    }}
    ];
    
    const total = tasks.length;
    for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    console.log(`📦 步骤 ${i + 1}/${total}：安装 ${task.label}...`);
    try {
      await task.fn();
      console.log(`✅ ${task.label}安装完成\n`);
    } catch (err) {
      console.warn(`⚠️  ${task.label}安装失败，继续...\n`);
    }
    }
    
    console.log('✅ AutoSnippet 安装完成！');
  });

  // install:cursor-skill 命令 - 仅安装 Cursor Skills（及 MCP 可选）
  cmd
  .command('install:cursor-skill')
  .option('--mcp', 'also install MCP configuration')
  .description('install Cursor Skills and optionally MCP configuration')
  .action(async (options) => {
    try {
    // 动态执行 install-cursor-skill.js 脚本，确保使用当前项目的上下文
    const { execSync } = require('child_process');
    const installerPath = path.join(__dirname, '..', 'scripts', 'install-cursor-skill.js');
    const args = options.mcp ? ' --mcp' : '';
    execSync(`node "${installerPath}"${args}`, { 
      stdio: 'inherit',
      cwd: CMD_PATH  // 使用 CMD_PATH（用户实际的工作目录），而不是 process.cwd()
    });
    } catch (err) {
    console.error('❌ 安装失败：', err.message);
    process.exit(1);
    }
  });

  // extract 命令
  cmd
  .command('extract')
  .alias('e')
  .description('sync snippets from project spec to Xcode (same as web "Sync to Xcode")')
  .action(async () => {
    console.log('🔄 同步 snippets 到 Xcode...');
    
    // 查找 boxspec.json
    const specFile = await findPath.findASSpecPathAsync(CMD_PATH);
    if (!specFile) {
    console.error('❌ 同步失败：未找到 AutoSnippet.boxspec.json 配置文件');
    return;
    }
    
    try {
    const result = install.addCodeSnippets(specFile);
    if (result && result.success) {
      console.log('✅ 已同步到 Xcode CodeSnippets');
    } else {
      console.error('❌ 同步失败：', result?.error || '未知错误');
    }
    } catch (err) {
    console.error('❌ 同步失败：', err.message);
    }
  });

  // create 命令
  cmd
  .command('create')
  .alias('c')
  .option('-ai', '--use-ai', 'use AI to create snippet')
  .description('create an Xcode Snippet, in the file directory marked with `// autosnippet:code`')
  .action(async (options) => {
    const { preset: presetPath, yes } = getGlobalOptions();
    const preset = loadPresetConfig(presetPath);
    const createPreset = preset && preset.create;

    getSpecFile(async function (specFile) {
    if (!specFile) {
      console.error('❌ 创建失败：未找到 AutoSnippet.boxspec.json 配置文件');
      return;
    }

    if (createPreset) {
      const ok = await create.createCodeSnippetsWithPreset(specFile, createPreset);
      if (!ok) {
      console.error('❌ 预置创建失败，请检查 create 预置输入和本地 snippet 文件。');
      }
      return;
    }

    if (yes) {
      console.error('❌ create 在 --yes 模式下需要预置输入。');
      console.error('请使用：asd --preset <preset.json> create');
      return;
    }

    const useAi = options.useAi || false;
    // 项目根 = 知识库目录的父级，避免把知识库当项目根导致后续创建 根目录/AutoSnippet/AutoSnippet
    const projectRoot = findPath.findProjectRootSync(path.dirname(specFile)) || path.dirname(specFile);
    await helpers.findAndAsk(specFile, projectRoot, useAi);
    });
  });

  // update 命令
  cmd
  .command('update')
  .alias('u')
  .arguments('<word> [key] [value]')
  .description('modify the snippet corresponding to `word`')
  .action((word, key, value) => {
    const updates = { word, key, value };
    getSpecFile(function (specFile) {
    if (!specFile) {
      console.error('❌ 更新失败：未找到 AutoSnippet.boxspec.json 配置文件');
      return;
    }
    create.updateCodeSnippets(specFile, updates);
    });
  });

  // watch 命令
  cmd
  .command('watch')
  .alias('w')
  .option('-s, --skip-spm', 'skip SPM scanning')
  .description('recognize that Snippet automatically injects dependency header files')
  .action((options) => {
    // 使用异步版本来确保得到结果或超时
    const timeoutId = setTimeout(() => {
    console.error('❌ 未找到 AutoSnippet.boxspec.json 配置文件');
    console.error('   请在包含 AutoSnippet.boxspec.json 的目录或其子目录中运行此命令');
    console.error('   或使用 asd init 初始化项目');
    process.exit(1);
    }, 3000);

    getSpecFile(function (specFile) {
    clearTimeout(timeoutId);
    if (!specFile) {
      console.error('❌ Watch 启动失败：未找到 AutoSnippet.boxspec.json 配置文件');
      process.exit(1);
    }
    const args = {
      skipSpm: options.skipSpm || false,
      projectRoot: CMD_PATH,
    };
    watch.watchFileChange(specFile, CMD_PATH, args);
    });
  });

  // spm-map 命令
  cmd
  .command('spm-map')
  .alias('spmmap')
  .option('-a, --aggressive', 'aggressive scan')
  .description('update AutoSnippet.spmmap.json by scanning Package.swift files')
  .action(async (options) => {
    const spmDepMapUpdater = require('../lib/spm/spmDepMapUpdater.js');
    try {
    const result = await spmDepMapUpdater.updateSpmDepMap(CMD_PATH, {
      aggressive: options.aggressive || false
    });
    if (result && result.success) {
      console.log('✅ SPM 映射已更新');
    } else {
      console.error('❌ SPM 映射更新失败');
    }
    } catch (err) {
    console.error('❌ 更新失败：', err.message);
    }
  });

  // ui 命令 - 启动 Dashboard Web 界面（自动包含 watch 功能）
  cmd
  .command('ui')
  .option('-p, --port <port>', 'specify port (default: 3000)', '3000')
  .option('--no-open', 'do not open browser automatically')
  .option('-b, --force-build', 'force rebuild dashboard frontend')
  .option('-d, --dir <directory>', 'specify AutoSnippet project directory (default: current directory)')
  .description('start AutoSnippet Dashboard web interface (includes file watcher)')
  .action(async (options) => {
    const ui = ctx.ui;
    if (!ui || typeof ui.launch !== 'function') {
    console.error('❌ Dashboard 模块加载失败');
    return;
    }
    
    try {
    const port = parseInt(options.port, 10);
    // 使用 -d 选项指定的目录，或 ASD_CWD 环境变量，或当前目录
    const projectRoot = options.dir || process.env.ASD_CWD || CMD_PATH;
    
    // 提示用户 watch 功能已包含
    const isDebugMode = process.env.ASD_DEBUG_WATCH === '1' || process.env.ASD_DEBUG_SEARCH === '1';
    if (isDebugMode) {
      console.log('💡 调试模式已启用，将显示文件监听日志');
    }
    
    await ui.launch(projectRoot, port, {
      forceBuild: options.forceBuild || false,
      openBrowser: options.open !== false,
    });
    } catch (err) {
    console.error('❌ Dashboard 启动失败：', err.message);
    }
  });

  // status 命令 - 环境自检
  cmd
  .command('status')
  .description('check AutoSnippet environment (project root, AI, index, Dashboard, Native UI)')
  .action(async () => {
    const { runStatus } = require('../lib/cli/statusCommand');
    const projectRoot = CMD_PATH;
    await runStatus(projectRoot);
  });

  // search 命令 - 搜索知识库
  cmd
  .command('search <keyword>')
  .alias('s')
  .option('--copy', 'copy first result to clipboard')
  .option('--pick', 'interactive selection')
  .option('-m, --semantic', 'use semantic search (requires embed)')
  .option('--without-agent', 'disable intelligent agent enhancement')
  .option('--session <id>', 'specify session ID for agent personalization')
  .description('search Recipes and Snippets')
  .action(async (keyword, options) => {
    const { runSearch } = require('../lib/cli/searchCommand');
    const projectRoot = CMD_PATH;
    await runSearch(projectRoot, keyword, options);
  });

  // embed 命令 - 构建语义索引
  cmd
  .command('embed')
  .option('--clear', 'clear and rebuild index')
  .description('build semantic vector index for Recipes')
  .action(async (options) => {
    const { runEmbed } = require('../lib/cli/embedCommand');
    const projectRoot = CMD_PATH;
    await runEmbed(projectRoot, options);
  });

  // candidate 命令 - 从剪贴板创建候选
  cmd
  .command('candidate')
  .option('-t, --title <title>', 'candidate title')
  .option('-c, --category <category>', 'candidate category')
  .description('create candidate from clipboard')
  .action(async (options) => {
    const { runCandidate } = require('../lib/cli/candidateCommand');
    const projectRoot = CMD_PATH;
    await runCandidate(projectRoot, options);
  });

  // install:full 命令 - 全量安装
  cmd
  .command('install:full')
  .option('--parser', 'install Swift parser')
  .description('install all optional dependencies')
  .action(async (options) => {
    const { execSync } = require('child_process');
    const path = require('path');
    const rootDir = path.join(__dirname, '..');
    const scriptPath = path.join(rootDir, 'scripts/install-full.js');
    
    const env = { ...process.env };
    if (options.parser) env.ASD_INSTALL_PARSER = '1';
    
    try {
    execSync(`node "${scriptPath}"`, { 
      stdio: 'inherit',
      env,
      cwd: rootDir
    });
    } catch (err) {
    console.error('❌ 安装失败');
    process.exit(1);
    }
  });

  cmd.addHelpText('after', `

Examples:
  asd setup               # 初始化工作空间
  asd status              # 环境自检
  asd install             # 安装依赖/skills/MCP
  asd extract             # 同步 snippets 到 Xcode
  asd create              # 创建 snippet
  asd watch               # 监听文件变化（单独运行）
  asd ui                  # 启动 Dashboard（自动包含 watch）
  asd search <keyword>    # 搜索知识库
  asd embed               # 构建语义索引
  asd candidate           # 从剪贴板创建候选

Advanced:
  asd ui -d /path/to/AutoSnippet  # 启动 Dashboard，操作指定项目
  asd install:full --parser       # 全量安装 + Swift 解析器

Debug modes:
  ASD_DEBUG_WATCH=1 asd ui         # Dashboard + 文件监听日志
  ASD_DEBUG_SEARCH=1 asd ui        # Dashboard + 搜索调试日志

Notes:
  - 老命令仍可用：i/c/e/u/w/s 只是别名，不会破坏现有脚本。
  - 在非 AutoSnippet 目录中，使用 -d 或 ASD_CWD 环境变量指定项目路径。
`);
}

module.exports = { registerCommands };
