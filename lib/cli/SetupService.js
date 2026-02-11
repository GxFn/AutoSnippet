/**
 * SetupService — 项目初始化服务（V2 重构版）
 *
 * 一键初始化 AutoSnippet V2 工作空间，5 步完成：
 *
 *   Step 1  .autosnippet/ 运行时目录 + config.json + .gitignore
 *   Step 2  AutoSnippet/ 子仓库（核心数据 + 权限能力）
 *   Step 3  IDE 集成（VSCode MCP + Cursor MCP + copilot-instructions + cursor-rules）
 *   Step 4  SQLite 数据库 + V1 数据迁移
 *   Step 5  平台相关初始化（macOS → Xcode Snippets）
 *
 * ═══════════════════════════════════════════════════════════
 *
 * 数据架构（核心数据在子仓库，受 git 权限保护）
 * ─────────────────────────────────────────────
 *   AutoSnippet/  (Git 子仓库 = 唯一真实来源 Source of Truth)
 *     ├─ constitution.yaml    权限宪法：角色 + 权限矩阵 + 治理规则 + 能力探测
 *     ├─ boxspec.json         项目规格定义
 *     ├─ recipes/*.md         统一知识实体（代码规范/模式/架构/调用链/数据流/...）
 *     └─ README.md
 *
 *   .autosnippet/  (运行时缓存，gitignored)
 *     ├─ config.json          项目配置
 *     ├─ autosnippet.db       SQLite 运行时缓存（从子仓库同步 + candidates/snippets/audit）
 *     ├─ context/             向量索引缓存
 *     └─ logs/                运行日志
 *
 * 数据流
 * ─────
 *   写入：编辑子仓库文件 → git push（需权限）→ asd sync → 更新 DB 缓存
 *   读取：查询 SQLite（快速索引）
 *   核心数据（统一 Recipe 实体）修改必须经过 git，普通用户无法绕过
 *
 * 权限模型（三层架构）
 * ──────────────────
 *   ① 能力层 WriteGuard  — git push --dry-run：探测子仓库写权限（物理信号）
 *   ② 角色层 Permission  — constitution.yaml 角色权限矩阵（逻辑裁决）
 *   ③ 治理层 Constitution — constitution.yaml 优先级规则引擎（业务裁决）
 *
 *   子仓库 git 权限只是"一种能力（capability）"，最终裁决权在 Constitution YAML。
 */

import {
  existsSync, mkdirSync, writeFileSync,
  readFileSync, copyFileSync, readdirSync,
} from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

/** AutoSnippet 源码仓库根目录（定位 templates/ 等资源） */
const REPO_ROOT = resolve(__dirname, '..', '..');
/** V2 子项目根目录（定位 bin/mcp-server.js 等） */
const V2_ROOT   = resolve(__dirname, '..', '..');

// ─────────────────────────────────────────────────────

export class SetupService {
  /**
   * @param {{ projectRoot: string, force?: boolean }} options
   */
  constructor(options) {
    this.projectRoot = resolve(options.projectRoot);
    this.projectName = this.projectRoot.split('/').pop();
    this.force       = options.force || false;
    this.seed        = options.seed || false;

    // 运行时目录（gitignored）
    this.runtimeDir     = join(this.projectRoot, '.autosnippet');
    this.dbPath         = join(this.runtimeDir, 'autosnippet.db');

    // 核心数据目录（子仓库）
    this.coreDir        = join(this.projectRoot, 'AutoSnippet');
    this.recipesDir     = join(this.coreDir, 'recipes');
    this.candidatesDir  = join(this.coreDir, 'candidates');
  }

  /* ═══ 公共入口 ═══════════════════════════════════════ */

  getSteps() {
    return [
      { label: '创建运行时目录与配置',     fn: () => this.stepRuntime() },
      { label: '初始化核心数据子仓库',     fn: () => this.stepCoreRepo() },
      { label: '配置 IDE 集成',           fn: () => this.stepIDE() },
      { label: '初始化数据库',            fn: () => this.stepDatabase() },
      { label: '平台相关初始化',           fn: () => this.stepPlatform() },
    ];
  }

