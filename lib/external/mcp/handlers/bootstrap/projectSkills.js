/**
 * Bootstrap — Phase 5.5 Project Skill 自动生成
 *
 * 将 Bootstrap 扫描的宏观维度候选聚合为 Project Skill，
 * 写入 AutoSnippet/skills/，Agent 可直接引用。
 *
 * 5 个 skillWorthy 维度:
 *   - code-standard  → project-code-standard
 *   - architecture   → project-architecture
 *   - project-profile → project-profile
 *   - agent-guidelines → project-agent-guidelines
 *   - objc-deep-scan → project-objc-deep-scan (dualOutput: 同时产出 Candidate)
 */

import { inferTargetRole } from '../TargetClassifier.js';
// ─── Skill 拆分工具 ─────────────────────────────────────

/**
 * 每个 part 的 Markdown 最大字符数（不含 frontmatter）。
 * 选择 12000 以在加上 frontmatter 后仍保持在合理范围内。
 */
export const SKILL_PART_MAX_CHARS = 12000;

/**
 * 将完整 Skill Markdown 按 `## ` 二级标题边界拆分为多个 part。
 * 每个 part 共享相同的头部区块（标题 + Instructions）。
 *
 * @param {string} fullContent — 完整的 Skill Markdown 内容
 * @param {number} [maxChars=SKILL_PART_MAX_CHARS] — 单 part 上限字符数
 * @returns {string[]} — 如果不超限返回 [fullContent]，否则返回 [part1, part2, ...]
 */
