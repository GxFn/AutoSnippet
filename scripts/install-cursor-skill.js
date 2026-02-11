#!/usr/bin/env node

/**
 * 将 AutoSnippet 自带的 Agent Skills 安装到「当前项目根」的 Cursor 环境（项目根/.cursor/skills/）。
 * 项目根：从当前工作目录向上查找含 AutoSnippet.boxspec.json 的目录的父级；未找到则用当前目录。
 *
 * V2 策略：静态索引 + MCP 按需检索
 * - project-recipes-context.md：轻量索引（title | trigger | category | summary），不再塞全文
 * - Agent 需要详情时调用 MCP: autosnippet_get_recipe / autosnippet_search / autosnippet_context_search
 * - guard-context.md：同为轻量索引（fallback 用），Guard 主路径走 MCP guard_check / guard_audit_files
 *
 * 运行方式：在项目根目录执行 npm run install:cursor-skill，或 asd install:cursor-skill，或 node scripts/install-cursor-skill.js
 */

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

import fs from 'node:fs';
import path from 'node:path';
import * as defaults from '../lib/infrastructure/config/Defaults.js';
import { RecipeStatsTracker } from '../lib/service/recipe/RecipeStatsTracker.js';

const autoSnippetRoot = path.join(__dirname, '..');
const skillsSource = path.join(autoSnippetRoot, 'skills');

let projectRoot = process.cwd();

// 首先在当前工作目录及其父目录中查找 AutoSnippet.boxspec.json（项目标记）
// 如果找到，其所在目录的父级就是项目根
function findProjectRootFromCwd() {
  let current = path.resolve(process.cwd());
  const maxLevels = 20;
  let levels = 0;
  
  while (levels < maxLevels) {
  const boxspecPath = path.join(current, 'AutoSnippet', 'AutoSnippet.boxspec.json');
  if (fs.existsSync(boxspecPath)) {
    return current; // 当前目录就是项目根
  }
  
  // 还要检查当前目录本身就是知识库目录的情况（用户直接在 AutoSnippet/ 中运行）
  const directBoxspec = path.join(current, 'AutoSnippet.boxspec.json');
  if (fs.existsSync(directBoxspec)) {
    return path.dirname(current); // 当前是知识库，其父级才是项目根
  }
  
  const parentPath = path.dirname(current);
  if (parentPath === current) break;
  current = parentPath;
  levels++;
  }
  
  return null;
}

const found = findProjectRootFromCwd();
if (found) {
  projectRoot = found;
} else {
  // 备选方案：使用PathFinder的查找逻辑
  try {
  const findPath = require(path.join(autoSnippetRoot, 'lib', 'infrastructure/paths/PathFinder.js'));
  const fallback = findPath.findProjectRootSync(process.cwd());
  if (fallback) projectRoot = fallback;
  } catch (err) {}
}

const skillsTarget = path.join(projectRoot, '.cursor', 'skills');

if (!fs.existsSync(skillsSource)) {
  console.error('❌ 未找到 skills 目录:', skillsSource);
  process.exit(1);
}

const skillDirs = fs.readdirSync(skillsSource, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

if (skillDirs.length === 0) {
  console.log('ℹ️  skills 下暂无 skill 目录，跳过安装。');
  process.exit(0);
}
  
  console.log('🚀 Cursor Skills 安装\n');

function getRecipesDir(root) {
  try {
    // 尝试查找 boxspec.json 来确定 recipes 目录
    const specCandidates = [
      path.join(root, 'AutoSnippet', 'boxspec.json'),
      path.join(root, 'AutoSnippet', 'AutoSnippet.boxspec.json'),
    ];
    for (const specPath of specCandidates) {
      if (fs.existsSync(specPath)) {
        const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
        const dir = spec?.recipes?.dir;
        if (dir) return path.join(root, dir);
      }
    }
  } catch { /* fallback */ }
  return path.join(root, defaults.RECIPES_DIR);
}

function collectMdFiles(dir, baseDir, list = []) {
  if (!fs.existsSync(dir)) return list;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
  const full = path.join(dir, e.name);
  if (e.isDirectory() && !e.name.startsWith('.')) {
    collectMdFiles(full, baseDir, list);
    continue;
  }
  if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
    list.push(path.relative(baseDir, full).replace(/\\/g, '/'));
  }
  }
  return list;
}

/**
 * 从 Markdown 的 YAML frontmatter 中提取指定字段（轻量实现，不依赖 YAML 库）
 */
function extractFrontmatterFields(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const block = m[1];
  const extract = (key) => {
    const re = new RegExp(`^${key}:\s*["']?(.+?)["']?\s*$`, 'm');
    const match = block.match(re);
    return match ? match[1].trim() : null;
  };
  return {
    id: extract('id'),
    title: extract('title'),
    trigger: extract('trigger'),
    category: extract('category'),
    language: extract('language'),
    kind: extract('kind'),
    summary_cn: extract('summary_cn'),
    summary_en: extract('summary_en'),
    knowledgeType: extract('knowledgeType'),
    complexity: extract('complexity'),
  };
}

