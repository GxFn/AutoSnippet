/**
 * Bootstrap — 9 维度知识提取器（v5）
 *
 * 按知识维度从扫描文件中启发式提取代表性代码候选。
 * 每维度产出 N 条单一职责候选，纯代码分析，不使用 AI。
 *
 * v5 变更（从 8→9 维度）:
 * - category-methods 从 objc-deep-scan 拆分为独立维度 category-scan
 *   — 解决 Category/Extension 产出过多导致 objc-deep-scan 体积膨胀问题
 * - objc-deep-scan 仅保留 defines-and-constants + swizzle-hooks
 *
 * v4 变更（从 9→8 维度）:
 * - 合并 call-chain + data-flow → event-and-data-flow（消除 delegate/singleton/reactive 重叠）
 * - bug-fix → anti-pattern（新增启发式检测：force-unwrap/超长方法/超深嵌套/循环引用风险）
 * - code-standard: 新增 api-naming, comment-style 子主题
 * - code-pattern: 新增 builder, observer, coordinator 模式
 * - architecture: 新增 boundary-rules 子主题
 * - best-practice: 新增 logging, testing 子主题
 * - project-profile: 新增 third-party-deps 子主题
 * - agent-guidelines: 新增 deprecated-api, arch-constraints 子主题
 *
 * v4.2 变更（project-profile 基础层面深度扩展）:
 * - project-profile/base-extensions: Extension/Category 按基类分类聚合（Foundation/UIKit/自定义），含 Associated Objects 检测
 * - project-profile/base-classes: 自定义基类层级 + 全局宏(OC)/#define + typealias/全局函数(Swift) + PCH + @propertyWrapper/@resultBuilder
 * - project-profile/event-hooks: App/Scene/VC 生命周期入口 + Method Swizzling + 自定义 NotificationName + DeepLink + +load/+initialize
 * - project-profile/infra-services: Manager/Service/Provider 等基础设施类枚举，按职责分类（网络/存储/认证/推送等），含单例检测 + 启动顺序
 * - project-profile/runtime-and-interop: OC Runtime API 使用 + Swift↔OC 互操作 + Swift 高级特性(async/Combine/SwiftUI) + __attribute__ 注解
 *
 * 维度: code-standard, code-pattern, architecture, best-practice,
 *       event-and-data-flow, anti-pattern, project-profile, agent-guidelines
 *
 * project-profile 子主题（8 个）:
 *   overview, tech-stack, third-party-deps,
 *   base-extensions, base-classes, event-hooks, infra-services, runtime-and-interop
 *
 * 文件结构（v4.1 拆分）:
 *   dimensions.js          — 调度器 + 共享工具函数（本文件）
 *   canonical-examples.js  — 标准完整示例 + 完整性检查
 *   extractors-micro.js    — 3 个微观维度提取器（code-pattern, best-practice, event-and-data-flow）
 *                            注意：anti-pattern 已移除 — 代码问题由 Guard 独立处理
 *   extractors-macro.js    — 4 个宏观维度提取器（code-standard, architecture, project-profile, agent-guidelines）
 */

// ── 提取器导入 ──
import { _extractCodePattern, _extractBestPractice, _extractEventAndDataFlow } from './extractors-micro.js';
import { _extractCodeStandard, _extractArchitecture, _extractProjectProfile, _extractAgentGuidelines, _computeTopPrefix } from './extractors-macro.js';
import { _extractObjcDeepScan, _extractCategoryScan } from './extractors-objc-deep.js';

// ─── Skill 内容解析与融合 ────────────────────────────────

/**
 * 将 Skill section 内容（分号分隔的摘要）解析为结构化规则列表
 * 处理 3 种格式：✅/❌ 代码注释、Markdown 表格行、纯文本描述
 * @param {string} content — extractSectionSummary 输出
 * @returns {string[]} 简洁的规则列表（最多 6 条）
 */
