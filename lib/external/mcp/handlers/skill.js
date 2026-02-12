/**
 * MCP Handlers — Skills 加载与发现
 *
 * 为 MCP 外部 Agent 提供 Skills 访问能力，使其能按需获取领域操作指南。
 * Skills 是 Agent 的知识增强文档，指导如何正确使用 AutoSnippet 工具。
 *
 * 设计原则：
 *   - Skills 是只读文档，不涉及 AI 调用，不需要 Gateway gating
 *   - 外部 Agent 应根据当前任务类型选择加载合适的 Skill
 *   - list_skills 返回摘要帮助 Agent 判断该加载哪个 Skill
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
const SKILLS_DIR = path.resolve(PROJECT_ROOT, 'skills');
const PROJECT_SKILLS_DIR = path.resolve(PROJECT_ROOT, '.autosnippet', 'skills');

/**
 * Skill 名称 → 摘要描述映射（用于 list_skills 返回）
 *
 * 从 SKILL.md 的 frontmatter description 提取。
 * 如果解析失败，返回 Skill 名称本身。
 */
function _parseSkillSummary(skillName, baseDir = SKILLS_DIR) {
  try {
    const content = fs.readFileSync(
      path.join(baseDir, skillName, 'SKILL.md'), 'utf8',
    );
    // 提取 frontmatter 的 description 字段
    const descMatch = content.match(/^description:\s*(.+?)(?:\n|$)/m);
    if (descMatch) {
      // 截断到第一句或 120 字符
      const desc = descMatch[1].trim();
      const firstSentence = desc.split(/\.\s/)[0];
      return firstSentence.length < desc.length ? `${firstSentence}.` : desc.substring(0, 120);
    }
    return skillName;
  } catch {
    return skillName;
  }
}

/**
 * Skill 适用场景映射 — 帮助 Agent 判断何时该加载哪个 Skill
 */
const SKILL_USE_CASES = {
  'autosnippet-intent': '不确定该用哪个能力时，先加载此 Skill 做意图路由',
  'autosnippet-coldstart': '冷启动/初始化知识库时的完整 9 维度分析指南',
  'autosnippet-analysis': '深度项目分析 — 扫描 + 语义补齐 + 缺口填充',
  'autosnippet-candidates': '生成/提交高质量候选（V2 全字段结构化）',
  'autosnippet-create': '将代码提交到知识库（Dashboard 入口）',
  'autosnippet-guard': '代码规范审计（Guard 规则检查）',
  'autosnippet-recipes': '查询/使用项目标准（Recipe 上下文检索）',
  'autosnippet-structure': '了解项目结构（SPM Target / 依赖图谱 / 知识图谱）',
  'autosnippet-concepts': '学习 AutoSnippet 核心概念（知识库/Recipe/Snippet/向量库）',
  'autosnippet-lifecycle': '了解 Recipe 生命周期与 Agent 权限边界',
  'autosnippet-reference-swift': 'Swift 语言最佳实践参考',
  'autosnippet-reference-objc': 'Objective-C 语言最佳实践参考',
  'autosnippet-reference-jsts': 'JavaScript/TypeScript 语言最佳实践参考',
};

// ═══════════════════════════════════════════════════════════
// Handler: listSkills
// ═══════════════════════════════════════════════════════════

/**
 * 列出所有可用 Skills 及其摘要描述
 *
 * @returns {string} JSON envelope
 */
export function listSkills() {
  try {
    const skillMap = new Map();

    // 内置 Skills
    const builtinDirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
    for (const name of builtinDirs) {
      skillMap.set(name, { name, source: 'builtin', summary: _parseSkillSummary(name, SKILLS_DIR), useCase: SKILL_USE_CASES[name] || null });
    }

    // 项目级 Skills（覆盖同名内置）
    try {
      const projectDirs = fs.readdirSync(PROJECT_SKILLS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory()).map(d => d.name);
      for (const name of projectDirs) {
        skillMap.set(name, { name, source: 'project', summary: _parseSkillSummary(name, PROJECT_SKILLS_DIR), useCase: SKILL_USE_CASES[name] || null });
      }
    } catch { /* no project skills */ }

    const skills = [...skillMap.values()].sort((a, b) => a.name.localeCompare(b.name));

    return JSON.stringify({
      success: true,
      data: {
        skills,
        total: skills.length,
        hint: '根据当前任务选择合适的 Skill 加载（load_skill）。不确定时先加载 autosnippet-intent 做意图路由。',
      },
    });
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: { code: 'SKILLS_READ_ERROR', message: err.message },
    });
  }
}

