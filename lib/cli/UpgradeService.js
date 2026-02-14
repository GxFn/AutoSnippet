/**
 * UpgradeService — IDE 集成升级服务
 *
 * 当 AutoSnippet 发布新版本后，老用户执行 `asd upgrade` 即可更新：
 *   ① MCP 配置（.cursor/mcp.json + .vscode/settings.json）
 *   ② Cursor Skills（.cursor/skills/）
 *   ③ Cursor Rules（.cursor/rules/autosnippet-conventions.mdc + autosnippet-skills.mdc）
 *   ④ Copilot Instructions（.github/copilot-instructions.md）
 *   ⑤ Constitution（AutoSnippet/constitution.yaml）
 *   ⑥ .gitignore（升级规则 + 清理旧版本残留）
 *   ⑦ Skills 路径迁移（.autosnippet/skills/ → AutoSnippet/skills/）
 *
 * 不会重建数据库、子仓库或运行时目录。
 */

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync,
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
      results.push(this._upgradeSkillsTemplate());
      results.push(this._upgradeCopilotInstructions());
      results.push(this._upgradeConstitution());
      results.push(this._upgradeGitignore());
      results.push(this._migrateSkillsPath());
      results.push(this._ensureSkillsDir());
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
  /* ═══ Skills Template ════════════════════════════════ */

  _upgradeSkillsTemplate() {
    console.log('[Skills Template] 更新 autosnippet-skills.mdc...');

    const src = join(REPO_ROOT, 'templates', 'cursor-rules', 'autosnippet-skills.mdc');
    if (!existsSync(src)) {
      console.log('   ⚠️  模板不存在，跳过');
      return;
    }

    const destDir = join(this.projectRoot, '.cursor', 'rules');
    const dest = join(destDir, 'autosnippet-skills.mdc');
    mkdirSync(destDir, { recursive: true });
    copyFileSync(src, dest);
    console.log('   ✅ .cursor/rules/autosnippet-skills.mdc');
  }

  /* ═══ .gitignore ════════════════════════════════════ */

  _upgradeGitignore() {
    console.log('[Gitignore] 更新 .gitignore 规则...');

    const giPath = join(this.projectRoot, '.gitignore');
    if (!existsSync(giPath)) {
      console.log('   ℹ️  .gitignore 不存在，跳过');
      return;
    }

    let content = readFileSync(giPath, 'utf8');
    let changed = false;

    // v2.4.0 迁移：旧格式 ".autosnippet/" → 新格式 ".autosnippet/*"
    if (content.includes('.autosnippet/') && !content.includes('.autosnippet/*')) {
      content = content.replace(/^\.autosnippet\/$/m, '.autosnippet/*');
      changed = true;
      console.log('   ✅ .autosnippet/ → .autosnippet/*（升级为精细忽略）');
    }

    // 确保有 .autosnippet/*
    if (!content.includes('.autosnippet/') && !content.includes('.autosnippet/*')) {
      content += `\n# AutoSnippet 运行时缓存（不入库）\n.autosnippet/*\n`;
      changed = true;
      console.log('   ✅ += .autosnippet/*');
    }

    // 确保 config.json 跟踪
    if (!content.includes('!.autosnippet/config.json')) {
      content += `!.autosnippet/config.json\n`;
      changed = true;
      console.log('   ✅ += !.autosnippet/config.json');
    }

    // 清理旧版本的 .autosnippet/skills/ negation（已迁移到 AutoSnippet/skills/）
    if (content.includes('!.autosnippet/skills/')) {
      content = content.replace(/^!?\.autosnippet\/skills\/.*\n?/gm, '');
      changed = true;
      console.log('   ✅ 移除旧版 .autosnippet/skills/ 规则（已迁移到 AutoSnippet/skills/）');
    }

    // 确保 AutoSnippet/ 不被忽略
    const lines = content.split('\n');
    const hasIgnoreAS = lines.some(l => {
      const t = l.trim();
      return (t === 'AutoSnippet/' || t === 'AutoSnippet') && !t.startsWith('#') && !t.startsWith('!');
    });
    const hasNegation = lines.some(l => l.trim() === '!AutoSnippet/');
    if (hasIgnoreAS && !hasNegation) {
      content += `\n# AutoSnippet 知识库必须入库（取消上方忽略）\n!AutoSnippet/\n`;
      changed = true;
      console.log('   ✅ += !AutoSnippet/ (取消忽略)');
    }

    if (changed) {
      writeFileSync(giPath, content);
    } else {
      console.log('   ℹ️  .gitignore 已是最新版本');
    }
  }

  /* ═══ Skills 路径迁移 ═══════════════════════════════ */

  _migrateSkillsPath() {
    const oldSkillsDir = join(this.projectRoot, '.autosnippet', 'skills');
    const newSkillsDir = join(this.projectRoot, 'AutoSnippet', 'skills');

    if (!existsSync(oldSkillsDir)) return;
    if (!existsSync(join(this.projectRoot, 'AutoSnippet'))) return;

    console.log('[Migration] 迁移 Skills: .autosnippet/skills/ → AutoSnippet/skills/...');

    try {
      mkdirSync(newSkillsDir, { recursive: true });
      const entries = readdirSync(oldSkillsDir, { withFileTypes: true });
      let migrated = 0;

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const src = join(oldSkillsDir, entry.name);
        const dest = join(newSkillsDir, entry.name);
        if (existsSync(dest)) {
          console.log(`   ℹ️  ${entry.name} 已存在于新路径，跳过`);
          continue;
        }
        // 复制目录
        execSync(`cp -r "${src}" "${dest}"`, { stdio: 'pipe' });
        migrated++;
      }

      if (migrated > 0) {
        console.log(`   ✅ 已迁移 ${migrated} 个 Skill 到 AutoSnippet/skills/`);
        console.log('   💡 确认迁移无误后可删除旧目录: rm -rf .autosnippet/skills/');
      } else {
        console.log('   ℹ️  无需迁移（所有 Skill 已存在于新路径）');
      }
    } catch (e) {
      console.error(`   ❌ 迁移失败: ${e.message}`);
    }
  }

  /* ═══ 确保 Skills 目录存在 ══════════════════════════ */

  _ensureSkillsDir() {
    const skillsDir = join(this.projectRoot, 'AutoSnippet', 'skills');
    if (!existsSync(join(this.projectRoot, 'AutoSnippet'))) return;
    if (existsSync(skillsDir)) return;

    mkdirSync(skillsDir, { recursive: true });
    console.log('[Skills] ✅ 创建 AutoSnippet/skills/ 目录');
  }
}

export default UpgradeService;