  async run() {
    const steps = this.getSteps();
    const results = [];

    for (let i = 0; i < steps.length; i++) {
      const { label, fn } = steps[i];
      console.log(`\n[${i + 1}/${steps.length}] ${label}`);
      try {
        const r = await fn();
        results.push({ step: i + 1, label, ok: true, ...(r || {}) });
      } catch (err) {
        console.error(`   ❌ ${err.message}`);
        results.push({ step: i + 1, label, ok: false, error: err.message });
      }
    }

    console.log('');
    return results;
  }

  printSummary() {
    console.log('════════════════════════════════════════');
    console.log('✅ AutoSnippet V2 工作空间初始化完成');
    console.log('════════════════════════════════════════\n');

    console.log('📂 目录结构');
    console.log('  AutoSnippet/                核心数据 — Git 子仓库（Source of Truth）');
    console.log('    ├─ constitution.yaml      权限宪法（角色 + 能力 + 治理规则）');
    console.log('    ├─ boxspec.json           项目规格');
    console.log('    ├─ recipes/*.md           统一知识实体 ← 受 git push 保护');
    console.log('    ├─ candidates/*.md        候选代码片段 ← 受 git push 保护');
    console.log('    └─ *.json                 运行数据（统计/反馈/规则学习/排除策略）');
    console.log('  .autosnippet/               运行时缓存（gitignored）');
    console.log('    ├─ config.json            项目配置');
    console.log('    └─ autosnippet.db         SQLite 索引缓存\n');

    console.log('🔐 权限模型（三层架构）');
    console.log('  ① 能力层  git push --dry-run → 子仓库物理写权限');
    console.log('  ② 角色层  constitution.yaml  → 角色权限矩阵');
    console.log('  ③ 治理层  constitution.yaml  → 优先级规则引擎');
    console.log('  核心数据（统一 Recipe 实体）必须通过 git 修改，DB 只是缓存\n');

    console.log('📊 数据流');
    console.log('  写入: 编辑 AutoSnippet/ 文件 → git push → asd sync → DB 缓存更新');
    console.log('  读取: 查询 .autosnippet/autosnippet.db（快速索引）\n');

    console.log('🎯 后续步骤');
    console.log('  1. 团队协作 — 为子仓库添加远程仓库：');
    console.log('     cd AutoSnippet && git remote add origin <url>');
    console.log('  2. 或使用 git submodule（推荐）：');
    console.log('     rm -rf AutoSnippet');
    console.log('     git submodule add <url> AutoSnippet');
    console.log('  3. 同步子仓库数据到 DB 缓存: asd sync');
    console.log('  4. 重启编辑器（VSCode / Cursor / Xcode）');
    console.log('  5. 测试 MCP: @autosnippet search <关键词>');
    console.log('  6. 启动面板: asd ui -d .');
    if (process.platform === 'darwin') {
      console.log('  6. 在 Xcode 中输入 "ass" 尝试 Snippet');
    }
    console.log('');
  }

  /* ═══ Step 1: 运行时目录与配置 ═══════════════════════ */

