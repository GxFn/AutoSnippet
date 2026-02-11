#!/usr/bin/env node

/**
 * AutoSnippet V2 CLI
 * 
 * Usage:
 *   asd setup           - 初始化项目
 *   asd ais [Target]    - AI 扫描 Target → Candidates
 *   asd search <query>  - 搜索知识库
 *   asd guard <file>    - Guard 检查
 *   asd watch           - 文件监控
 *   asd compliance      - 合规评估
 *   asd server          - 启动 API 服务
 *   asd status          - 环境状态
 *   asd ui              - 启动 Dashboard UI
 */

import { Command } from 'commander';
import { readFileSync, existsSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkgPath = join(__dirname, '..', 'package.json');
const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : { version: '2.0.0' };

const program = new Command();
program
  .name('asd')
  .description('AutoSnippet V2 - AI 知识库管理工具')
  .version(pkg.version);

// ─────────────────────────────────────────────────────
// setup 命令
// ─────────────────────────────────────────────────────
program
  .command('setup')
  .description('初始化项目工作空间：目录结构、数据库、IDE 集成、模板')
  .option('-d, --dir <path>', '项目目录', '.')
  .option('--force', '强制覆盖已有配置')
  .option('--seed', '预置示例 Recipe（冷启动推荐）')
  .action(async (opts) => {
    const { SetupService } = await import('../lib/cli/SetupService.js');
    const service = new SetupService({ projectRoot: resolve(opts.dir), force: opts.force, seed: opts.seed });

    console.log(`\n🚀 AutoSnippet V2 — 初始化工作空间`);
    console.log(`   项目: ${service.projectName}`);
    console.log(`   路径: ${service.projectRoot}\n`);

    await service.run();
    service.printSummary();
  });

// ─────────────────────────────────────────────────────
// ais 命令 (AI Scan)
// ─────────────────────────────────────────────────────
program
  .command('ais [target]')
  .description('AI 扫描 Target 源码 → 提取 Candidates（需配置 AI Provider）')
  .option('-d, --dir <path>', '项目目录', '.')
  .option('-m, --max-files <n>', '最大扫描文件数', '200')
  .option('--dry-run', '仅预览，不创建 Candidate')
  .option('--json', '以 JSON 格式输出')
  .action(async (target, opts) => {
    const projectRoot = resolve(opts.dir);
    console.log(`\n🔬 AutoSnippet AI Scan`);
    console.log(`   项目: ${basename(projectRoot)}`);
    if (target) console.log(`   Target: ${target}`);
    console.log(`   最大文件数: ${opts.maxFiles}`);
    if (opts.dryRun) console.log('   模式: dry-run（仅预览）');
    console.log('');

    try {
      const { bootstrap, container } = await initContainer({ projectRoot });

      const { AiScanService } = await import('../lib/cli/AiScanService.js');
      const scanner = new AiScanService({ container, projectRoot });

      const ora = (await import('ora')).default;
      const spinner = ora('正在扫描源文件并提取候选...').start();

      const report = await scanner.scan(target || null, {
        maxFiles: parseInt(opts.maxFiles, 10),
        dryRun: opts.dryRun,
      });

      spinner.stop();

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`\n✅ AI 扫描完成`);
        console.log(`   扫描文件: ${report.files}`);
        console.log(`   跳过: ${report.skipped}`);
        console.log(`   提取候选: ${report.candidates}`);
        if (report.errors.length > 0) {
          console.log(`\n⚠️  ${report.errors.length} 个错误：`);
          for (const err of report.errors.slice(0, 10)) {
            console.log(`   - ${err}`);
          }
          if (report.errors.length > 10) console.log(`   ... 及其他 ${report.errors.length - 10} 个`);
        }
        if (!opts.dryRun && report.candidates > 0) {
          console.log(`\n📋 候选已创建，请运行 asd ui 打开 Dashboard 审核`);
        }
      }

      await bootstrap.shutdown();
    } catch (err) {
      console.error(`\n❌ ${err.message}`);
      if (process.env.ASD_DEBUG === '1') console.error(err.stack);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────
// search 命令
// ─────────────────────────────────────────────────────
program
  .command('search <query>')
  .description('搜索知识库')
  .option('-t, --type <type>', '搜索类型: all, recipe, solution, rule', 'all')
  .option('-m, --mode <mode>', '搜索模式: keyword, bm25, semantic', 'bm25')
  .option('-l, --limit <n>', '结果数量', '10')
  .action(async (query, opts) => {
    try {
      const { bootstrap, container } = await initContainer();
      const engine = container.get('searchEngine');
      const results = await engine.search(query, {
        type: opts.type,
        mode: opts.mode,
        limit: parseInt(opts.limit, 10),
      });

      if (results.items.length === 0) {
        console.log('No results found.');
      } else {
        console.log(`\n🔍 Found ${results.total} results (${results.mode} mode):\n`);
        for (const item of results.items) {
          const badge = item.type === 'recipe' ? '📘' : item.type === 'solution' ? '💡' : '🛡️';
          const score = item.score ? ` [${item.score}]` : '';
          console.log(`  ${badge} ${item.title || item.id}${score}`);
          if (item.description) console.log(`     ${item.description.slice(0, 80)}`);
        }
      }

      await bootstrap.shutdown();
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────
// guard 命令
// ─────────────────────────────────────────────────────
program
  .command('guard <file>')
  .description('对文件运行 Guard 规则检查')
  .option('-s, --scope <scope>', '审查维度: file, target, project', 'file')
  .option('--json', '以 JSON 格式输出')
  .action(async (file, opts) => {
    try {
      const filePath = resolve(file);
      if (!existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
      }

      const code = readFileSync(filePath, 'utf8');
      const { bootstrap, container } = await initContainer();

      const { detectLanguage } = await import('../lib/service/guard/GuardCheckEngine.js');
      const engine = container.get('guardCheckEngine');
      const language = detectLanguage(filePath);
      const violations = engine.checkCode(code, language, { scope: opts.scope });

      if (opts.json) {
        console.log(JSON.stringify({ file: filePath, language, violations }, null, 2));
      } else if (violations.length === 0) {
        console.log(`✅ No violations found in ${file} (${language})`);
      } else {
        const errors = violations.filter(v => v.severity === 'error');
        const warnings = violations.filter(v => v.severity === 'warning');
        console.log(`\n🛡️  ${file} (${language}): ${violations.length} violations`);
        console.log(`   ${errors.length} errors, ${warnings.length} warnings\n`);
        for (const v of violations) {
          const icon = v.severity === 'error' ? '❌' : '⚠️';
          console.log(`  ${icon} L${v.line} [${v.ruleId}] ${v.message}`);
          if (v.snippet) console.log(`     ${v.snippet}`);
        }
      }

      await bootstrap.shutdown();
      process.exit(violations.some(v => v.severity === 'error') ? 1 : 0);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────
// watch 命令
// ─────────────────────────────────────────────────────
program
  .command('watch')
  .description('启动文件监控（支持 // as:c、// as:s、// as:a 等指令）')
  .option('-d, --dir <path>', '监控目录', '.')
  .option('-e, --ext <exts>', '文件扩展名（逗号分隔）', '.swift,.m,.h')
  .option('--guard', '自动运行 Guard 检查', true)
  .action(async (opts) => {
    try {
      const dir = resolve(opts.dir);
      console.log(`👁️  Watching ${dir} for changes...`);
      console.log(`   Extensions: ${opts.ext}`);
      console.log(`   Directives: // as:c (create), // as:s (search), // as:a (audit)`);
      console.log('   Press Ctrl+C to stop\n');

      let bootstrap;
      try {
        const result = await initContainer({ projectRoot: dir });
        bootstrap = result.bootstrap;
      } catch {
        // ServiceContainer 初始化失败不阻塞 watch（HTTP fallback 仍可用）
        bootstrap = await initBootstrap();
      }

      const Paths = await import('../lib/infrastructure/config/Paths.js');
      const specPath = Paths.getProjectSpecPath(dir);

      const { FileWatcher } = await import('../lib/service/automation/FileWatcher.js');
      const exts = opts.ext.split(',').map(e => e.trim());
      const watcher = new FileWatcher(specPath, dir, {
        quiet: false,
        exts,
      });
      watcher.start();

      // 优雅退出
      process.on('SIGINT', async () => {
        console.log('\n🛑 Stopping watcher...');
        await watcher.stop();
        await bootstrap.shutdown();
        process.exit(0);
      });
    } catch (err) {
      console.error('Error:', err.message);
      if (process.env.ASD_DEBUG === '1') console.error(err.stack);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────
// compliance 命令
// ─────────────────────────────────────────────────────
program
  .command('compliance')
  .description('运行合规评估')
  .option('--json', '以 JSON 格式输出')
  .action(async (opts) => {
    try {
      const { bootstrap, container } = await initContainer();
      const complianceEvaluator = container.get('complianceEvaluator');

      if (!complianceEvaluator) {
        console.error('ComplianceEvaluator not available');
        process.exit(1);
      }

      const report = complianceEvaluator.evaluate();

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log('\n📊 Compliance Report\n');
        console.log(`   Overall Score: ${(report.overallScore * 100).toFixed(1)}%`);
        console.log(`   Grade: ${report.grade || 'N/A'}\n`);

        for (const [key, metric] of Object.entries(report.priorities || {})) {
          const pct = ((metric.score || 0) * 100).toFixed(1);
          console.log(`   ${key}: ${pct}%`);
        }

        if (report.recommendations?.length) {
          console.log('\n   Recommendations:');
          for (const rec of report.recommendations.slice(0, 5)) {
            console.log(`   • ${rec}`);
          }
        }
      }

      await bootstrap.shutdown();
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────
// server 命令
// ─────────────────────────────────────────────────────
program
  .command('server')
  .description('启动 API 服务器')
  .option('-p, --port <port>', '端口', '3000')
  .option('-H, --host <host>', '绑定地址', '127.0.0.1')
  .action(async (opts) => {
    console.log(`🚀 Starting AutoSnippet V2 API server on ${opts.host}:${opts.port}...`);
    // 设置环境变量后启动 api-server
    process.env.PORT = opts.port;
    process.env.HOST = opts.host;
    await import('./api-server.js');
  });

// ─────────────────────────────────────────────────────
// ui 命令 (Dashboard)
// ─────────────────────────────────────────────────────
program
  .command('ui')
  .description('启动 Dashboard UI（API 服务 + 前端开发服务器）')
  .option('-p, --port <port>', 'API 服务端口', '3000')
  .option('-b, --browser', '自动打开浏览器')
  .option('--no-open', '禁止自动打开浏览器（CI/CD 环境适用）')
  .option('-d, --dir <directory>', '指定 AutoSnippet 项目目录（默认：当前目录）')
  .option('--api-only', '仅启动 API 服务（不启动前端）')
  .action(async (opts) => {
    const { spawn } = await import('child_process');

    // 项目根目录：-d 选项 > 环境变量 ASD_CWD > 当前目录
    const projectRoot = opts.dir || process.env.ASD_CWD || process.cwd();
    console.log(`📂 Project root: ${projectRoot}`);

    // 1. 内联启动 API Server（不用 import api-server.js，避免其 process.exit 影响整个进程）
    console.log(`🚀 Starting API server on port ${opts.port}...`);
    const port = opts.port;
    const host = '127.0.0.1';
    process.env.PORT = port;
    process.env.HOST = host;

    try {
      const { default: HttpServer } = await import('../lib/http/HttpServer.js');

      const { bootstrap, container } = await initContainer({ projectRoot });

      const httpServer = new HttpServer({ port, host });
      await httpServer.initialize();
      await httpServer.start();

      console.log(`✅ API server running at http://${host}:${port}`);

      // 3. 启动文件监听器（监控 // as:c // as:s // as:a 等指令）
      try {
        const Paths = await import('../lib/infrastructure/config/Paths.js');
        const specPath = Paths.getProjectSpecPath(projectRoot);
        const isDebugMode = process.env.ASD_DEBUG === '1';

        // 设置 Dashboard URL 供 watcher 跳转浏览器使用
        if (!opts.apiOnly) {
          process.env.ASD_DASHBOARD_URL = `http://localhost:5173`;
        } else {
          process.env.ASD_DASHBOARD_URL = process.env.ASD_DASHBOARD_URL || `http://${host}:${port}`;
        }

        const { FileWatcher } = await import('../lib/service/automation/FileWatcher.js');
        const watcher = new FileWatcher(specPath, projectRoot, { quiet: !isDebugMode });
        watcher.start();
        console.log(`👁️  File watcher started for: ${projectRoot}`);
        if (isDebugMode) {
          console.log(`   Spec path: ${specPath}`);
          console.log(`   Dashboard URL: ${process.env.ASD_DASHBOARD_URL}`);
        }
      } catch (watchErr) {
        console.warn(`⚠️  File watcher failed to start: ${watchErr.message}`);
        if (process.env.ASD_DEBUG === '1') {
          console.error(watchErr.stack);
        }
      }

    } catch (err) {
      console.error(`❌ API server failed to start: ${err.message}`);
      if (err.code === 'EADDRINUSE') {
        console.error(`   Port ${port} is already in use. Kill it with: lsof -ti:${port} | xargs kill -9`);
      }
      process.exit(1);
    }

    if (opts.apiOnly) {
      console.log(`   Docs: http://127.0.0.1:${port}/api-spec`);
      return;
    }

    // 2. 启动前端 Vite Dev Server
    const dashboardDir = join(__dirname, '..', 'dashboard');
    if (!existsSync(join(dashboardDir, 'node_modules'))) {
      console.log('📦 Installing dashboard dependencies...');
      const install = spawn('npm', ['install'], { cwd: dashboardDir, stdio: 'inherit' });
      await new Promise((resolve, reject) => {
        install.on('close', code => code === 0 ? resolve() : reject(new Error(`npm install exited with ${code}`)));
      });
    }

    console.log('🎨 Starting Dashboard UI...');
    const viteArgs = ['--host'];
    if (opts.browser) {
      viteArgs.push('--open');
    }
    const vite = spawn('npx', ['vite', ...viteArgs], {
      cwd: dashboardDir,
      stdio: 'inherit',
      env: { ...process.env, VITE_API_URL: `http://127.0.0.1:${port}` },
    });

    vite.on('error', (err) => {
      console.error(`❌ Vite failed to start: ${err.message}`);
    });

    process.on('SIGINT', () => {
      console.log('\n🛑 Stopping Dashboard...');
      vite.kill();
      process.exit(0);
    });
  });

// ─────────────────────────────────────────────────────
// status 命令
// ─────────────────────────────────────────────────────
program
  .command('status')
  .description('检查环境状态')
  .action(async () => {
    console.log('\n📋 AutoSnippet V2 Status\n');
    console.log(`   Version: ${pkg.version}`);
    console.log(`   Node: ${process.version}`);
    console.log(`   Platform: ${process.platform} ${process.arch}`);

    // AI 配置
    const { getAiConfigInfo } = await import('../lib/external/ai/AiFactory.js');
    const aiInfo = getAiConfigInfo();
    console.log(`\n   AI Provider: ${aiInfo.provider}`);
    console.log(`   AI Keys: ${Object.entries(aiInfo.keys).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}`);

    // 检查数据库
    const dbPath = join(process.cwd(), '.autosnippet', 'autosnippet.db');
    console.log(`\n   Database: ${existsSync(dbPath) ? '✅ ' + dbPath : '❌ Not found'}`);

    // 检查依赖
    for (const dep of ['better-sqlite3', 'commander', 'express']) {
      try {
        await import(dep);
        console.log(`   ${dep}: ✅`);
      } catch {
        console.log(`   ${dep}: ❌ not installed`);
      }
    }

    console.log('');
  });

// ─────────────────────────────────────────────────────
// upgrade 命令
// ─────────────────────────────────────────────────────
program
  .command('upgrade')
  .description('升级 IDE 集成：MCP 配置、Skills、Cursor Rules、Copilot Instructions')
  .option('-d, --dir <path>', '项目目录', '.')
  .option('--skills-only', '仅更新 Skills')
  .option('--mcp-only', '仅更新 MCP 配置')
  .action(async (opts) => {
    const { UpgradeService } = await import('../lib/cli/UpgradeService.js');
    const service = new UpgradeService({ projectRoot: resolve(opts.dir) });

    console.log(`\n🔄 AutoSnippet V2 — 升级 IDE 集成`);
    console.log(`   项目: ${service.projectName}`);
    console.log(`   路径: ${service.projectRoot}\n`);

    await service.run({
      skillsOnly: opts.skillsOnly,
      mcpOnly: opts.mcpOnly,
    });
  });

// ─────────────────────────────────────────────────────
// sync 命令
// ─────────────────────────────────────────────────────
program
  .command('sync')
  .description('增量同步 recipes/*.md + candidates/*.md → DB（.md = Source of Truth）')
  .option('-d, --dir <path>', '项目目录', '.')
  .option('--dry-run', '只报告不写入')
  .option('--force', '忽略 hash 强制覆盖')
  .action(async (opts) => {
    const projectRoot = resolve(opts.dir);
    const { SyncService } = await import('../lib/cli/SyncService.js');
    const { CandidateSyncService } = await import('../lib/cli/CandidateSyncService.js');
    const syncService = new SyncService(projectRoot);
    const candidateSyncService = new CandidateSyncService(projectRoot);

    console.log(`\n🔄 AutoSnippet V2 — 同步 recipes + candidates`);
    console.log(`   项目: ${basename(projectRoot)}`);
    console.log(`   路径: ${projectRoot}`);
    if (opts.dryRun) console.log('   模式: dry-run（仅报告）');
    console.log('');

    // 通过 Bootstrap 打开目标项目的 DB
    const dbPath = join(projectRoot, '.autosnippet', 'autosnippet.db');
    const ConfigLoader = (await import('../lib/infrastructure/config/ConfigLoader.js')).default;
    const env = process.env.NODE_ENV || 'development';
    ConfigLoader.load(env);
    ConfigLoader.set('database.path', dbPath);

    const { bootstrap, container } = await initContainer({ projectRoot });
    const db = container.get('database')?.getDb?.();
    if (!db) {
      console.error('❌ 无法打开数据库，请先运行 asd setup');
      process.exit(1);
    }

    try {
      const report = syncService.sync(db, {
        dryRun: opts.dryRun,
        force: opts.force,
      });

      // 输出报告
      console.log(`✅ Recipes 同步完成`);
      console.log(`   扫描: ${report.synced + report.skipped} 文件`);
      console.log(`   新增: ${report.created}`);
      console.log(`   更新: ${report.updated}`);
      console.log(`   跳过: ${report.skipped}`);

      if (report.violations.length > 0) {
        console.log(`\n⚠️  检测到 ${report.violations.length} 个手动编辑（已记入违规统计）：`);
        for (const v of report.violations) {
          console.log(`   - ${v}`);
        }
      }

      if (report.orphaned.length > 0) {
        console.log(`\n🗑️  ${report.orphaned.length} 个孤儿 Recipe 已标记 deprecated：`);
        for (const id of report.orphaned) {
          console.log(`   - ${id}`);
        }
      }

      // ── Candidates 同步 ──
      const cReport = candidateSyncService.sync(db, {
        dryRun: opts.dryRun,
        force: opts.force,
      });

      console.log(`\n✅ Candidates 同步完成`);
      console.log(`   扫描: ${cReport.synced + cReport.skipped} 文件`);
      console.log(`   新增: ${cReport.created}`);
      console.log(`   更新: ${cReport.updated}`);
      console.log(`   跳过: ${cReport.skipped}`);

      if (cReport.violations.length > 0) {
        console.log(`\n⚠️  检测到 ${cReport.violations.length} 个 Candidate 手动编辑：`);
        for (const v of cReport.violations) {
          console.log(`   - ${v}`);
        }
      }

      if (cReport.orphaned.length > 0) {
        console.log(`\n📋 ${cReport.orphaned.length} 个 Candidate 仅存于 DB（无 .md 文件）：`);
        for (const id of cReport.orphaned) {
          console.log(`   - ${id}`);
        }
      }

      console.log('');
    } finally {
      await bootstrap.shutdown?.();
    }
  });

// ─────────────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────────────
async function initBootstrap() {
  const { default: Bootstrap } = await import('../lib/bootstrap.js');
  const bootstrap = new Bootstrap();
  await bootstrap.initialize();
  return bootstrap;
}

/**
 * Bootstrap → ServiceContainer 统一初始化
 * 所有需要服务层的 CLI 命令共用此入口，保证依赖注入一致性
 * @param {object}  [opts]
 * @param {string}  [opts.projectRoot]  项目根目录（默认 cwd）
 * @returns {{ bootstrap, container }}
 */
async function initContainer(opts = {}) {
  const projectRoot = opts.projectRoot || process.cwd();
  const bootstrap = await initBootstrap();
  const { getServiceContainer } = await import('../lib/injection/ServiceContainer.js');
  const container = getServiceContainer();
  await container.initialize({
    db: bootstrap.components.db,
    auditLogger: bootstrap.components.auditLogger,
    gateway: bootstrap.components.gateway,
    reasoningLogger: bootstrap.components.reasoningLogger,
    roleDriftMonitor: bootstrap.components.roleDriftMonitor,
    complianceEvaluator: bootstrap.components.complianceEvaluator,
    sessionManager: bootstrap.components.sessionManager,
    projectRoot,
  });
  return { bootstrap, container };
}

program.parse(process.argv);