/**
 * V2: 生成轻量 Recipe 索引（title | trigger | category | summary）
 * Agent 需要详情时调用 MCP: autosnippet_get_recipe / autosnippet_search
 */
function buildProjectRecipesContext(projectRoot) {
  const recipesDir = getRecipesDir(projectRoot);
  if (!fs.existsSync(recipesDir)) return null;
  const mdFiles = collectMdFiles(recipesDir, recipesDir).sort();
  if (mdFiles.length === 0) return null;
  let stats = { byFile: {} };
  try {
    const tracker = new RecipeStatsTracker(projectRoot);
    stats = tracker.getStats();
  } catch (_) {}

  const lines = [
    '# Project Recipes Index\n\n',
    'Generated by `asd install:cursor-skill`. **轻量索引** — 只含摘要信息。\n',
    'Agent 需要 Recipe 全文时请调用 MCP: `autosnippet_get_recipe(id)` / `autosnippet_search(query)` / `autosnippet_context_search(query)`\n\n',
    `Total: ${mdFiles.length} recipes\n\n`,
    '| # | File | Title | Trigger | Category | Language | Kind | Summary |\n',
    '|---|------|-------|---------|----------|----------|------|---------|\n',
  ];

  let idx = 0;
  for (const rel of mdFiles) {
    const full = path.join(recipesDir, rel);
    idx++;
    try {
      const content = fs.readFileSync(full, 'utf8');
      const fm = extractFrontmatterFields(content);
      const title = fm.title || '(untitled)';
      const trigger = fm.trigger || '';
      const cat = fm.category || defaults.inferCategory(rel, content);
      const lang = fm.language || '';
      const kind = fm.kind || '';
      const summary = (fm.summary_cn || fm.summary_en || '').replace(/\|/g, '/');
      lines.push(`| ${idx} | ${rel} | ${title} | ${trigger} | ${cat} | ${lang} | ${kind} | ${summary} |\n`);
    } catch (_) {
      lines.push(`| ${idx} | ${rel} | *(read error)* | | | | | |\n`);
    }
  }

  // 按 category 统计
  const catCounts = {};
  for (const rel of mdFiles) {
    try {
      const content = fs.readFileSync(path.join(recipesDir, rel), 'utf8');
      const fm = extractFrontmatterFields(content);
      const cat = fm.category || defaults.inferCategory(rel, content);
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    } catch (_) {}
  }
  lines.push('\n## Category Distribution\n\n');
  for (const [cat, count] of Object.entries(catCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`- **${cat}**: ${count} recipes\n`);
  }

  lines.push('\n## Usage Tips\n\n');
  lines.push('- 查找 Recipe: `autosnippet_search(query)` 或 `autosnippet_context_search(query)`\n');
  lines.push('- 获取详情: `autosnippet_get_recipe(id)` — 返回完整 Recipe 内容、关系、约束\n');
  lines.push('- 按类型浏览: `autosnippet_list_rules()` / `autosnippet_list_patterns()` / `autosnippet_list_facts()`\n');
  lines.push('- Guard 检查: `autosnippet_guard_check(code)` / `autosnippet_guard_audit_files(files)`\n');

  return lines.join('');
}

function buildSpmmapSummary(projectRoot) {
  const spmmapPath = path.join(projectRoot, defaults.SPMMAP_PATH);
  if (!fs.existsSync(spmmapPath)) return null;
  try {
  const data = JSON.parse(fs.readFileSync(spmmapPath, 'utf8'));
  const graph = data.graph || {};
  const packages = graph.packages || {};
  const edges = graph.edges || {};
  const lines = ['# SPM 依赖结构摘要\n', `Generated by \`asd install:cursor-skill\`. Source: ${defaults.SPMMAP_PATH}\n`, '\n## Packages\n'];
  for (const [pkg, info] of Object.entries(packages)) {
    const targets = (info.targets || []).join(', ');
    lines.push(`- **${pkg}**: ${targets || '(no targets)'}\n`);
  }
  lines.push('\n## 依赖关系 (from → to)\n');
  for (const [from, toList] of Object.entries(edges)) {
    if (Array.isArray(toList)) {
    lines.push(`- ${from} → ${toList.join(', ')}\n`);
    }
  }
  return lines.join('');
  } catch (_) {
  return null;
  }
}