  stepRuntime() {
    mkdirSync(this.runtimeDir, { recursive: true });

    // config.json
    const configPath = join(this.runtimeDir, 'config.json');
    if (existsSync(configPath) && !this.force) {
      console.log('   ℹ️  config.json 已存在，跳过');
    } else {
      const config = {
        version: 2,
        projectName: this.projectName,
        database: this.dbPath,
        core: {
          dir: 'AutoSnippet',
          constitution: 'AutoSnippet/constitution.yaml',
        },
        ai: { provider: process.env.ASD_AI_PROVIDER || 'auto' },
        guard: { enabled: true },
        watch: {
          enabled: false,
          paths: ['Sources', 'src'],
          extensions: ['.swift', '.m', '.h'],
        },
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('   ✅ .autosnippet/config.json');
    }

    // 确保 .autosnippet/ 在主仓库 .gitignore 中
    this._ensureGitignore();

    return { created: 'runtime' };
  }

  /* ═══ Step 2: 核心数据子仓库 ═════════════════════════ */

  stepCoreRepo() {
    const coreGit = join(this.coreDir, '.git');
    const alreadyRepo = existsSync(coreGit);

    // 创建目录结构
    for (const d of [this.coreDir, this.recipesDir, this.candidatesDir]) {
      mkdirSync(d, { recursive: true });
    }

    // 初始化 git（如果还不是 git 仓库）
    if (!alreadyRepo) {
      this._git(['init'], this.coreDir);
      console.log('   ✅ git init AutoSnippet/');
    } else {
      console.log('   ℹ️  AutoSnippet/ 已是 git 仓库');
    }

    // constitution.yaml — 权限宪法
    this._writeConstitution();

    // boxspec.json — 项目规格
    this._writeBoxspec();

    // recipes/_template.md — Recipe 格式参考
    this._copyRecipeTemplate();

    // seed recipes — 冷启动示例
    if (this.seed) {
      this._copySeedRecipes();
    }

    // README.md
    this._writeCoreReadme();

    // .gitignore（子仓库自身）
    const giPath = join(this.coreDir, '.gitignore');
    if (!existsSync(giPath)) {
      writeFileSync(giPath, '.DS_Store\n*.swp\n');
    }

    // 初始提交
    if (!alreadyRepo) {
      this._git(['add', '.'], this.coreDir);
      this._git(['commit', '-m', 'Init AutoSnippet knowledge base'], this.coreDir);
      console.log('   ✅ 初始提交完成（本地模式，无 remote → 允许写入）');
    }

    return { coreInit: true, alreadyRepo };
  }

  /** @private 写入 constitution.yaml（优先从模板复制） */
  _writeConstitution() {
    const dest = join(this.coreDir, 'constitution.yaml');
    if (existsSync(dest) && !this.force) {
      console.log('   ℹ️  constitution.yaml 已存在');
      return;
    }

    const tmpl = join(REPO_ROOT, 'templates', 'constitution.yaml');
    if (existsSync(tmpl)) {
      copyFileSync(tmpl, dest);
    } else {
      // 内联生成最小宪法（模板文件不可用时的 fallback）
      writeFileSync(dest, [
        '# AutoSnippet Constitution',
        'version: "2.0"',
        '',
        'capabilities:',
        '  git_write:',
        '    description: "子仓库 git push 权限"',
        '    probe: "git push --dry-run"',
        '    no_subrepo: "allow"',
        '    no_remote: "allow"',
        '    cache_ttl: 86400',
        '',
        'priorities:',
        '  - id: 1',
        '    name: "Data Integrity"',
        '    rules: ["删除操作必须有确认步骤"]',
        '  - id: 2',
        '    name: "Human Oversight"',
        '    rules: ["AI 生成的 Candidate 必须经人工审核"]',
        '',
        'roles:',
        '  - id: "developer_admin"',
        '    permissions: ["*"]',
        '    requires_capability: ["git_write"]',
        '  - id: "developer_contributor"',
        '    permissions: ["read:*", "approve:candidates", "create:recipes"]',
        '    requires_capability: ["git_write"]',
        '  - id: "cursor_agent"',
        '    permissions: ["read:recipes", "read:guard_rules", "create:candidates", "submit:candidates"]',
        '  - id: "visitor"',
        '    permissions: ["read:recipes", "read:candidates", "read:guard_rules", "search:query"]',
        '',
      ].join('\n'));
    }
    console.log('   ✅ AutoSnippet/constitution.yaml');
  }

  /** @private 写入 boxspec.json */
  _writeBoxspec() {
    const dest = join(this.coreDir, 'boxspec.json');
    if (existsSync(dest) && !this.force) {
      console.log('   ℹ️  boxspec.json 已存在');
      return;
    }

    writeFileSync(dest, JSON.stringify({
      name: this.projectName,
      schemaVersion: 2,
      kind: 'root',
      root: true,
      knowledgeBase: { dir: 'AutoSnippet' },
      module: { rootDir: 'AutoSnippet' },
    }, null, 2));
    console.log('   ✅ AutoSnippet/boxspec.json');
  }

  /** @private 复制 _template.md 到 recipes/ */
  _copyRecipeTemplate() {
    const src = join(REPO_ROOT, 'templates', 'recipes-setup', '_template.md');
    if (!existsSync(src)) return;

    const dest = join(this.recipesDir, '_template.md');
    if (existsSync(dest) && !this.force) return;
    copyFileSync(src, dest);
    console.log('   ✅ AutoSnippet/recipes/_template.md（格式参考）');
  }

  /** @private 复制示例 Recipe（冷启动推荐） */
  _copySeedRecipes() {
    const seedDir = join(REPO_ROOT, 'templates', 'recipes-setup');
    if (!existsSync(seedDir)) return;

    // 匹配 seed-*.md 文件
    let files;
    try {
      files = readdirSync(seedDir).filter(f => f.startsWith('seed-') && f.endsWith('.md'));
    } catch { return; }

    let count = 0;
    for (const file of files) {
      const dest = join(this.recipesDir, file.replace('seed-', ''));
      if (existsSync(dest) && !this.force) continue;
      copyFileSync(join(seedDir, file), dest);
      count++;
    }
    if (count > 0) {
      console.log(`   ✅ 预置 ${count} 个示例 Recipe（冷启动数据）`);
    }
  }

  /** @private 写入核心目录 README */
  _writeCoreReadme() {
    const dest = join(this.coreDir, 'README.md');
    if (existsSync(dest) && !this.force) return;

    writeFileSync(dest, [
      `# ${this.projectName} — AutoSnippet Knowledge Base`,
      '',
      '此目录是项目的 **核心知识库**，通过 Git 子仓库管理，同时承载数据存储与权限控制。',
      '',
      '## 目录结构',
      '',
      '```',
      'AutoSnippet/',
      '├── constitution.yaml   权限宪法（角色 + 权限 + 治理规则 + 能力探测）',
      '├── boxspec.json        项目规格',
      '├── recipes/            统一知识实体（Markdown + YAML front-matter）',
      '│   ├── _template.md    格式参考',
      '│   ├── naming-rules.md 代码规范示例',
      '│   ├── mvvm-arch.md    架构模式示例',
      '│   └── ...             代码模式/调用链/数据流/约束/风格/...',
      '└── README.md',
      '```',
      '',
      '## 统一知识模型',
      '',
      '所有知识统一为 **Recipe** 实体，由 `knowledgeType` 区分维度：',
      '',
      '| knowledgeType | 说明 |',
      '|---------------|------|',
      '| code-standard | 代码规范 |',
      '| code-pattern | 代码模式 |',
      '| code-relation | 代码关联 |',
      '| inheritance | 继承与接口 |',
      '| call-chain | 调用链路 |',
      '| data-flow | 数据流向 |',
      '| module-dependency | 模块与依赖 |',
      '| architecture | 模式与架构 |',
      '| best-practice | 最佳实践 |',
      '| boundary-constraint | 边界约束（含 Guard 规则） |',
      '| code-style | 代码风格 |',
      '| solution | 问题解决方案 |',
      '',
      '## 权限模型',
      '',
      'AutoSnippet 使用 **三层权限架构**：',
      '',
      '| 层级 | 机制 | 职责 |',
      '|------|------|------|',
      '| ① 能力层 | `git push --dry-run` | 探测子仓库物理写权限 |',
      '| ② 角色层 | `constitution.yaml` roles | 角色权限矩阵 (action:resource) |',
      '| ③ 治理层 | `constitution.yaml` priorities | 业务规则引擎 |',
      '',
      'git 权限只是"能力信号"，**最终裁决权在 Constitution YAML**。',
      '',
      '## 团队使用',
      '',
      '```bash',
      '# 方式 1: 添加远程仓库',
      'cd AutoSnippet',
      'git remote add origin <your-repo-url>',
      '',
      '# 方式 2: 使用 git submodule（推荐）',
      'cd ..',
      'rm -rf AutoSnippet',
      'git submodule add <your-repo-url> AutoSnippet',
      '```',
      '',
      '> 运行时缓存（DB 索引、Candidates、Snippets、审计日志）在 `.autosnippet/autosnippet.db`。',
      '> **核心数据的唯一真实来源是此目录中的文件**，DB 仅做缓存。修改 Recipe/Guard 规则必须通过 git。',
      '',
    ].join('\n'));
    console.log('   ✅ AutoSnippet/README.md');
  }

  /* ═══ Step 3: IDE 集成 ═══════════════════════════════ */

  stepIDE() {
    const mcpServerPath = join(V2_ROOT, 'bin', 'mcp-server.js');

    this._configureVSCodeMCP(mcpServerPath);
    this._configureCursorMCP(mcpServerPath);
    this._copyCopilotInstructions();
    this._copyCursorRules();

    return { configured: ['vscode-mcp', 'cursor-mcp', 'copilot-instructions', 'cursor-rules'] };
  }

  /** @private VSCode settings.json → Copilot MCP */
  _configureVSCodeMCP(mcpServerPath) {
    const vscodeDir    = join(this.projectRoot, '.vscode');
    const settingsPath = join(vscodeDir, 'settings.json');
    mkdirSync(vscodeDir, { recursive: true });

    let settings = {};
    if (existsSync(settingsPath)) {
      try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { /* ignore */ }
    }

    if (!settings['github.copilot.mcp']) settings['github.copilot.mcp'] = {};
    if (!settings['github.copilot.mcp'].servers) settings['github.copilot.mcp'].servers = {};
    settings['github.copilot.mcp'].servers['autosnippet'] = {
      type: 'stdio',
      command: 'node',
      args: [mcpServerPath],
      env: {
        ASD_PROJECT_DIR: this.projectRoot,
        NODE_PATH: join(V2_ROOT, 'node_modules'),
      },
    };

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log('   ✅ .vscode/settings.json (Copilot MCP)');
  }

  /** @private .cursor/mcp.json */
  _configureCursorMCP(mcpServerPath) {
    const cursorDir  = join(this.projectRoot, '.cursor');
    const configPath = join(cursorDir, 'mcp.json');
    mkdirSync(cursorDir, { recursive: true });

    let existing = {};
    if (existsSync(configPath)) {
      try { existing = JSON.parse(readFileSync(configPath, 'utf8')); } catch { /* ignore */ }
    }

    if (!existing.mcpServers) existing.mcpServers = {};
    existing.mcpServers['autosnippet'] = {
      command: 'node',
      args: [mcpServerPath],
      env: {
        ASD_PROJECT_DIR: this.projectRoot,
        NODE_PATH: join(V2_ROOT, 'node_modules'),
      },
    };

    writeFileSync(configPath, JSON.stringify(existing, null, 2));
    console.log('   ✅ .cursor/mcp.json');
  }

  /** @private .github/copilot-instructions.md */
  _copyCopilotInstructions() {
    const src = join(REPO_ROOT, 'templates', 'copilot-instructions.md');
    if (!existsSync(src)) return;

    const destDir = join(this.projectRoot, '.github');
    const dest    = join(destDir, 'copilot-instructions.md');
    if (existsSync(dest) && !this.force) {
      console.log('   ℹ️  copilot-instructions.md 已存在');
      return;
    }

    mkdirSync(destDir, { recursive: true });
    copyFileSync(src, dest);
    console.log('   ✅ .github/copilot-instructions.md');
  }

  /** @private .cursor/rules/autosnippet-conventions.mdc */
  _copyCursorRules() {
    const src = join(REPO_ROOT, 'templates', 'cursor-rules', 'autosnippet-conventions.mdc');
    if (!existsSync(src)) return;

    const destDir = join(this.projectRoot, '.cursor', 'rules');
    const dest    = join(destDir, 'autosnippet-conventions.mdc');
    if (existsSync(dest) && !this.force) {
      console.log('   ℹ️  cursor rules 已存在');
      return;
    }

    mkdirSync(destDir, { recursive: true });
    copyFileSync(src, dest);
    console.log('   ✅ .cursor/rules/autosnippet-conventions.mdc');
  }

  /* ═══ Step 4: 数据库初始化 ═══════════════════════════ */

  async stepDatabase() {
    const ConfigLoader = (await import('../infrastructure/config/ConfigLoader.js')).default;
    const Bootstrap    = (await import('../bootstrap.js')).default;

    const env = process.env.NODE_ENV || 'development';
    ConfigLoader.load(env);
    ConfigLoader.set('database.path', this.dbPath);

    const bootstrap = new Bootstrap({ env });
    await bootstrap.initialize();
    console.log('   ✅ 数据库已初始化（migrations applied）');

    const db = bootstrap.components?.db?.getDb?.();
    if (db) {
      // 从子仓库文件同步核心数据到 DB 缓存（统一 Recipe 模型）
      await this._syncRecipesToDB(db);
    }

    await bootstrap.shutdown();
    ConfigLoader.config = null;   // 重置静态状态
    return { dbPath: this.dbPath };
  }

  /**
   * @private 从 AutoSnippet/recipes/*.md 同步到 DB 缓存
   * 委托 SyncService 执行全字段同步（setup 场景跳过违规记录）
   */
  async _syncRecipesToDB(db) {
    const { SyncService } = await import('./SyncService.js');
    const syncService = new SyncService(this.projectRoot);
    const report = syncService.sync(db, { skipViolations: true });

    if (report.synced > 0) {
      console.log(`   ✅ 已同步 ${report.synced} 个 Recipe 文件到 DB 缓存（新增 ${report.created}，更新 ${report.updated}）`);
    } else {
      console.log('   ℹ️  recipes/ 暂无 .md 文件，跳过同步');
    }

    if (report.orphaned.length > 0) {
      console.log(`   ℹ️  ${report.orphaned.length} 个孤儿 Recipe 已标记 deprecated`);
    }

    // ── Candidate 文件同步 ──
    await this._syncCandidatesToDB(db);
  }

  /**
   * @private 从 AutoSnippet/candidates/*.md 同步到 DB 缓存
   */
  async _syncCandidatesToDB(db) {
    const { CandidateSyncService } = await import('./CandidateSyncService.js');
    const syncService = new CandidateSyncService(this.projectRoot);
    const report = syncService.sync(db, { skipViolations: true });

    if (report.synced > 0) {
      console.log(`   ✅ 已同步 ${report.synced} 个 Candidate 文件到 DB 缓存（新增 ${report.created}，更新 ${report.updated}）`);
    } else {
      console.log('   ℹ️  candidates/ 暂无 .md 文件，跳过同步');
    }
  }

  /* ═══ Step 5: 平台初始化 ═════════════════════════════ */

  async stepPlatform() {
    if (process.platform !== 'darwin') {
      console.log('   ℹ️  非 macOS，跳过 Xcode 初始化');
      return { skipped: true };
    }

    const initScript = join(REPO_ROOT, 'scripts', 'init-xcode-snippets.js');
    if (!existsSync(initScript)) {
      console.log('   ℹ️  init-xcode-snippets 脚本不存在，跳过');
      return { skipped: true };
    }

    try {
      const mod    = await import(initScript);
      const initFn = mod.initialize || mod.default?.initialize || mod.default;
      if (typeof initFn !== 'function') {
        console.log('   ℹ️  init-xcode-snippets 格式不兼容，跳过');
        return { skipped: true };
      }

      const ok = await initFn();
      console.log(ok
        ? '   ✅ Xcode Snippets 已添加'
        : '   ℹ️  Xcode Snippets 未更新（可能已存在）');
      return { xcode: ok };
    } catch (e) {
      console.warn(`   ⚠️  Xcode 初始化失败：${e.message}`);
      return { error: e.message };
    }
  }

  /* ═══ Helpers ════════════════════════════════════════ */

  /** @private 确保项目 .gitignore 正确配置 AutoSnippet 相关规则 */
  _ensureGitignore() {
    const giPath = join(this.projectRoot, '.gitignore');
    let content = existsSync(giPath) ? readFileSync(giPath, 'utf8') : '';
    let changed = false;

    // ── 必须忽略：.autosnippet/（运行时缓存、DB、向量索引）──
    if (!content.includes('.autosnippet/')) {
      content += `\n# AutoSnippet 运行时缓存（不入库）\n.autosnippet/\n`;
      changed = true;
      console.log('   ✅ .gitignore += .autosnippet/');
    }

    // ── 必须跟踪：AutoSnippet/（知识库子仓库）──
    // 如果用户误将 AutoSnippet/ 加入忽略，追加 !AutoSnippet/ 取消忽略
    const lines = content.split('\n');
    const hasIgnoreAS = lines.some(l => {
      const t = l.trim();
      return (t === 'AutoSnippet/' || t === 'AutoSnippet') && !t.startsWith('#') && !t.startsWith('!');
    });
    const hasNegation = lines.some(l => l.trim() === '!AutoSnippet/');

    if (hasIgnoreAS && !hasNegation) {
      content += `\n# AutoSnippet 知识库必须入库（取消上方忽略）\n!AutoSnippet/\n`;
      changed = true;
      console.log('   ✅ .gitignore += !AutoSnippet/ (取消忽略)');
    }

    if (changed) {
      writeFileSync(giPath, content);
    }
  }

  /** @private 在指定目录执行 git 命令 */
  _git(args, cwd) {
    try {
      return execSync(`git ${args.join(' ')}`, {
        cwd,
        stdio: 'pipe',
        encoding: 'utf8',
      }).trim();
    } catch (e) {
      if (args[0] === 'commit' && e.status === 1) return '';
      throw e;
    }
  }
}

export default SetupService;
