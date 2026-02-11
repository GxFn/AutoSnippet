/**
 * UpgradeService — IDE 集成升级服务
 *
 * 当 AutoSnippet 发布新版本后，老用户执行 `asd upgrade` 即可更新：
 *   ① MCP 配置（.cursor/mcp.json + .vscode/settings.json）
 *   ② Cursor Skills（.cursor/skills/）
 *   ③ Cursor Rules（.cursor/rules/autosnippet-conventions.mdc）
 *   ④ Copilot Instructions（.github/copilot-instructions.md）
 *
 * 不会重建数据库、子仓库或运行时目录。
 */

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync,
} from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const REPO_ROOT = resolve(__dirname, '..', '..');

export class UpgradeService {
  constructor(options) {
    this.projectRoot = resolve(options.projectRoot);
    this.projectName = this.projectRoot.split('/').pop();
  }

  async run({ skillsOnly = false, mcpOnly = false } = {}) {
    const results = [];

    if (!skillsOnly) {
      results.push(this._upgradeMCP());
    }
    if (!mcpOnly) {
      results.push(this._upgradeSkills());
    }
    if (!skillsOnly && !mcpOnly) {
      results.push(this._upgradeCursorRules());
      results.push(this._upgradeCopilotInstructions());
      results.push(this._upgradeConstitution());
    }

    console.log('');
    console.log('════════════════════════════════════════');
    console.log('✅ 升级完成');
    console.log('════════════════════════════════════════');
    console.log('');
    console.log('📌 请在 Cursor / VSCode 中 Reload Window 使更新生效');
    console.log('');

    return results;
  }

  /* ═══ MCP 配置 ══════════════════════════════════════ */

  _upgradeMCP() {
    console.log('[MCP] 更新 IDE MCP 配置...');
    const mcpServerPath = join(REPO_ROOT, 'bin', 'mcp-server.js');
    const nodePath = join(REPO_ROOT, 'node_modules');

    // Cursor
    this._updateCursorMCP(mcpServerPath, nodePath);
    // VSCode
    this._updateVSCodeMCP(mcpServerPath, nodePath);
  }

  _updateCursorMCP(mcpServerPath, nodePath) {
    const configPath = join(this.projectRoot, '.cursor', 'mcp.json');
    if (!existsSync(configPath)) {
      console.log('   ⚠️  .cursor/mcp.json 不存在，跳过（请先运行 asd setup）');
      return;
    }

    let config = {};
    try { config = JSON.parse(readFileSync(configPath, 'utf8')); } catch { /* */ }
    if (!config.mcpServers) config.mcpServers = {};

    config.mcpServers['autosnippet'] = {
      command: 'node',
      args: [mcpServerPath],
      env: {
        ASD_PROJECT_DIR: this.projectRoot,
        NODE_PATH: nodePath,
      },
    };

    writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('   ✅ .cursor/mcp.json');
  }

  _updateVSCodeMCP(mcpServerPath, nodePath) {
    const settingsPath = join(this.projectRoot, '.vscode', 'settings.json');
    if (!existsSync(settingsPath)) {
      console.log('   ℹ️  .vscode/settings.json 不存在，跳过');
      return;
    }

    let settings = {};
    try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { /* */ }

    if (!settings['github.copilot.mcp']) settings['github.copilot.mcp'] = {};
    if (!settings['github.copilot.mcp'].servers) settings['github.copilot.mcp'].servers = {};

    settings['github.copilot.mcp'].servers['autosnippet'] = {
      type: 'stdio',
      command: 'node',
      args: [mcpServerPath],
      env: {
        ASD_PROJECT_DIR: this.projectRoot,
        NODE_PATH: nodePath,
      },
    };

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log('   ✅ .vscode/settings.json');
  }

  /* ═══ Skills ════════════════════════════════════════ */

  _upgradeSkills() {
    console.log('[Skills] 重新安装 Cursor Skills...');

    const installScript = join(REPO_ROOT, 'scripts', 'install-cursor-skill.js');
    if (!existsSync(installScript)) {
      console.log('   ⚠️  install-cursor-skill.js 不存在，跳过');
      return;
    }

    try {
      execSync(`node "${installScript}"`, {
        cwd: this.projectRoot,
        stdio: 'inherit',
        env: { ...process.env, NODE_PATH: join(REPO_ROOT, 'node_modules') },
      });
    } catch (e) {
      console.error(`   ❌ Skills 安装失败: ${e.message}`);
    }
  }

  /* ═══ Cursor Rules ══════════════════════════════════ */

  _upgradeCursorRules() {
    console.log('[Rules] 更新 Cursor Rules...');

    const src = join(REPO_ROOT, 'templates', 'cursor-rules', 'autosnippet-conventions.mdc');
    if (!existsSync(src)) {
      console.log('   ⚠️  模板不存在，跳过');
      return;
    }

    const destDir = join(this.projectRoot, '.cursor', 'rules');
    const dest = join(destDir, 'autosnippet-conventions.mdc');
    mkdirSync(destDir, { recursive: true });
    copyFileSync(src, dest);
    console.log('   ✅ .cursor/rules/autosnippet-conventions.mdc');
  }

  /* ═══ Copilot Instructions ══════════════════════════ */

  _upgradeCopilotInstructions() {
    console.log('[Instructions] 更新 Copilot Instructions...');

    const src = join(REPO_ROOT, 'templates', 'copilot-instructions.md');
    if (!existsSync(src)) {
      console.log('   ⚠️  模板不存在，跳过');
      return;
    }

    const destDir = join(this.projectRoot, '.github');
    const dest = join(destDir, 'copilot-instructions.md');
    mkdirSync(destDir, { recursive: true });
    copyFileSync(src, dest);
    console.log('   ✅ .github/copilot-instructions.md');
  }

  /* ═══ Constitution ══════════════════════════════════ */

  _upgradeConstitution() {
    console.log('[Constitution] 更新权限宪法...');

    const src = join(REPO_ROOT, 'templates', 'constitution.yaml');
    if (!existsSync(src)) {
      console.log('   ⚠️  模板不存在，跳过');
      return;
    }

    // 子仓库路径：AutoSnippet/constitution.yaml
    const dest = join(this.projectRoot, 'AutoSnippet', 'constitution.yaml');
    if (!existsSync(join(this.projectRoot, 'AutoSnippet'))) {
      console.log('   ⚠️  AutoSnippet/ 目录不存在，跳过（请先运行 asd setup）');
      return;
    }

    // 如果目标已存在，备份旧版本
    if (existsSync(dest)) {
      const oldContent = readFileSync(dest, 'utf8');
      const newContent = readFileSync(src, 'utf8');
      if (oldContent === newContent) {
        console.log('   ℹ️  constitution.yaml 已是最新版本');
        return;
      }
      const backupPath = dest + '.bak';
      copyFileSync(dest, backupPath);
      console.log(`   📦 已备份旧版本 → constitution.yaml.bak`);
    }

    copyFileSync(src, dest);
    console.log('   ✅ AutoSnippet/constitution.yaml');

    // 如果子仓库是 git 仓库，提示用户提交
    const gitDir = join(this.projectRoot, 'AutoSnippet', '.git');
    if (existsSync(gitDir)) {
      console.log('   💡 子仓库已更新，请手动提交并推送：');
      console.log('      cd AutoSnippet && git add constitution.yaml && git commit -m "Upgrade constitution" && git push');
    }
  }
}

export default UpgradeService;