function _splitSkillParts(fullContent, maxChars = SKILL_PART_MAX_CHARS) {
  if (fullContent.length <= maxChars) return [fullContent];

  // 找到 header 区块：从开头到第一个非 "Instructions" 的 ## 标题
  const headerEndRegex = /^## (?!Instructions for the agent)/m;
  const headerMatch = headerEndRegex.exec(fullContent);
  const headerEnd = headerMatch ? headerMatch.index : 0;
  const header = fullContent.slice(0, headerEnd);

  // 按 ## 标题切割正文段
  const body = fullContent.slice(headerEnd);
  const sections = [];
  const sectionRegex = /^## /gm;
  let lastIdx = 0;
  let match;
  while ((match = sectionRegex.exec(body)) !== null) {
    if (match.index > lastIdx) {
      sections.push(body.slice(lastIdx, match.index));
    }
    lastIdx = match.index;
  }
  if (lastIdx < body.length) sections.push(body.slice(lastIdx));

  // 分装各 part
  const parts = [];
  let currentLines = header;
  for (const section of sections) {
    if (currentLines.length + section.length > maxChars && currentLines.length > header.length) {
      // 当前 part 关闭
      parts.push(currentLines);
      currentLines = header;
    }
    currentLines += section;
  }
  if (currentLines.length > header.length) parts.push(currentLines);

  // 为每个 part 添加编号后缀到 # 标题
  if (parts.length > 1) {
    return parts.map((p, i) => {
      const total = parts.length;
      return p.replace(/^(# .+)$/m, `$1 (Part ${i + 1}/${total})`);
    });
  }
  return parts;
}
// ─── 候选文档解析 ────────────────────────────────────────

/**
 * 将候选的 code（Markdown 文档）中的内容解析为结构化摘要。
 * Skill 保留关键约定、规则以及有限数量的代码参考。
 *
 * @param {string} codeDoc — candidate.code (Markdown)
 * @returns {{ heading: string, conventions: string[], codeSnippets: string[], agentNotes: string[], referenceSnippets: string[] }}
 */
function _parseCandidateDocForSkill(codeDoc) {
  const result = { heading: '', conventions: [], codeSnippets: [], agentNotes: [], referenceSnippets: [] };
  if (!codeDoc) return result;

  const lines = codeDoc.split('\n');
  let section = '';
  let inCodeBlock = false;
  let currentCodeBlock = [];
  let codeBlockLang = '';

  for (const line of lines) {
    if (line.startsWith('# ')) {
      result.heading = line.replace(/^#\s+/, '').trim();
      continue;
    }
    if (line.startsWith('## ')) {
      section = line.replace(/^##\s+/, '').trim();
      continue;
    }

    const trimmed = line.trim();

    // ── 代码块收集 ──
    if (trimmed.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = trimmed.replace(/^```/, '').trim();
        currentCodeBlock = [];
        continue;
      } else {
        inCodeBlock = false;
        // 保留有限长度的代码参考（最多 3 个，每个最多 15 行）
        if (currentCodeBlock.length > 0 && currentCodeBlock.length <= 15 && result.referenceSnippets.length < 3) {
          const lang = codeBlockLang || 'text';
          result.referenceSnippets.push('```' + lang + '\n' + currentCodeBlock.join('\n') + '\n```');
        }
        currentCodeBlock = [];
        codeBlockLang = '';
        continue;
      }
    }

    if (inCodeBlock) {
      currentCodeBlock.push(line);
      continue;
    }

    if (!trimmed) continue;

    // Agent 注意事项 专用段
    if (section === 'Agent 注意事项') {
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        result.agentNotes.push(trimmed.replace(/^[-*]\s+/, ''));
      }
      continue;
    }
    // 代码示例段 — 只保留文件来源标记
    if (section === '代码示例') {
      if (trimmed.startsWith('// ──') && trimmed.endsWith('──')) {
        result.codeSnippets.push(trimmed);
      }
      continue;
    }
    // 其他任何段落下的列表项、表格行 → 作为 conventions 收集
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      result.conventions.push(trimmed);
    } else if (trimmed.startsWith('|') && !trimmed.match(/^\|[-\s:|]+\|$/)) {
      result.conventions.push(trimmed);
    }
  }

  return result;
}

// ─── Skill 内容构建 ──────────────────────────────────────

/**
 * 根据维度和候选数据构建 Project Skill 的 Markdown 内容。
 * 当单维度内容超过 SKILL_PART_MAX_CHARS 时，自动拆分为多个 part。
 *
 * @param {object} dim — 维度定义 { id, label, skillMeta, ... }
 * @param {Array} candidates — Phase 5 提取的候选数组
 * @param {object} context — { primaryLang, langStats, targetFileMap, depGraphData, guardAudit, astProjectSummary }
 * @returns {string | string[]} 单个 Skill 内容或拆分后的多 part 数组
 */
export function buildProjectSkillContent(dim, candidates, context) {
  switch (dim.id) {
    case 'code-standard':
      return _buildCodeStandardSkill(candidates, context);
    case 'architecture':
      return _buildArchitectureSkill(candidates, context);
    case 'project-profile':
      return _buildProjectProfileSkill(candidates, context);
    case 'agent-guidelines':
      return _buildAgentGuidelinesSkill(candidates, context);
    case 'objc-deep-scan':
      return _buildDeepScanSkill(candidates, context);
    case 'category-scan':
      return _buildCategoryScanSkill(candidates, context);
    default:
      return _buildGenericSkill(dim, candidates, context);
  }
}

function _buildCodeStandardSkill(candidates, context) {
  const lang = context.primaryLang || 'unknown';
  const lines = [
    `# Project Coding Standards (${lang})`,
    '',
    '> Auto-generated by Bootstrap scan. This skill defines the project\'s coding conventions.',
    '',
    '## Instructions for the agent',
    '',
    '1. **Always** follow these naming and file organization rules when writing new code',
    '2. Check the conventions below before creating new classes, methods, or files',
    '3. Do NOT introduce naming patterns that conflict with established project conventions',
    '',
  ];

  for (const c of candidates) {
    const parsed = _parseCandidateDocForSkill(c.code);
    // v4: 支持 4 个子主题
    const sectionTitleMap = {
      'naming': 'Naming Conventions',
      'file-organization': 'File Organization',
      'api-naming': 'API / Method Naming Style',
      'comment-style': 'Comment Language & Style',
    };
    const sectionTitle = sectionTitleMap[c.subTopic] || c.subTopic || 'Conventions';

    lines.push(`## ${sectionTitle}`, '');
    if (c.summary) lines.push(`> ${c.summary}`, '');

    if (parsed.conventions.length > 0) {
      for (const conv of parsed.conventions) lines.push(conv);
      lines.push('');
    }

    if (parsed.codeSnippets.length > 0) {
      lines.push('**Reference files:**', '');
      for (const snippet of parsed.codeSnippets) {
        lines.push(`- ${snippet.replace(/\/\/\s*──\s*/, '').replace(/\s*──$/, '')}`);
      }
      lines.push('');
    }

    if (parsed.referenceSnippets?.length > 0) {
      lines.push('**Code examples:**', '');
      for (const ref of parsed.referenceSnippets) lines.push(ref, '');
    }

    if (parsed.agentNotes.length > 0) {
      lines.push('**Mandatory rules:**', '');
      for (const note of parsed.agentNotes) lines.push(`- ⛔ ${note}`);
      lines.push('');
    }
  }

  // 补充代码来源引用
  const allSources = [...new Set(candidates.flatMap(c => c.sources || []))];
  if (allSources.length > 0) {
    lines.push('## Source Files', '', ...allSources.map(s => `- ${s}`), '');
  }

  return lines.join('\n');
}

function _buildArchitectureSkill(candidates, context) {
  const lang = context.primaryLang || 'unknown';
  const targetCount = Object.keys(context.targetFileMap || {}).length;
  const edgeCount = context.depGraphData?.edges?.length || 0;

  const lines = [
    `# Project Architecture (${lang})`,
    '',
    `> Auto-generated by Bootstrap scan. ${targetCount} modules, ${edgeCount} dependency edges.`,
    '',
    '## Instructions for the agent',
    '',
    '1. **Understand** the module layering before modifying cross-module code',
    '2. **Respect** dependency directions — do NOT introduce reverse dependencies',
    '3. New modules must declare their role (core/service/ui/test/util) explicitly',
    '4. Check the dependency graph before adding import statements across modules',
    '',
  ];

  for (const c of candidates) {
    const parsed = _parseCandidateDocForSkill(c.code);
    // v4: 支持 3 个子主题
    const sectionTitleMap = {
      'layer-overview': 'Module Layering',
      'dependency-graph': 'Dependency Graph',
      'boundary-rules': 'Module Boundary Rules',
    };
    const sectionTitle = sectionTitleMap[c.subTopic] || c.subTopic || 'Architecture';

    lines.push(`## ${sectionTitle}`, '');
    if (c.summary) lines.push(`> ${c.summary}`, '');

    if (parsed.conventions.length > 0) {
      for (const conv of parsed.conventions) lines.push(conv);
      lines.push('');
    }

    if (parsed.referenceSnippets?.length > 0) {
      lines.push('**Code examples:**', '');
      for (const ref of parsed.referenceSnippets) lines.push(ref, '');
    }

    if (parsed.agentNotes.length > 0) {
      lines.push('**Boundary rules:**', '');
      for (const note of parsed.agentNotes) lines.push(`- ⛔ ${note}`);
      lines.push('');
    }
  }

  // AST 架构指标
  const ast = context.astProjectSummary;
  if (ast) {
    lines.push('## Code Structure Metrics (AST)', '');
    lines.push(`- Classes/Structs: ${ast.classes.length}`);
    lines.push(`- Protocols: ${ast.protocols.length}`);
    lines.push(`- Categories/Extensions: ${ast.categories.length}`);
    if (ast.projectMetrics) {
      lines.push(`- Total methods: ${ast.projectMetrics.totalMethods}`);
      lines.push(`- Avg methods/class: ${ast.projectMetrics.avgMethodsPerClass.toFixed(1)}`);
      lines.push(`- Max nesting depth: ${ast.projectMetrics.maxNestingDepth}`);
      if (ast.projectMetrics.complexMethods?.length > 0) {
        lines.push(`- ⚠️ High-complexity methods: ${ast.projectMetrics.complexMethods.length}`);
      }
    }
    lines.push('');
  }

  // 模块列表
  const roleMap = {};
  for (const tn of Object.keys(context.targetFileMap || {})) {
    const role = inferTargetRole(tn);
    if (!roleMap[role]) roleMap[role] = [];
    roleMap[role].push(tn);
  }
  if (Object.keys(roleMap).length > 0) {
    lines.push('## Module Roles', '');
    for (const [role, modules] of Object.entries(roleMap)) {
      lines.push(`### ${role}`, '');
      for (const m of modules) lines.push(`- \`${m}\``);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function _buildProjectProfileSkill(candidates, context) {
  const lang = context.primaryLang || 'unknown';
  const lines = [
    `# Project Profile (${lang})`,
    '',
    '> Auto-generated by Bootstrap scan. Quick reference for project overview.',
    '',
    '## Instructions for the agent',
    '',
    '1. Read this skill first to understand the project context',
    '2. Use the tech stack and module info to make informed decisions',
    '3. Reference the metrics to gauge project scale and complexity',
    '',
  ];

  for (const c of candidates) {
    const parsed = _parseCandidateDocForSkill(c.code);

    if (c.summary) lines.push(`> ${c.summary}`, '');

    // v4.2: 支持 8 个子主题
    const sectionTitleMap = {
      'overview': 'Overview',
      'tech-stack': 'Tech Stack & Conventions',
      'third-party-deps': 'Third-Party Dependencies',
      'base-extensions': 'Extension / Category Registry',
      'base-classes': 'Base Classes & Global Definitions',
      'event-hooks': 'System Event Hooks & Lifecycle',
      'infra-services': 'Infrastructure Services',
      'runtime-and-interop': 'Runtime & Language Interop',
    };
    const sectionTitle = sectionTitleMap[c.subTopic] || 'Overview';

    // project-profile 的 bodyLines 通常是表格，直接嵌入
    if (parsed.conventions.length > 0) {
      lines.push(`## ${sectionTitle}`, '');
      for (const conv of parsed.conventions) lines.push(conv);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function _buildAgentGuidelinesSkill(candidates, context) {
  const lang = context.primaryLang || 'unknown';
  const lines = [
    `# Agent Development Guidelines (${lang})`,
    '',
    '> Auto-generated by Bootstrap scan. Mandatory rules and warnings found in project code.',
    '',
    '## Instructions for the agent',
    '',
    '1. **MUST** follow all mandatory rules listed below — violations may cause bugs or crashes',
    '2. Check TODO/FIXME items when modifying related code',
    '3. WARNING/IMPORTANT annotations are non-negotiable constraints',
    '4. Do NOT call deprecated APIs — use recommended alternatives instead',
    '5. Respect all "DO NOT" / "MUST NOT" / "禁止" constraints found in code comments',
    '',
    '## Three Core Quality Principles (MANDATORY)',
    '',
    '🔒 **Rigor (严谨性)**: Every assertion must be backed by actual code evidence. Use precise class names, method names, and file paths — never use vague terms like "this module" or "the file".',
    '',
    '🔍 **Deep Insight (深度特征挖掘)**: Go beyond statistics. Extract design intent and technical decisions. Answer "why" not just "what". Infer architecture patterns, domain concepts, and coding conventions from context.',
    '',
    '🔗 **Completeness (完整性)**: Every code example must show the full usage chain. KVO = register + handler + remove. Notification = register + handler + post + remove. Delegate = protocol + weak property + implementation. When project code is partial, supplement with canonical industry-standard examples.', 
    '',
  ];

  for (const c of candidates) {
    // Fix: coding-principles 内容已在上方 "Three Core Quality Principles" 中硬编码，跳过避免重复
    if (c.subTopic === 'coding-principles') continue;

    const parsed = _parseCandidateDocForSkill(c.code);
    // v4.1: 支持 5 个子主题（新增 coding-principles）
    const sectionTitleMap = {
      'coding-principles': 'Core Quality Principles (MANDATORY)',
      'todo-fixme': 'TODO/FIXME Items',
      'mandatory-rules': 'Mandatory Rules (WARNING/IMPORTANT)',
      'deprecated-api': 'Deprecated APIs',
      'arch-constraints': 'Code Constraints (DO NOT / 禁止)',
    };
    const sectionTitle = sectionTitleMap[c.subTopic] || c.subTopic || 'Guidelines';

    lines.push(`## ${sectionTitle}`, '');
    if (c.summary) lines.push(`> ${c.summary}`, '');

    if (parsed.conventions.length > 0) {
      for (const conv of parsed.conventions) lines.push(conv);
      lines.push('');
    }

    if (parsed.codeSnippets.length > 0) {
      lines.push('**Found in:**', '');
      for (const snippet of parsed.codeSnippets) {
        lines.push(`- ${snippet.replace(/\/\/\s*──\s*/, '').replace(/\s*──$/, '')}`);
      }
      lines.push('');
    }

    if (parsed.referenceSnippets?.length > 0) {
      lines.push('**Code examples:**', '');
      for (const ref of parsed.referenceSnippets) lines.push(ref, '');
    }

    if (parsed.agentNotes.length > 0) {
      lines.push('**Agent constraints:**', '');
      for (const note of parsed.agentNotes) lines.push(`- ⛔ ${note}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * ObjC/Swift 深度扫描 Skill — 聚合常量/Category/Hook 全量信息
 * 生成宏观概览 Skill，Agent 可快速查阅项目级约定。
 * 细粒度内容由 dualOutput 产出的 Candidate → Recipe → Snippet 承载。
 */
function _buildDeepScanSkill(candidates, context) {
  const lang = context.primaryLang || 'objectivec';
  const langLabel = lang === 'swift' ? 'Swift' : 'ObjC';

  const lines = [
    `# Project Deep Scan — Constants / Category Methods / Swizzle Hooks (${langLabel})`,
    '',
    '> Auto-generated by Bootstrap deep scan. This skill aggregates all project constants,',
    '> Foundation/UIKit Category methods (with usage frequency), and Method Swizzling hooks.',
    '',
    '## Instructions for the agent',
    '',
    '1. **Always** use project-defined constants — never hardcode magic numbers/strings',
    '2. **Always** use project Category/Extension methods when equivalent functionality is needed',
    '3. **Before** modifying any method that appears in the Swizzle Hooks section, check the hook implementation',
    '4. Follow the usage patterns shown below — they reflect the project\'s established coding style',
    '',
  ];

  // 按子主题分组
  const definesCandidates = candidates.filter(c => c.subTopic?.startsWith('defines/'));
  const categoryCandidates = candidates.filter(c => c.subTopic?.startsWith('category/'));
  const hooksCandidates = candidates.filter(c => c.subTopic === 'swizzle-hooks');

  // ── 常量/宏汇总 ──
  if (definesCandidates.length > 0) {
    lines.push('## Constants & Macros', '');
    for (const c of definesCandidates) {
      const parsed = _parseCandidateDocForSkill(c.code);
      lines.push(`### ${parsed.heading || c.subTopic}`, '');
      if (c.summary) lines.push(`> ${c.summary}`, '');
      // 保留约定/规则列表（不含完整代码块 — 那些在 Candidate/Recipe 中）
      if (parsed.conventions.length > 0) {
        for (const conv of parsed.conventions.slice(0, 20)) lines.push(conv);
        if (parsed.conventions.length > 20) lines.push(`*…另有 ${parsed.conventions.length - 20} 条*`);
        lines.push('');
      }
      if (parsed.agentNotes.length > 0) {
        lines.push('**Agent Rules:**');
        for (const note of parsed.agentNotes) lines.push(`- ${note}`);
        lines.push('');
      }
    }
  }

  // ── Category/Extension 方法汇总 ──
  if (categoryCandidates.length > 0) {
    lines.push('## Category / Extension Methods', '');
    for (const c of categoryCandidates) {
      const parsed = _parseCandidateDocForSkill(c.code);
      lines.push(`### ${parsed.heading || c.subTopic}`, '');
      if (c.summary) lines.push(`> ${c.summary}`, '');
      if (parsed.conventions.length > 0) {
        for (const conv of parsed.conventions.slice(0, 30)) lines.push(conv);
        if (parsed.conventions.length > 30) lines.push(`*…另有 ${parsed.conventions.length - 30} 条*`);
        lines.push('');
      }
      if (parsed.agentNotes.length > 0) {
        lines.push('**Agent Rules:**');
        for (const note of parsed.agentNotes) lines.push(`- ${note}`);
        lines.push('');
      }
    }
  }

  // ── Swizzle Hook 汇总 ──
  if (hooksCandidates.length > 0) {
    lines.push('## Method Swizzling Hooks', '');
    for (const c of hooksCandidates) {
      const parsed = _parseCandidateDocForSkill(c.code);
      if (c.summary) lines.push(`> ${c.summary}`, '');
      if (parsed.conventions.length > 0) {
        for (const conv of parsed.conventions) lines.push(conv);
        lines.push('');
      }
      if (parsed.agentNotes.length > 0) {
        lines.push('**Agent Rules:**');
        for (const note of parsed.agentNotes) lines.push(`- ${note}`);
        lines.push('');
      }
    }
  }

  const full = lines.join('\n');
  return _splitSkillParts(full);
}

/**
 * Category/Extension 专项扫描 Skill — 结构化方法清单
 * 每个 candidate 对应一个 Category 文件，包含方法签名和使用频次。
 */
function _buildCategoryScanSkill(candidates, context) {
  const lang = context.primaryLang || 'objectivec';
  const MAX_METHODS_PER_CATEGORY = 30;

  const lines = [
    `# 基础类 Category/Extension 方法清单 (${lang === 'swift' ? 'Swift' : 'ObjC'})`,
    '',
    '> Auto-generated by Bootstrap scan. Agent 遇到同等功能时 **必须** 使用项目已有的 Category/Extension 方法，**禁止** 重复实现。',
    '',
    '## Instructions for the agent',
    '',
    '1. **MUST** use project Category/Extension methods when equivalent functionality is needed — **DO NOT** re-implement',
    '2. Check this list before adding new extension methods to avoid duplication',
    '3. Follow the usage patterns shown below — they reflect the project\'s established coding style',
    '4. New Category method names should use the project prefix (e.g. `bd_methodName`) to avoid conflicts with system/third-party methods',
    '',
  ];

  for (const c of candidates) {
    // 提取 heading 和方法签名
    const codeLines = (c.code || '').split('\n');
    let heading = '';
    const methodSigs = [];
    let inCodeBlock = false;
    let summaryLine = '';

    for (const line of codeLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('# ') && !heading) {
        heading = trimmed.replace(/^#\s+/, '');
        continue;
      }
      if (trimmed.startsWith('> ') && !summaryLine) {
        summaryLine = trimmed;
        continue;
      }
      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (trimmed.startsWith('#### ')) {
        methodSigs.push(trimmed.replace(/^####\s+/, ''));
      }
    }

    const sectionLines = [];
    sectionLines.push(`## ${heading || c.subTopic || 'Category'}`, '');
    if (c.summary) sectionLines.push(`> ${c.summary}`, '');
    if (methodSigs.length > 0) {
      const displaySigs = methodSigs.slice(0, MAX_METHODS_PER_CATEGORY);
      for (const sig of displaySigs) sectionLines.push(`- ${sig}`);
      if (methodSigs.length > MAX_METHODS_PER_CATEGORY) {
        sectionLines.push(`- *…另有 ${methodSigs.length - MAX_METHODS_PER_CATEGORY} 个方法，详见源文件*`);
      }
      sectionLines.push('');
    }
    sectionLines.push(
      `- ⛔ 遇到等价功能时 **必须** 使用项目的 Category 方法，**禁止** 手写相同逻辑`,
      `- 新增扩展方法前必须检查此清单，避免重复实现`,
      '',
    );

    lines.push(...sectionLines);
  }

  // 将完整内容按 SKILL_PART_MAX_CHARS 拆分为多 part（每个 part 自带 header）
  const fullContent = lines.join('\n');
  return _splitSkillParts(fullContent);
}

function _buildGenericSkill(dim, candidates, _context) {
  const lines = [
    `# ${dim.label}`,
    '',
    '> Auto-generated by Bootstrap scan.',
    '',
    '## Instructions for the agent',
    '',
    `1. Reference this skill for ${dim.label} guidance`,
    '',
  ];

  for (const c of candidates) {
    const parsed = _parseCandidateDocForSkill(c.code);
    lines.push(`## ${parsed.heading || c.subTopic || 'Section'}`, '');
    if (c.summary) lines.push(`> ${c.summary}`, '');
    if (parsed.conventions.length > 0) {
      for (const conv of parsed.conventions) lines.push(conv);
      lines.push('');
    }
    if (parsed.referenceSnippets?.length > 0) {
      lines.push('**Code examples:**', '');
      for (const ref of parsed.referenceSnippets) lines.push(ref, '');
    }
    if (parsed.agentNotes.length > 0) {
      for (const note of parsed.agentNotes) lines.push(`- ${note}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}