for (const name of skillDirs) {
  const src = path.join(skillsSource, name);
  const dest = path.join(skillsTarget, name);
  if (fs.existsSync(dest)) {
  fs.rmSync(dest, { recursive: true });
  }
  fs.cpSync(src, dest, { recursive: true });
  console.log(`  ✅ ${name}`);

  if (name === 'autosnippet-recipes') {
    // V2: 生成轻量 Recipe 索引（替代 V1 全文拼接 + by-category 切片）
    const context = buildProjectRecipesContext(projectRoot);
    const refDir = path.join(dest, 'references');
    if (!fs.existsSync(refDir)) fs.mkdirSync(refDir, { recursive: true });
    const contextPath = path.join(refDir, 'project-recipes-context.md');
    if (context) {
      fs.writeFileSync(contextPath, context, 'utf8');
      console.log(`    📋 Recipe 索引已生成 (轻量索引 + MCP 按需检索)`);
    } else {
      if (fs.existsSync(contextPath)) fs.unlinkSync(contextPath);
    }
    // 清理 V1 遗留的 by-category 切片（如存在）
    const oldCatDir = path.join(refDir, 'by-category');
    if (fs.existsSync(oldCatDir)) {
      fs.rmSync(oldCatDir, { recursive: true });
      console.log(`    🧹 已清理 V1 遗留 by-category 切片`);
    }
    const oldIndexJson = path.join(refDir, 'index.json');
    if (fs.existsSync(oldIndexJson)) fs.unlinkSync(oldIndexJson);
  }
  if (name === 'autosnippet-structure') {
    // spmmap 摘要注入到 structure skill（替代已删除的 dep-graph skill）
    const summary = buildSpmmapSummary(projectRoot);
    const refDir = path.join(dest, 'references');
    if (!fs.existsSync(refDir)) fs.mkdirSync(refDir, { recursive: true });
    const summaryPath = path.join(refDir, 'spmmap-summary.md');
    if (summary) {
      fs.writeFileSync(summaryPath, summary, 'utf8');
      console.log(`    🗺️  SPM 依赖摘要已生成`);
    } else {
      if (fs.existsSync(summaryPath)) fs.unlinkSync(summaryPath);
    }
  }
  if (name === 'autosnippet-guard') {
    // V2: Guard 索引（同 recipes 索引），Agent 主路径走 MCP guard_check
    const context = buildProjectRecipesContext(projectRoot);
    const refDir = path.join(dest, 'references');
    if (!fs.existsSync(refDir)) fs.mkdirSync(refDir, { recursive: true });
    const guardPath = path.join(refDir, 'guard-context.md');
    if (context) {
      fs.writeFileSync(guardPath, context, 'utf8');
      console.log(`    🛡️  Guard 索引已生成 (轻量 fallback)`);
    } else {
      if (fs.existsSync(guardPath)) fs.unlinkSync(guardPath);
    }
  }
}

// 可选：写入 Cursor 规则（.cursor/rules/*.mdc），使会话中持久遵循 AutoSnippet 约定
const cursorRulesSource = path.join(autoSnippetRoot, 'templates', 'cursor-rules');
const cursorRulesTarget = path.join(projectRoot, '.cursor', 'rules');
if (fs.existsSync(cursorRulesSource)) {
  const ruleFiles = fs.readdirSync(cursorRulesSource, { withFileTypes: true })
  .filter(d => d.isFile() && d.name.toLowerCase().endsWith('.mdc'))
  .map(d => d.name);
  if (ruleFiles.length > 0) {
  if (!fs.existsSync(cursorRulesTarget)) fs.mkdirSync(cursorRulesTarget, { recursive: true });
  for (const name of ruleFiles) {
    const src = path.join(cursorRulesSource, name);
    const dest = path.join(cursorRulesTarget, name);
    fs.copyFileSync(src, dest);
    console.log(`  ✅ ${name}`);
  }
  }
}

// 可选：写入 MCP 配置，使 autosnippet_context_search 等工具可用（连接层封装在此）
const mcpPath = path.join(projectRoot, '.cursor', 'mcp.json');
const mcpServerScript = path.join(autoSnippetRoot, 'bin', 'mcp-server.js');
const addMcp = process.argv.includes('--mcp');
if (addMcp && fs.existsSync(mcpServerScript)) {
  let mcp = { mcpServers: {} };
  if (fs.existsSync(mcpPath)) {
  try {
    mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    if (!mcp.mcpServers) mcp.mcpServers = {};
  } catch (_) {}
  }
  mcp.mcpServers.autosnippet = {
  type: 'stdio',
  command: 'node',
  args: [mcpServerScript],
  env: { ASD_UI_URL: process.env.ASD_UI_URL || defaults.DEFAULT_ASD_UI_URL }
  };
  fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
  fs.writeFileSync(mcpPath, JSON.stringify(mcp, null, 2), 'utf8');
  console.log('  ✅ MCP 配置');
} else if (addMcp) {
  // mcp-server.js 不存在，已跳过
}

console.log('🎯 Cursor skills 已就绪，安装到项目:', projectRoot);
console.log(`\n📌 下一步：重启 Cursor 后生效`);

const runEmbed = process.argv.includes('--embed');
if (runEmbed) {
  (async () => {
  try {
    const IndexingPipeline = require(path.join(autoSnippetRoot, 'lib', 'context', 'IndexingPipeline'));
    const result = await IndexingPipeline.run(projectRoot, { clear: false });
    // 语义索引已更新
  } catch (e) {
    console.warn('⚠️  语义索引更新失败:', e.message);
  }
  })().catch(() => process.exit(1));
}