function _parseSkillContentToRules(content) {
  const rules = [];
  const parts = content.split(/;\s*/);

  for (const part of parts) {
    let trimmed = part.trim();
    if (!trimmed || trimmed.length < 5) continue;

    // ✅/❌ 代码注释 → 清理为规则
    if (/^\/\/\s*[✅❌]/.test(trimmed)) {
      rules.push(trimmed.replace(/^\/\/\s*/, ''));
      continue;
    }

    // 表格行 → 解析单元格
    if (/^\|/.test(trimmed) && /\|$/.test(trimmed)) {
      const cells = trimmed.split('|').map(c => c.trim().replace(/`/g, '').trim()).filter(Boolean);
      // 跳过表头行
      if (cells.some(c => /^(标识符类型|类型|规则|反模式|额外维度|注解|含义|候选类型|寻找什么)$/.test(c))) continue;
      if (cells.length >= 3) {
        rules.push(`${cells[0]}：${cells[1]}（${cells[2]}）`);
      } else if (cells.length === 2) {
        rules.push(`${cells[0]}：${cells[1]}`);
      }
      continue;
    }

    // 有意义的纯文本
    if (trimmed.length > 8 && trimmed.length < 120 && !trimmed.startsWith('#')) {
      rules.push(trimmed);
    }
  }

  return rules.slice(0, 6);
}

/**
 * 将业界规范规则融入候选 Markdown 文档结构
 *
 * 策略:
 * - 有 `## 约定` → 规则作为子标题追加
 * - 无 `## 约定` → 在 `## 代码示例` 前插入 `## 规范要点`
 * - 有 `## Agent 注意事项` → 追加最重要的 1-2 条规范提醒
 */
function _fuseSkillRulesIntoDoc(codeDoc, rules, sectionTitle) {
  if (!rules.length || !codeDoc) return codeDoc;

  const rulesText = rules.map(r => `- ${r}`).join('\n');
  let result = codeDoc;

  // ── 融合到 ## 约定 section ──
  const convMarker = '\n## 约定\n';
  const convIdx = result.indexOf(convMarker);
  if (convIdx >= 0) {
    // 在约定 section 末尾追加业界规范子块
    const afterConv = convIdx + convMarker.length;
    const nextSection = result.indexOf('\n## ', afterConv);
    const insertAt = nextSection >= 0 ? nextSection : result.length;
    result = result.slice(0, insertAt) +
      `\n**${sectionTitle}**:\n${rulesText}\n` +
      result.slice(insertAt);
  } else {
    // 无约定 section → 在代码示例之前插入
    const codeIdx = result.indexOf('\n## 代码示例\n');
    const agentIdx = result.indexOf('\n## Agent 注意事项\n');
    const insertIdx = codeIdx >= 0 ? codeIdx : (agentIdx >= 0 ? agentIdx : result.length);
    result = result.slice(0, insertIdx) +
      `\n## 规范要点\n\n**${sectionTitle}**:\n${rulesText}\n` +
      result.slice(insertIdx);
  }

  // Agent 注意事项不另外注入 — 规范已融合在 ## 约定 section 中
  return result;
}

// ─── 辅助：构建 Markdown 候选文档 / 标题 ──────────────────

export function _buildCandidateDoc({ heading, oneLiner, bodyLines, basicUsageBlocks, codeBlocks, agentNotes, relationLines }) {
  const lines = [`# ${heading}`, '', `> ${oneLiner}`, ''];
  if (bodyLines?.length) {
    lines.push('## 约定', '', ...bodyLines, '');
  }
  if (basicUsageBlocks?.length) {
    lines.push('## 基本使用', '');
    for (const cb of basicUsageBlocks) {
      if (cb.label) lines.push(`**${cb.label}**`, '');
      lines.push(`\`\`\`${cb.language}`, ...cb.lines, '```', '');
    }
  }
  if (codeBlocks?.length) {
    lines.push('## 项目示例', '');
    for (const cb of codeBlocks) {
      lines.push(`\`\`\`${cb.language}`, `// ── ${cb.source} ──`, ...cb.lines, '```', '');
    }
  }
  if (agentNotes?.length) {
    lines.push('## Agent 注意事项', '', ...agentNotes.map(n => `- ${n}`), '');
  }
  if (relationLines?.length) {
    lines.push('## 关联知识', '', ...relationLines.map(r => `- ${r}`), '');
  }
  return lines.join('\n');
}

export function _makeTitle(dimId, subTopic) {
  return `[Bootstrap] ${dimId}/${subTopic}`;
}

// ─── 维度调度器 ──────────────────────────────────────────

/**
 * v3: 从扫描文件中按维度提取 N 条单一职责候选。
 * 每条候选: { title, subTopic, code, language, sources, summary, knowledgeType, tags, relations }
 * 不使用 AI，纯启发式。未检测到内容的子主题不产出。
 */
export function extractDimensionCandidates(dim, allFiles, targetFileMap, context) {
  const { depGraphData, guardAudit, langStats, primaryLang, astProjectSummary, pipelineCtx } = context;
  const lang = primaryLang || 'swift';
  const ast = astProjectSummary || null;

  // 计算项目前缀（用于基本使用模板）— 使用 PipelineContext 缓存
  let projectPrefix;
  if (pipelineCtx) {
    projectPrefix = pipelineCtx.getOrCompute('projectPrefix', () => {
      const topPrefix = _computeTopPrefix(allFiles, lang, ast);
      return topPrefix ? topPrefix[0] : '';
    });
  } else {
    const topPrefix = _computeTopPrefix(allFiles, lang, ast);
    projectPrefix = topPrefix ? topPrefix[0] : '';
  }

  let candidates;
  switch (dim.id) {
    case 'code-standard':         candidates = _extractCodeStandard(allFiles, lang, ast); break;
    case 'code-pattern':          candidates = _extractCodePattern(allFiles, lang, ast, projectPrefix); break;
    case 'architecture':          candidates = _extractArchitecture(targetFileMap, depGraphData, lang, ast); break;
    case 'best-practice':         candidates = _extractBestPractice(allFiles, lang, projectPrefix); break;
    case 'event-and-data-flow':   candidates = _extractEventAndDataFlow(allFiles, lang, projectPrefix); break;
    case 'project-profile':       candidates = _extractProjectProfile(allFiles, targetFileMap, depGraphData, guardAudit, langStats, lang, ast, pipelineCtx); break;
    case 'agent-guidelines':      candidates = _extractAgentGuidelines(allFiles, lang); break;
    case 'objc-deep-scan':         candidates = _extractObjcDeepScan(allFiles, lang, ast, pipelineCtx); break;
    case 'category-scan':           candidates = _extractCategoryScan(allFiles, lang, pipelineCtx); break;
    // 兼容旧维度 ID（已废弃，保留 fallback）
    case 'call-chain':            candidates = _extractEventAndDataFlow(allFiles, lang, projectPrefix); break;
    case 'data-flow':             candidates = _extractEventAndDataFlow(allFiles, lang, projectPrefix); break;
    // anti-pattern / bug-fix 已移除 — 代码问题由 Guard 独立处理
    case 'anti-pattern':
    case 'bug-fix':
      candidates = [];
      break;
    default:
      candidates = [];
  }

  // ── Skill 增强：按 subTopic 精准匹配最相关的 Skill section ──
  if (dim._skillEnhanced && candidates.length > 0) {
    const skillSections = dim._skillSections || [];

    for (const c of candidates) {
      let bestSection = null;

      if (skillSections.length > 0) {
        // 按关键词匹配 candidate subTopic / summary → 最相关的 Skill section
        const subTopicLower = (c.subTopic || '').toLowerCase().replace(/[_-]/g, ' ');
        const summaryLower = (c.summary || '').toLowerCase();
        let bestScore = 0;

        for (const section of skillSections) {
          let score = 0;
          for (const kw of section.keywords) {
            const kwLower = kw.toLowerCase().replace(/[_-]/g, ' ');
            if (subTopicLower.includes(kwLower)) score += 3;
            if (summaryLower.includes(kwLower)) score += 1;
          }
          // section title 也参与匹配
          const titleLower = section.title.toLowerCase();
          if (subTopicLower.split(' ').some(w => w.length > 2 && titleLower.includes(w))) score += 2;
          if (summaryLower.split(/[^a-z\u4e00-\u9fff]+/).some(w => w.length > 2 && titleLower.includes(w))) score += 1;
          if (score > bestScore) {
            bestScore = score;
            bestSection = section;
          }
        }
        // bestScore === 0 → 无关键词匹配 → 不注入（不兜底到无关 section）
      }

      if (bestSection) {
        const rules = _parseSkillContentToRules(bestSection.content);
        const sectionTitle = bestSection.title;

        // ── 1. 融合到 code 文档结构（嵌入约定 + Agent 注意事项）──
        if (rules.length > 0 && c.code && typeof c.code === 'string') {
          c.code = _fuseSkillRulesIntoDoc(c.code, rules, sectionTitle);
        }

        // ── 2. summary：自然语言融合，不加标签 ──
        if (c.summary) {
          const sfx = /(规范|标准|模式)$/.test(sectionTitle) ? '' : '规范';
          c.summary = `${c.summary}，遵循${sectionTitle}${sfx}`;
        }

        // ── 3. whyStandard：项目特征 + 业界规范融合 ──
        c._skillEnhanced = true;
        const shortRules = rules.slice(0, 3).join('；');
        c._skillReference = `${c.summary || ''}。${sectionTitle}：${shortRules || bestSection.content.substring(0, 100)}`;
      }
    }
  }

  return candidates;
}