// ═══════════════════════════════════════════════════════════
// Handler: loadSkill
// ═══════════════════════════════════════════════════════════

/**
 * 加载指定 Skill 的完整文档内容
 *
 * @param {object} _ctx  MCP context（未使用，保持签名一致）
 * @param {object} args  { skillName: string, section?: string }
 * @returns {string} JSON envelope
 */
export function loadSkill(_ctx, args) {
  const { skillName, section } = args || {};

  if (!skillName) {
    return JSON.stringify({
      success: false,
      error: { code: 'MISSING_PARAM', message: 'skillName is required' },
    });
  }

  // 项目级 Skills 优先
  const projectSkillPath = path.join(PROJECT_SKILLS_DIR, skillName, 'SKILL.md');
  const builtinSkillPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');
  const skillPath = fs.existsSync(projectSkillPath) ? projectSkillPath : builtinSkillPath;
  const source = skillPath === projectSkillPath ? 'project' : 'builtin';

  try {
    let content = fs.readFileSync(skillPath, 'utf8');

    // 如果指定了 section，只返回对应章节
    if (section) {
      const sectionRe = new RegExp(
        `^##\\s+.*${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*$\\n([\\s\\S]*?)(?=^##\\s|$)`,
        'mi',
      );
      const match = content.match(sectionRe);
      if (match) {
        content = match[0];
      }
    }

    return JSON.stringify({
      success: true,
      data: {
        skillName,
        source,
        content,
        charCount: content.length,
        useCase: SKILL_USE_CASES[skillName] || null,
        relatedSkills: _getRelatedSkills(skillName),
      },
    });
  } catch {
    // 列出所有可用 Skills
    const available = new Set();
    try { fs.readdirSync(SKILLS_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).forEach(d => available.add(d.name)); } catch {}
    try { fs.readdirSync(PROJECT_SKILLS_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).forEach(d => available.add(d.name)); } catch {}

    return JSON.stringify({
      success: false,
      error: {
        code: 'SKILL_NOT_FOUND',
        message: `Skill "${skillName}" not found`,
        availableSkills: [...available],
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════
// Handler: createSkill
// ═══════════════════════════════════════════════════════════

/**
 * 创建项目级 Skill — 写入 .autosnippet/skills/<name>/SKILL.md
 * 创建后自动 regenerate 编辑器索引（.cursor/rules/autosnippet-skills.mdc）
 *
 * @param {object} _ctx  MCP context
 * @param {object} args  { name, description, content, overwrite? }
 * @returns {string} JSON envelope
 */
export function createSkill(_ctx, args) {
  const { name, description, content, overwrite = false } = args || {};

  // ── 参数校验 ──
  if (!name || !description || !content) {
    return JSON.stringify({
      success: false,
      error: { code: 'MISSING_PARAM', message: 'name, description, content are all required' },
    });
  }

  // 名称格式校验：kebab-case（允许字母、数字、连字符）
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(name) || name.length < 3 || name.length > 64) {
    return JSON.stringify({
      success: false,
      error: {
        code: 'INVALID_NAME',
        message: `Skill name must be kebab-case (a-z, 0-9, -), 3-64 chars. Got: "${name}"`,
      },
    });
  }

  // 不允许覆盖内置 Skill
  const builtinSkillPath = path.join(SKILLS_DIR, name, 'SKILL.md');
  if (fs.existsSync(builtinSkillPath)) {
    return JSON.stringify({
      success: false,
      error: {
        code: 'BUILTIN_CONFLICT',
        message: `"${name}" is a built-in Skill and cannot be overwritten. Choose a different name.`,
      },
    });
  }

  // 检查同名项目级 Skill
  const skillDir = path.join(PROJECT_SKILLS_DIR, name);
  const skillPath = path.join(skillDir, 'SKILL.md');
  if (fs.existsSync(skillPath) && !overwrite) {
    return JSON.stringify({
      success: false,
      error: {
        code: 'ALREADY_EXISTS',
        message: `Project skill "${name}" already exists. Set overwrite=true to replace.`,
      },
    });
  }

  // ── 写入 SKILL.md ──
  try {
    fs.mkdirSync(skillDir, { recursive: true });

    const frontmatter = [
      '---',
      `name: ${name}`,
      `description: ${description}`,
      '---',
      '',
    ].join('\n');

    fs.writeFileSync(skillPath, frontmatter + content, 'utf8');
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: { code: 'WRITE_ERROR', message: `Failed to write SKILL.md: ${err.message}` },
    });
  }

  // ── regenerate 编辑器索引 ──
  const indexResult = _regenerateEditorIndex();

  return JSON.stringify({
    success: true,
    data: {
      skillName: name,
      path: skillPath,
      overwritten: fs.existsSync(skillPath) && overwrite,
      editorIndex: indexResult,
      hint: `Skill "${name}" created. Use autosnippet_load_skill to verify content.`,
    },
  });
}

/**
 * Regenerate .cursor/rules/autosnippet-skills.mdc 索引文件
 * 扫描所有项目级 Skills，生成摘要索引供 External Agent 被动发现
 *
 * @returns {{ success: boolean, path?: string, skillCount?: number, error?: string }}
 */
function _regenerateEditorIndex() {
  try {
    // 扫描项目级 Skills
    let projectSkills = [];
    try {
      const dirs = fs.readdirSync(PROJECT_SKILLS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
      for (const name of dirs) {
        const summary = _parseSkillSummary(name, PROJECT_SKILLS_DIR);
        projectSkills.push({ name, summary });
      }
    } catch { /* no project skills dir */ }

    if (projectSkills.length === 0) {
      // 没有项目级 Skills 时，删除索引文件（如果存在）
      const indexPath = path.join(PROJECT_ROOT, '.cursor', 'rules', 'autosnippet-skills.mdc');
      try { fs.unlinkSync(indexPath); } catch { /* not exists */ }
      return { success: true, skillCount: 0 };
    }

    // 生成 .mdc 内容
    const skillLines = projectSkills
      .map(s => `- **${s.name}**: ${s.summary}`)
      .join('\n');

    const mdcContent = [
      '---',
      'description: AutoSnippet 项目级 Skills 索引（自动生成，请勿手动编辑）',
      'alwaysApply: true',
      '---',
      '',
      '# AutoSnippet Project Skills',
      '',
      `本项目已注册 ${projectSkills.length} 个自定义 Skill。使用 \`autosnippet_load_skill\` 工具加载完整内容。`,
      '',
      skillLines,
      '',
    ].join('\n');

    // 写入 .cursor/rules/
    const rulesDir = path.join(PROJECT_ROOT, '.cursor', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    const indexPath = path.join(rulesDir, 'autosnippet-skills.mdc');
    fs.writeFileSync(indexPath, mdcContent, 'utf8');

    return { success: true, path: indexPath, skillCount: projectSkills.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 推荐相关 Skills（基于静态映射）
 */
function _getRelatedSkills(skillName) {
  const relations = {
    'autosnippet-coldstart': ['autosnippet-analysis', 'autosnippet-candidates', 'autosnippet-structure'],
    'autosnippet-analysis': ['autosnippet-candidates', 'autosnippet-coldstart', 'autosnippet-structure'],
    'autosnippet-candidates': ['autosnippet-analysis', 'autosnippet-create', 'autosnippet-lifecycle'],
    'autosnippet-create': ['autosnippet-candidates', 'autosnippet-lifecycle'],
    'autosnippet-guard': ['autosnippet-recipes', 'autosnippet-analysis'],
    'autosnippet-recipes': ['autosnippet-guard', 'autosnippet-structure', 'autosnippet-concepts'],
    'autosnippet-structure': ['autosnippet-analysis', 'autosnippet-coldstart'],
    'autosnippet-concepts': ['autosnippet-recipes', 'autosnippet-lifecycle'],
    'autosnippet-lifecycle': ['autosnippet-candidates', 'autosnippet-concepts'],
    'autosnippet-intent': [],
    'autosnippet-reference-swift': ['autosnippet-coldstart', 'autosnippet-analysis'],
    'autosnippet-reference-objc': ['autosnippet-coldstart', 'autosnippet-analysis'],
    'autosnippet-reference-jsts': ['autosnippet-coldstart', 'autosnippet-analysis'],
  };
  return relations[skillName] || [];
}
