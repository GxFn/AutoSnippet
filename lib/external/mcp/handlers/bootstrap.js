/**
 * MCP Handlers — Bootstrap 冷启动知识库初始化 (v3 + Skill-aware)
 *
 * 统一底层逻辑：ChatAgent 和外部 Agent (MCP) 共享同一套 Skill 增强的 Bootstrap。
 *
 * 共享层（所有调用者均受益，纯启发式，不使用 AI）:
 *   Phase 1  → 文件收集（SPM Target 源文件扫描）
 *   Phase 2  → SPM 依赖关系 → knowledge_edges（模块级图谱）
 *   Phase 3  → Guard 规则审计
 *   Phase 3.5 → [Skill-aware] 加载 coldstart + language-reference Skills → 增强维度定义
 *   Phase 4  → 构建响应（filesByTarget + analysisFramework，含 Skill 增强的 guide）
 *   Phase 5  → 逐维度 × 子主题提取代码特征 → 创建 N 条 Candidate（PENDING 状态）
 *
 * AI 增强（Bootstrap 后续步骤，由调用方决定）:
 *   ChatAgent     → DAG pipeline 自动编排: enrich_candidate → refine_bootstrap_candidates
 *   MCP 外部 Agent → 由外部 AI Agent 自行调用 enrich/refine 工具（已在返回值的 nextSteps 中严格指引）
 *
 * 设计原则：项目内 AI 都走 ChatAgent + tool，bootstrapKnowledge() 本身不做 AI 调用。
 *
 * v3 变化：每维度按子模式拆分为多条 Candidate（单一职责），
 * 不再是每维度 1 条。使用 CandidateService.createFromToolParams() 统一入口。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { envelope } from '../envelope.js';
import { inferLang, detectPrimaryLanguage, buildLanguageExtension } from './LanguageExtensions.js';
import { inferTargetRole, inferFilePriority } from './TargetClassifier.js';
import { analyzeProject, generateContextForAgent, isAvailable as astIsAvailable } from '../../../core/AstAnalyzer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(__dirname, '../../../../skills');

// ═══════════════════════════════════════════════════════════
// 共享基础设施：Skills 加载（ChatAgent + MCP 统一使用）
// ═══════════════════════════════════════════════════════════

/**
 * 语言 → 参考 Skill 映射
 */
const LANG_SKILL_MAP = {
  swift: 'autosnippet-reference-swift',
  objectivec: 'autosnippet-reference-objc',
  javascript: 'autosnippet-reference-jsts',
  typescript: 'autosnippet-reference-jsts',
};

/**
 * loadBootstrapSkills — 加载冷启动相关 Skills（共享层）
 *
 * 统一入口：无论是 ChatAgent 还是 MCP 外部 Agent，都通过这个函数加载 Skills。
 * 返回的 skillContext 可直接传给 bootstrapKnowledge 增强维度定义。
 *
 * @param {string} [primaryLanguage] 项目主语言（如 'swift'）。传入后加载对应 reference Skill。
 * @param {object} [logger] 可选日志实例
 * @returns {{ coldstartSkill: string|null, languageSkill: string|null, languageSkillName: string|null, loaded: string[] }}
 */
export function loadBootstrapSkills(primaryLanguage, logger) {
  const result = {
    coldstartSkill: null,
    languageSkill: null,
    languageSkillName: null,
    loaded: [],
  };

  // 加载 coldstart Skill
  try {
    const coldstartPath = path.join(SKILLS_DIR, 'autosnippet-coldstart', 'SKILL.md');
    result.coldstartSkill = fs.readFileSync(coldstartPath, 'utf8');
    result.loaded.push('autosnippet-coldstart');
  } catch {
    logger?.warn?.('[Bootstrap] coldstart Skill not found, using default dimensions');
  }

  // 按主语言加载 reference Skill
  const langSkillName = primaryLanguage ? LANG_SKILL_MAP[primaryLanguage.toLowerCase()] : null;
  if (langSkillName) {
    try {
      const langPath = path.join(SKILLS_DIR, langSkillName, 'SKILL.md');
      result.languageSkill = fs.readFileSync(langPath, 'utf8');
      result.languageSkillName = langSkillName;
      result.loaded.push(langSkillName);
    } catch {
      logger?.warn?.(`[Bootstrap] Language Skill ${langSkillName} not found`);
    }
  }

  return result;
}

/**
 * Skill 中提取维度增强指引
 *
 * 1) coldstart SKILL.md 中的 "Per-Dimension Industry Reference Templates" 是**格式示例**（Swift 代码），
 *    仅当无语言 Skill 时才用作 fallback；
 * 2) 语言 Skill（如 reference-objc）包含真正的业界最佳实践内容，优先使用；
 * 3) 返回 per-section 结构以便后续 per-candidate 精准匹配。
 *
 * @param {object} skillContext — 由 loadBootstrapSkills 返回
 * @returns {{ guides: Record<string, string>, sectionMap: Record<string, Array<{title: string, content: string, keywords: string[]}>> }}
 */
function _extractSkillDimensionGuides(skillContext) {
  const guides = {};      // dimId → summary guide text
  const sectionMap = {};   // dimId → [{title, content, keywords}]
  const hasLanguageSkill = !!skillContext.languageSkill;

  // ── coldstart 模板: 仅在无语言 Skill 时用作 fallback ──
  // coldstart 中的 rationale/whyStandard 是 Swift 示例，不适合直接注入其它语言项目
  if (skillContext.coldstartSkill && !hasLanguageSkill) {
    const content = skillContext.coldstartSkill;
    const dimBlocks = content.matchAll(/###\s+维度\s*\d+\s*[:：]\s*(.+?)\s*\(([^)]+)\)\s*[—–-]\s*参考模板\s*\n([\s\S]*?)(?=\n###\s|\n##\s)/g);
    for (const match of dimBlocks) {
      let dimId = match[2].trim();
      if (/solution|antiPattern|bug/i.test(dimId)) dimId = 'bug-fix';
      dimId = dimId.replace(/\s+/g, '-');
      const block = match[3];
      const rationaleMatch = block.match(/"rationale"\s*:\s*"([^"]{20,300})"/);
      const whyMatch = block.match(/"whyStandard"\s*:\s*"([^"]{20,200})"/);
      const extraGuide = [rationaleMatch?.[1], whyMatch?.[1]].filter(Boolean).join('。');
      if (extraGuide) {
        guides[dimId] = extraGuide;
      }
    }
  }

  // ── 语言 Skill: 逐 section 提取丰富内容作为业界参考（PRIMARY） ──
  if (skillContext.languageSkill) {
    const content = skillContext.languageSkill;

    // heading → dimension(s) + 子主题匹配关键词
    const HEADING_DIM_MAP = [
      { pattern: /命名|naming|前缀|prefix/i,            dims: ['code-standard', 'code-pattern'], keywords: ['naming', 'prefix', '命名', '前缀', 'category'] },
      { pattern: /属性|propert/i,                        dims: ['code-standard', 'best-practice', 'bug-fix'], keywords: ['property', '属性', 'copy', 'weak', 'strong', 'memory', 'retain', 'cycle', 'leak'] },
      { pattern: /delegate|委托/i,                       dims: ['call-chain', 'code-pattern'],  keywords: ['delegate', 'protocol', '委托', '协议'] },
      { pattern: /初始化|initializ/i,                    dims: ['code-pattern'],                keywords: ['init', 'initializer', '初始化', 'factory'] },
      { pattern: /null|可选/i,                           dims: ['code-standard'],               keywords: ['nullable', 'nonnull', 'nullability'] },
      { pattern: /错误处理|error/i,                      dims: ['best-practice'],               keywords: ['error', 'NSError', '错误', 'error-handling'] },
      { pattern: /bool|陷阱/i,                           dims: ['bug-fix'],                     keywords: ['BOOL', 'bool', '陷阱', 'trap'] },
      { pattern: /gcd|线程|thread|并发|concurrent/i,     dims: ['best-practice', 'bug-fix'],    keywords: ['GCD', 'dispatch', 'thread', '线程', 'main', 'concurrency', 'main-thread'] },
      { pattern: /泛型|generic/i,                        dims: ['code-standard'],               keywords: ['generics', '泛型', 'generic'] },
      { pattern: /import|导入/i,                         dims: ['code-standard'],               keywords: ['import', '#import', '导入', 'file-organization'] },
      { pattern: /特有维度|extra.?dim/i,                 dims: ['agent-guidelines'],            keywords: ['agent', '注意', '维度', 'extra'] },
      { pattern: /category|扩展(?!.*特有)/i,             dims: ['code-pattern'],                keywords: ['category', 'extension', '扩展'] },
      { pattern: /singleton|单例/i,                      dims: ['code-pattern'],                keywords: ['singleton', '单例', 'dispatch_once'] },
    ];

    // 用 --- 分割section，更可靠地提取完整 section body
    const sectionParts = content.split(/\n---\n/);
    for (const part of sectionParts) {
      const headingMatch = part.match(/^##\s+\d+\.\s+(.+?)(?:\s*\(.+\))?\s*$/m);
      if (!headingMatch) continue;

      const heading = headingMatch[1].trim();
      const bodyStart = part.indexOf(headingMatch[0]) + headingMatch[0].length;
      const body = part.substring(bodyStart);

      // 查找匹配的 dimension(s)
      let matchedDims = [];
      let matchedKeywords = [];
      for (const mapping of HEADING_DIM_MAP) {
        if (mapping.pattern.test(heading)) {
          matchedDims.push(...mapping.dims);
          matchedKeywords.push(...mapping.keywords);
        }
      }
      matchedDims = [...new Set(matchedDims)];
      if (matchedDims.length === 0) continue;

      // 提取有意义的摘要内容
      let summary = _extractSectionSummary(body);
      // 如果 section body 主要是代码块导致摘要太短，用 heading 本身作为摘要前缀
      if (summary.length < 20) {
        summary = `${heading}：${summary}`;
      }
      if (summary.length < 10) continue;

      const sectionData = {
        title: heading,
        content: summary.substring(0, 500),
        keywords: [...new Set(matchedKeywords)],
      };

      for (const dimId of matchedDims) {
        if (!sectionMap[dimId]) sectionMap[dimId] = [];
        sectionMap[dimId].push(sectionData);

        const shortContent = summary.substring(0, 120);
        if (!guides[dimId]) {
          guides[dimId] = `[${heading}] ${shortContent}`;
        } else if (guides[dimId].length < 500) {
          guides[dimId] += `; [${heading}] ${shortContent}`;
        }
      }
    }
  }

  return { guides, sectionMap };
}

/**
 * 从 Skill section body 中提取有意义的摘要内容
 * 跳过 JSON 模板、代码块（保留关键注释），保留表格和文字描述
 */
function _extractSectionSummary(body) {
  const lines = body.split('\n');
  const parts = [];
  let inCodeBlock = false;
  let inJsonBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // 跳过 JSON 模板块（候选格式示例）
    if (trimmed.startsWith('```json')) { inJsonBlock = true; continue; }
    if (inJsonBlock) { if (trimmed === '```') inJsonBlock = false; continue; }

    // 追踪代码块 — 保留 ✅/❌ 关键注释
    if (trimmed.startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
    if (inCodeBlock) {
      if (/[✅❌]/.test(trimmed) && parts.length < 12) parts.push(trimmed);
      continue;
    }

    if (!trimmed) continue;
    if (trimmed.startsWith('###') || trimmed.startsWith('####')) continue;
    if (/^\|[-\s|:]+\|$/.test(trimmed)) continue; // 表格分隔线

    parts.push(trimmed);
    if (parts.length >= 10) break;
  }

  return parts.join('; ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * 增强 9 维度定义 — 将 Skill 提供的参考指引注入 dimensions[].guide
 *
 * @param {Array} dimensions — 原始维度数组
 * @param {Record<string, string>} skillGuides — guides 部分
 * @param {Record<string, Array>} skillSections — sectionMap 部分（per-candidate 匹配用）
 * @returns {Array} 增强后的维度数组（原数组不变，返回新数组）
 */
function _enhanceDimensions(dimensions, skillGuides, skillSections) {
  if (!skillGuides || Object.keys(skillGuides).length === 0) return dimensions;

  return dimensions.map(dim => {
    const extra = skillGuides[dim.id];
    if (!extra) return dim;
    return {
      ...dim,
      guide: `${dim.guide}。[Skill 参考] ${extra}`,
      _skillEnhanced: true,
      _skillSections: skillSections?.[dim.id] || [],
    };
  });
}

/**
 * bootstrapKnowledge — 一键初始化知识库 (Skill-aware)
 *
 * 覆盖 9 大知识维度: 项目规范、使用习惯、架构模式、代码模式、最佳实践、Bug修复方式、知识图谱、项目库特征、Agent开发注意事项
 * 为每个维度自动创建 Candidate（PENDING），外部 Agent 可按文件粒度补充更多候选。
 *
 * @param {object} ctx  { container, logger }
 * @param {object} args
 * @param {number} [args.maxFiles=500] 最大扫描文件数
 * @param {boolean} [args.skipGuard=false] 是否跳过 Guard 审计
 * @param {number} [args.contentMaxLines=120] 每文件读取最大行数
 * @param {boolean} [args.loadSkills=false] 是否加载 Skills 增强维度定义（共享层，ChatAgent + MCP 均可使用）
 * @param {object} [args.skillContext] 预加载的 Skill 上下文（由 ChatAgent 传入，避免重复读取）
 */
export async function bootstrapKnowledge(ctx, args) {
  const t0 = Date.now();
  const projectRoot = process.env.ASD_PROJECT_DIR || process.cwd();
  const maxFiles = args.maxFiles || 500;
  const skipGuard = args.skipGuard || false;
  const contentMaxLines = args.contentMaxLines || 120;
  const shouldLoadSkills = args.loadSkills ?? true;

  const report = {
    phases: {},
    totals: { files: 0, graphEdges: 0, guardViolations: 0 },
  };

  // ═══════════════════════════════════════════════════════════
  // Phase 1: 文件收集
  // ═══════════════════════════════════════════════════════════
  const { SpmService } = await import('../../../service/spm/SpmService.js');
  const spm = new SpmService(projectRoot);
  await spm.load();
  const allTargets = await spm.listTargets();

  const seenPaths = new Set();
  const allFiles = []; // { name, path, relativePath, content, targetName }
  for (const t of allTargets) {
    try {
      const fileList = await spm.getTargetFiles(t);
      for (const f of fileList) {
        const fp = typeof f === 'string' ? f : f.path;
        if (seenPaths.has(fp)) continue;
        seenPaths.add(fp);
        try {
          const content = fs.readFileSync(fp, 'utf8');
          allFiles.push({
            name: f.name || path.basename(fp),
            path: fp,
            relativePath: f.relativePath || path.basename(fp),
            content,
            targetName: typeof t === 'string' ? t : t.name,
          });
        } catch { /* skip unreadable */ }
        if (allFiles.length >= maxFiles) break;
      }
    } catch { /* skip target */ }
    if (allFiles.length >= maxFiles) break;
  }

  report.phases.fileCollection = {
    targets: allTargets.length,
    files: allFiles.length,
    truncated: allFiles.length >= maxFiles,
  };
  report.totals.files = allFiles.length;

  // ── 语言统计（全局一次计算，后续 Phase 共用）──────────────
  const langStats = {};
  for (const f of allFiles) {
    const ext = path.extname(f.name).replace('.', '') || 'unknown';
    langStats[ext] = (langStats[ext] || 0) + 1;
  }

  if (allFiles.length === 0) {
    return envelope({
      success: true,
      data: { report, message: 'No source files found, nothing to bootstrap' },
      meta: { tool: 'autosnippet_bootstrap_knowledge', responseTimeMs: Date.now() - t0 },
    });
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 1.5: AST 代码结构分析（Tree-sitter）
  // ═══════════════════════════════════════════════════════════
  let astProjectSummary = null;
  let astContext = '';
  const primaryLangEarly = detectPrimaryLanguage(langStats);
  if (astIsAvailable() && primaryLangEarly) {
    try {
      const astFiles = allFiles.map(f => ({
        name: f.name,
        relativePath: f.relativePath,
        content: f.content,
      }));
      astProjectSummary = analyzeProject(astFiles, primaryLangEarly);
      astContext = generateContextForAgent(astProjectSummary);
      ctx.logger.info(`[Bootstrap] AST analysis: ${astProjectSummary.classes.length} classes, ${astProjectSummary.protocols.length} protocols, ${astProjectSummary.categories.length} categories, ${Object.keys(astProjectSummary.patternStats).length} patterns`);
    } catch (e) {
      ctx.logger.warn(`[Bootstrap] AST analysis failed (graceful degradation): ${e.message}`);
    }
  } else {
    ctx.logger.info(`[Bootstrap] AST analysis skipped: tree-sitter ${astIsAvailable() ? 'available' : 'not available'}, lang=${primaryLangEarly}`);
  }
  report.phases.astAnalysis = {
    available: astIsAvailable(),
    classes: astProjectSummary?.classes?.length || 0,
    protocols: astProjectSummary?.protocols?.length || 0,
    categories: astProjectSummary?.categories?.length || 0,
    patterns: Object.keys(astProjectSummary?.patternStats || {}),
  };

  // ═══════════════════════════════════════════════════════════
  // Phase 2: SPM 依赖关系 → knowledge_edges
  // ═══════════════════════════════════════════════════════════
  let depEdgesWritten = 0;
  let depGraphData = null;
  try {
    const knowledgeGraphService = ctx.container.get('knowledgeGraphService');
    depGraphData = await spm.getDependencyGraph();
    if (knowledgeGraphService) {
      for (const edge of (depGraphData.edges || [])) {
        const result = knowledgeGraphService.addEdge(
          edge.from, 'module', edge.to, 'module', 'depends_on',
          { weight: 1.0, source: 'spm-bootstrap' },
        );
        if (result.success) depEdgesWritten++;
      }
    }
  } catch (e) {
    ctx.logger.warn(`[Bootstrap] SPM→Graph failed: ${e.message}`);
  }
  report.phases.spmDependencyGraph = { edgesWritten: depEdgesWritten };

  // ═══════════════════════════════════════════════════════════
  // Phase 3: Guard 规则审计
  // ═══════════════════════════════════════════════════════════
  let guardAudit = null;
  if (!skipGuard) {
    try {
      const { GuardCheckEngine } = await import('../../../service/guard/GuardCheckEngine.js');
      const db = ctx.container.get('database');
      const engine = new GuardCheckEngine(db);
      const guardFiles = allFiles.map(f => ({ path: f.path, content: f.content }));
      guardAudit = engine.auditFiles(guardFiles, { scope: 'project' });

      // 写入 ViolationsStore
      try {
        const violationsStore = ctx.container.get('violationsStore');
        for (const fileResult of (guardAudit.files || [])) {
          if (fileResult.violations.length > 0) {
            violationsStore.appendRun({
              filePath: fileResult.filePath,
              violations: fileResult.violations,
              summary: `Bootstrap scan: ${fileResult.summary.errors}E ${fileResult.summary.warnings}W`,
            });
          }
        }
      } catch { /* ViolationsStore not available */ }
    } catch (e) {
      ctx.logger.warn(`[Bootstrap] Guard audit failed: ${e.message}`);
    }
  }
  report.phases.guardAudit = {
    totalViolations: guardAudit?.summary?.totalViolations || 0,
    filesWithViolations: (guardAudit?.files || []).filter(f => f.violations.length > 0).length,
    skipped: skipGuard,
  };
  report.totals.guardViolations = guardAudit?.summary?.totalViolations || 0;
  report.totals.graphEdges = depEdgesWritten;

  const elapsed = Date.now() - t0;

  // ═══════════════════════════════════════════════════════════
  // Phase 4: 构建响应 — filesByTarget + analysisFramework
  // ═══════════════════════════════════════════════════════════
  const targetFileMap = {};
  for (const f of allFiles) {
    if (!targetFileMap[f.targetName]) targetFileMap[f.targetName] = [];
    const lines = f.content.split('\n');
    targetFileMap[f.targetName].push({
      name: f.name,
      relativePath: f.relativePath,
      language: inferLang(f.name),
      totalLines: lines.length,
      priority: inferFilePriority(f.name),
      content: lines.slice(0, contentMaxLines).join('\n'),
      truncated: lines.length > contentMaxLines,
    });
  }
  // 每个 target 内按 priority 排序
  for (const tName of Object.keys(targetFileMap)) {
    const prio = { high: 0, medium: 1, low: 2 };
    targetFileMap[tName].sort((a, b) => (prio[a.priority] || 1) - (prio[b.priority] || 1));
  }

  // 当前主语言 + 语言扩展
  const primaryLang = detectPrimaryLanguage(langStats);

  // ═══════════════════════════════════════════════════════════
  // Phase 3.5: [Skill-aware] 加载 Skills 增强维度定义
  // 共享层：ChatAgent 和 MCP 外部 Agent 均可受益
  // ═══════════════════════════════════════════════════════════
  let skillContext = args.skillContext || null;
  if (!skillContext && shouldLoadSkills) {
    skillContext = loadBootstrapSkills(primaryLang, ctx.logger);
    ctx.logger.info(`[Bootstrap] Skills loaded: ${skillContext.loaded.join(', ') || 'none'}`);
  }
  const { guides: skillGuides, sectionMap: skillSections } = skillContext
    ? _extractSkillDimensionGuides(skillContext)
    : { guides: {}, sectionMap: {} };
  const skillsEnhanced = Object.keys(skillGuides).length > 0;

  if (skillsEnhanced) {
    ctx.logger.info(`[Bootstrap] Skill dimension guides extracted for: ${Object.keys(skillGuides).join(', ')}`);
    // 输出每个 guide 的前 80 字符用于诊断
    for (const [dimId, guide] of Object.entries(skillGuides)) {
      ctx.logger.debug(`[Bootstrap] Skill guide [${dimId}]: ${guide.substring(0, 80)}...`);
    }
    // 输出 sectionMap 诊断
    for (const [dimId, sections] of Object.entries(skillSections)) {
      ctx.logger.debug(`[Bootstrap] Skill sections [${dimId}]: ${sections.length} section(s) — ${sections.map(s => s.title).join(', ')}`);
    }
  } else {
    ctx.logger.warn('[Bootstrap] No skill dimension guides extracted — Skills may not match expected format');
  }

  report.phases.skillLoading = {
    loaded: skillContext?.loaded || [],
    dimensionsEnhanced: Object.keys(skillGuides),
    sectionCounts: Object.fromEntries(Object.entries(skillSections).map(([k, v]) => [k, v.length])),
    enabled: shouldLoadSkills || !!args.skillContext,
  };

  // 9 维度定义（Phase 4 响应 + Phase 5 候选创建共用）
  const baseDimensions = [
    { id: 'code-standard', label: '代码规范', guide: '命名约定、注释风格、文件组织规范、API 设计规范', knowledgeTypes: ['code-standard', 'code-style'] },
    { id: 'code-pattern', label: '使用习惯/代码模式', guide: '常用封装、工厂/单例/Builder、公共 API 设计、数据模型模式', knowledgeTypes: ['code-pattern', 'code-relation', 'inheritance'] },
    { id: 'architecture', label: '架构模式', guide: '分层架构、MVVM/MVC/Clean、模块职责与边界', knowledgeTypes: ['architecture', 'module-dependency', 'boundary-constraint'] },
    { id: 'best-practice', label: '最佳实践', guide: '错误处理、并发安全、内存管理、性能优化', knowledgeTypes: ['best-practice'] },
    { id: 'call-chain', label: '调用链', guide: '关键业务路径、初始化链、事件传播链', knowledgeTypes: ['call-chain'] },
    { id: 'data-flow', label: '数据流', guide: '状态管理、模块间数据传递、响应式流', knowledgeTypes: ['data-flow'] },
    { id: 'bug-fix', label: 'Bug修复/反模式', guide: '常见问题修复、defensive coding、需要 antiPattern 字段', knowledgeTypes: ['solution'] },
    { id: 'project-profile', label: '项目特征', guide: '技术栈、目录结构、三方依赖、代码特征汇总', knowledgeTypes: ['architecture'] },
    { id: 'agent-guidelines', label: 'Agent开发注意事项', guide: '命名强制、线程安全、内存约束、架构边界规则', knowledgeTypes: ['boundary-constraint', 'code-standard'] },
  ];

  // 用 Skill 内容增强维度 guide（共享层增强点）
  const dimensions = _enhanceDimensions(baseDimensions, skillGuides, skillSections);

  const responseData = {
    report,
    targets: allTargets.map(t => {
      const name = typeof t === 'string' ? t : t.name;
      return {
        name,
        type: t.type || 'target',
        packageName: t.packageName || undefined,
        inferredRole: inferTargetRole(name),
        fileCount: (targetFileMap[name] || []).length,
      };
    }),
    filesByTarget: targetFileMap,
    dependencyGraph: depGraphData ? {
      nodes: (depGraphData.nodes || []).map(n => ({
        id: typeof n === 'string' ? n : n.id,
        label: typeof n === 'string' ? n : n.label,
      })),
      edges: depGraphData.edges || [],
    } : null,
    languageStats: langStats,
    primaryLanguage: primaryLang,
    languageExtension: buildLanguageExtension(primaryLang),
    guardSummary: guardAudit ? {
      totalViolations: guardAudit.summary?.totalViolations || 0,
      errors: guardAudit.summary?.errors || 0,
      warnings: guardAudit.summary?.warnings || 0,
    } : null,
    guardViolationFiles: guardAudit
      ? (guardAudit.files || []).filter(f => f.violations.length > 0).map(f => ({
          filePath: f.filePath,
          violations: f.violations.map(v => ({ ruleId: v.ruleId, severity: v.severity, message: v.message, line: v.line })),
        }))
      : [],

    // 9 维度分析框架
    analysisFramework: {
      dimensions,
      candidateRequiredFields: ['title', 'code', 'language', 'category', 'knowledgeType', 'reasoning'],
      submissionTool: 'autosnippet_submit_candidates',
      expectedOutput: '70-150 条候选，覆盖全部 9 维度',
    },

    // AST 代码结构分析上下文（供 ChatAgent 使用）
    astContext: astContext || null,
    astSummary: astProjectSummary ? {
      classes: astProjectSummary.classes.length,
      protocols: astProjectSummary.protocols.length,
      categories: astProjectSummary.categories.length,
      patterns: Object.keys(astProjectSummary.patternStats || {}),
      metrics: astProjectSummary.projectMetrics ? {
        totalMethods: astProjectSummary.projectMetrics.totalMethods,
        avgMethodsPerClass: astProjectSummary.projectMetrics.avgMethodsPerClass,
        maxNestingDepth: astProjectSummary.projectMetrics.maxNestingDepth,
        complexMethods: astProjectSummary.projectMetrics.complexMethods?.length || 0,
        longMethods: astProjectSummary.projectMetrics.longMethods?.length || 0,
      } : null,
    } : null,

    // 引导 Agent 下一步操作（严格质量要求）
    nextSteps: [
      '⚠️ 重要：以下 Candidate 为启发式初稿，质量不足以直接发布。你必须执行以下步骤提升质量：',
      '',
      '== 第一步：结构补齐 ==',
      '1. 调用 autosnippet_enrich_candidates(candidateIds) 获取每条候选的缺失字段清单',
      '2. 根据返回的 missingFields，分析 filesByTarget 中的代码内容，逐条补全：',
      '   - category（必填）: View/Service/Tool/Model/Network/Storage/UI/Utility',
      '   - trigger（必填）: @开头的触发词，如 @video-cover-cell',
      '   - summary_cn（必填）: ≤100字中文摘要，准确描述代码意图，禁止泛化模板',
      '   - summary_en（必填）: ≤100 words 英文摘要',
      '   - headers（必填）: 完整 import/include 语句数组',
      '   - reasoning.whyStandard（必填）: 为什么这段代码值得沉淀',
      '   - reasoning.sources（必填）: 来源文件路径列表',
      '   - reasoning.confidence（必填）: 置信度 0-1',
      '',
      '== 第二步：AI 内容润色 ==',
      '3. 调用 autosnippet_bootstrap_refine() 对全部候选进行 AI 精炼',
      '   - 改善模板化 summary → 精准自然语言描述',
      '   - 补充架构 insight 洞察',
      '   - 推断 relations 关联（requires/extends/calls）',
      '   - 调整 confidence 评分',
      '',
      '== 第三步：深入分析补充 ==',
      '4. 逐 Target 深入分析 filesByTarget，按 analysisFramework.dimensions 补充更细粒度候选',
      '5. 优先分析 priority=high 的文件和 inferredRole=core/service 的 Target',
      '6. 参考 dependencyGraph 理解模块间依赖关系',
      '7. 参考 guardViolationFiles 了解已发现的规范违反',
      '8. Bug修复维度需包含 antiPattern 字段（bad/why/fix）',
      '9. Agent注意事项维度需包含 trigger 字段（如 @agent-threading）',
      '10. 新提交的候选重复 Step 1-3 确保质量',
      '',
      '质量红线：summary 不得包含「本模块」「该文件」等泛化措辞；每条候选必须有 reasoning；confidence < 0.5 的需标注原因。',
    ],
  };

  // ═══════════════════════════════════════════════════════════
  // Phase 5: 逐维度提取代码特征 → 单一职责多条 Candidate
  // ═══════════════════════════════════════════════════════════
  const candidateResults = { created: 0, failed: 0, errors: [] };
  try {
    const candidateService = ctx.container.get('candidateService');
    if (candidateService) {
      for (const dim of dimensions) {
        try {
          // v3: 每维度返回 N 条候选（单一职责拆分）
          const candidates = _extractDimensionCandidates(dim, allFiles, targetFileMap, {
            depGraphData, guardAudit, langStats, primaryLang, astProjectSummary,
          });

          for (const c of candidates) {
            try {
              await candidateService.createFromToolParams({
                code: c.code,
                language: c.language,
                category: 'bootstrap',
                title: c.title,
                knowledgeType: c.knowledgeType || dim.knowledgeTypes[0],
                tags: ['bootstrap', dim.id, ...(c.tags || [])],
                scope: 'project',
                summary: c.summary,
                relations: c.relations || undefined,
                reasoning: {
                  whyStandard: c._skillReference || c.summary,
                  sources: c.sources,
                  confidence: c._skillEnhanced ? 0.7 : 0.6,
                  qualitySignals: {
                    completeness: c._skillEnhanced ? 'skill-enhanced' : 'partial',
                    origin: 'bootstrap-scan',
                    ...(c._skillEnhanced ? { skillSource: true } : {}),
                  },
                },
              }, 'bootstrap', {}, { userId: 'bootstrap_agent' });

              candidateResults.created++;
            } catch (itemErr) {
              candidateResults.failed++;
              candidateResults.errors.push({ dimension: dim.id, subTopic: c.subTopic, error: itemErr.message });
            }
          }
        } catch (dimErr) {
          candidateResults.failed++;
          candidateResults.errors.push({ dimension: dim.id, error: dimErr.message });
          ctx.logger.warn(`[Bootstrap] Candidate creation failed for ${dim.id}: ${dimErr.message}`);
        }
      }
    }
  } catch (e) {
    ctx.logger.warn(`[Bootstrap] Phase 5 Candidate creation failed: ${e.message}`);
  }

  report.phases.candidateCreation = candidateResults;
  report.totals.candidatesCreated = candidateResults.created;

  responseData.bootstrapCandidates = candidateResults;
  responseData.skillsLoaded = skillContext?.loaded || [];
  responseData.skillsEnhanced = skillsEnhanced;
  responseData.message = `Bootstrap 完成: ${allFiles.length} files, ${allTargets.length} targets, ${depEdgesWritten} graph edges, ${candidateResults.created} 条单一职责候选已创建${skillsEnhanced ? '（Skill 增强）' : ''}。${skillContext?.loaded?.length ? `已加载 Skills: ${skillContext.loaded.join(', ')}。` : ''}⚠️ 候选为启发式初稿，请务必执行后续 AI 精炼步骤提升质量。`;

  // ── SkillHooks: onBootstrapComplete (fire-and-forget) ──
  try {
    const skillHooks = ctx.container.get('skillHooks');
    skillHooks.run('onBootstrapComplete', {
      filesScanned: allFiles.length,
      targetsFound: allTargets.length,
      candidatesCreated: candidateResults.created,
      candidatesFailed: candidateResults.failed,
    }, { projectRoot: ctx.container.get('database')?.filename || '' })
      .catch(() => {}); // fire-and-forget
  } catch { /* skillHooks not available */ }

  return envelope({
    success: true,
    data: responseData,
    meta: { tool: 'autosnippet_bootstrap_knowledge', responseTimeMs: Date.now() - t0 },
  });
}

/**
 * bootstrapRefine — Phase 6 AI 润色
 *
 * 对 Bootstrap Phase 5 产出的候选进行 AI 二次精炼：
 * - 改善模板化描述 → 更自然精准
 * - 补充高阶架构洞察
 * - 推断并填充 relations 关联
 * - 调整 confidence 评分
 *
 * @param {object} ctx  MCP context { container, logger }
 * @param {object} args { candidateIds?: string[], userPrompt?: string, dryRun?: boolean }
 */
export async function bootstrapRefine(ctx, args) {
  const t0 = Date.now();
  const candidateService = ctx.container.get('candidateService');
  const aiProvider = ctx.container.get('aiProvider');

  if (!aiProvider) {
    return envelope({ success: false, error: 'AI provider not configured' });
  }

  const result = await candidateService.refineBootstrapCandidates(
    aiProvider,
    { candidateIds: args.candidateIds, userPrompt: args.userPrompt, dryRun: args.dryRun },
    { userId: 'external_agent' },
  );

  return envelope({
    success: true,
    data: {
      ...result,
      message: `Phase 6 AI 润色完成: ${result.refined}/${result.total} 条候选已更新${args.dryRun ? '（预览模式）' : ''}`,
    },
    meta: { tool: 'autosnippet_bootstrap_refine', responseTimeMs: Date.now() - t0 },
  });
}

// ─── Phase 5 辅助：多语言代码提取 ───────────────────────────

/**
 * 获取语言对应的类型定义正则
 */
function _getTypeDefPattern(lang) {
  switch (lang) {
    case 'objectivec':
      return /^\s*@(interface|implementation|protocol)\s+\w+/m;
    case 'swift':
      return /^\s*(public |open |internal |private |fileprivate )?(final\s+)?(class|struct|protocol|enum)\s+\w+/m;
    case 'javascript': case 'typescript':
      return /^\s*(export\s+)?(default\s+)?(abstract\s+)?(class|interface|type|enum)\s+\w+/m;
    case 'python':
      return /^\s*class\s+\w+/m;
    case 'java': case 'kotlin':
      return /^\s*(public |private |protected )?(abstract |data |sealed |open )?(class|interface|enum|object)\s+\w+/m;
    case 'go':
      return /^\s*type\s+\w+\s+(struct|interface)\b/m;
    case 'rust':
      return /^\s*(pub\s+)?(struct|enum|trait|impl)\s+\w+/m;
    default:
      return /^\s*(class|struct|protocol|enum|interface|type)\s+\w+/m;
  }
}

/**
 * 获取语言对应的最佳实践模式集合
 */
function _getBestPracticePatterns(lang) {
  switch (lang) {
    case 'objectivec':
      return {
        errorHandling: { label: '错误处理',
          regex: /\b(NSError\s*\*|@try\b|@catch\b|@throw\b|@finally\b|error:\s*\(NSError|if\s*\(\s*error\b|if\s*\(\s*!\s*\w+\s*\))/,
        },
        concurrency: { label: '并发/异步',
          regex: /\b(dispatch_async|dispatch_sync|dispatch_queue_create|dispatch_group|dispatch_semaphore|NSOperation|NSThread|@synchronized|performSelector.*Thread|dispatch_barrier)/,
        },
        memoryMgmt: { label: '内存管理',
          regex: /\b(__weak|__strong|__unsafe_unretained|weakSelf|strongSelf|typeof\(self\)|__block|dealloc\b|autoreleasepool|removeObserver)/,
        },
      };
    case 'swift':
      return {
        errorHandling: { label: '错误处理',
          regex: /\b(guard .+ else|throw\s|catch\s*[{(]|do\s*\{|Result<|try[?!]?\s)/,
        },
        concurrency: { label: '并发/异步',
          regex: /\b(async\b|await\b|Task\s*\{|Task\.detached|actor\b|@MainActor|@Sendable|DispatchQueue|TaskGroup)/,
        },
        memoryMgmt: { label: '内存管理',
          regex: /\b(\[weak\s|weak\s+var|unowned\s|autoreleasepool|deinit\b|\[unowned\s)/,
        },
      };
    case 'javascript': case 'typescript':
      return {
        errorHandling: { label: '错误处理',
          regex: /\b(try\s*\{|catch\s*\(|throw\s+new|\.catch\(|Promise\.reject|if\s*\(\s*err\b)/,
        },
        concurrency: { label: '并发/异步',
          regex: /\b(async\s+function|await\s|Promise\.all|Promise\.allSettled|new\s+Worker|setTimeout|setInterval|process\.nextTick)/,
        },
        memoryMgmt: { label: '资源管理',
          regex: /\b(\.close\(\)|\.destroy\(\)|\.dispose\(\)|finally\s*\{|AbortController|clearTimeout|clearInterval|removeEventListener)/,
        },
      };
    case 'python':
      return {
        errorHandling: { label: '错误处理',
          regex: /\b(try:|except\s|raise\s|finally:|with\s.*as\s)/,
        },
        concurrency: { label: '并发/异步',
          regex: /\b(async\s+def|await\s|asyncio\.|threading\.|multiprocessing\.|concurrent\.futures|Lock\(\)|Semaphore\()/,
        },
        memoryMgmt: { label: '资源管理',
          regex: /\b(with\s+open|__enter__|__exit__|contextmanager|\.close\(\)|atexit|weakref|gc\.collect)/,
        },
      };
    default:
      return {
        errorHandling: { label: '错误处理',
          regex: /\b(try|catch|throw|except|raise|error|Error)\b/,
        },
        concurrency: { label: '并发/异步',
          regex: /\b(async|await|thread|Thread|dispatch|concurrent|parallel|mutex|lock|Lock)\b/,
        },
        memoryMgmt: { label: '内存/资源管理',
          regex: /\b(close|dispose|destroy|cleanup|dealloc|free|release|finalize|defer)\b/,
        },
      };
  }
}

/**
 * 获取语言对应的调用链模式集合
 */
function _getCallChainPatterns(lang) {
  switch (lang) {
    case 'objectivec':
      return {
        delegate: { label: 'Delegate 委托',
          regex: /\b(delegate\b|Delegate\b|<\w+Delegate>|setDelegate:|\.delegate\s*=)/,
        },
        notification: { label: 'Notification 通知',
          regex: /\b(NSNotificationCenter|addObserver:|removeObserver:|postNotificationName:|NSNotification\b|\[\[NSNotificationCenter)/,
        },
        callback: { label: 'Block 回调',
          regex: /\b(completion[Hh]andler|completionBlock|success[Bb]lock|failure[Bb]lock|callback\b|\^\s*void|\^\s*\(|typedef\s+void\s*\(\^)/,
        },
        target_action: { label: 'Target-Action',
          regex: /\b(addTarget:|@selector\(|performSelector|action:@selector|SEL\s)/,
        },
      };
    case 'swift':
      return {
        delegate: { label: 'Delegate 委托',
          regex: /\b(delegate\b|Delegate\b|\.delegate\s*=|protocol\s+\w+Delegate)/,
        },
        notification: { label: 'Notification 通知',
          regex: /\b(NotificationCenter|\.post\(|\.addObserver|Notification\.Name)/,
        },
        reactive: { label: '响应式 (Combine/Rx)',
          regex: /\b(Publisher|Subscriber|\.sink\s*\{|\.subscribe|Combine|RxSwift|AnyPublisher|eraseToAnyPublisher)/,
        },
        callback: { label: 'Callback / Closure',
          regex: /\b(completion\s*:|handler\s*:|callback\s*:|escaping\s|@escaping)/,
        },
      };
    case 'javascript': case 'typescript':
      return {
        eventEmitter: { label: 'EventEmitter',
          regex: /\b(\.on\(|\.emit\(|\.addEventListener\(|\.removeEventListener|EventEmitter|EventTarget)/,
        },
        callback: { label: 'Callback / Promise',
          regex: /\b(\.then\(|\.catch\(|callback\s*[:(]|\.subscribe\(|new\s+Promise)/,
        },
        observable: { label: '响应式 (RxJS)',
          regex: /\b(Observable|Subject|BehaviorSubject|pipe\(|switchMap|mergeMap|combineLatest)/,
        },
      };
    default:
      return {
        delegate: { label: 'Delegate / 委托',
          regex: /\b(delegate|Delegate|listener|Listener|handler|Handler|callback|Callback)\b/,
        },
        notification: { label: '事件/通知',
          regex: /\b(notify|Notification|event|Event|emit|signal|Signal|publish|subscribe)\b/,
        },
      };
  }
}

/**
 * 获取语言对应的数据流模式集合
 */
function _getDataFlowPatterns(lang) {
  switch (lang) {
    case 'objectivec':
      return {
        kvo: { label: 'KVO',
          regex: /\b(addObserver:.*forKeyPath|observeValueForKeyPath|removeObserver:.*forKeyPath|NSKeyValueObservingOptionNew)/,
        },
        property: { label: '属性声明',
          regex: /^\s*@property\s*\(/m,
        },
        persistence: { label: '数据持久化',
          regex: /\b(NSUserDefaults|NSCoding|NSKeyedArchiver|NSKeyedUnarchiver|NSCoreDataStack|NSManagedObject|NSFetchRequest|CoreData\b|sqlite)/,
        },
        singleton: { label: 'Singleton',
          regex: /\b(sharedInstance|shared\b|defaultManager|dispatch_once|static\s+\w+\s*\*\s*_instance)/,
        },
      };
    case 'swift':
      return {
        swiftui: { label: 'SwiftUI 状态',
          regex: /\b(@Published|@State|@Binding|@Observable|@Environment|@ObservedObject|@StateObject|@EnvironmentObject)\b/,
        },
        combine: { label: 'Combine / Subject',
          regex: /\b(CurrentValueSubject|PassthroughSubject|AnyPublisher|Just\(|Future\(|\.assign\(to:)/,
        },
        kvo: { label: 'KVO / 属性观察',
          regex: /\b(willSet|didSet|observe\(|@objc\s+dynamic)/,
        },
      };
    case 'javascript': case 'typescript':
      return {
        stateManagement: { label: '状态管理',
          regex: /\b(useState|useReducer|createStore|createSlice|atom\(|ref\(|reactive\(|writable\(|signal\()/,
        },
        dataBinding: { label: '数据绑定',
          regex: /\b(useEffect|useMemo|computed|watch\(|subscribe|mobx|observable)/,
        },
      };
    case 'python':
      return {
        dataclass: { label: '数据模型',
          regex: /\b(@dataclass|BaseModel|pydantic|@property|__init__\s*\(self)/,
        },
        stateManagement: { label: '状态管理',
          regex: /\b(signal|slot|@receiver|django\.dispatch|celery|redis|queue\.Queue)/,
        },
      };
    default:
      return {
        stateManagement: { label: '状态/数据管理',
          regex: /\b(state|State|store|Store|model|Model|repository|Repository|cache|Cache)\b/,
        },
      };
  }
}

/**
 * 提取包含目标行的完整方法/函数体（大括号平衡法，适用 C 系语言）。
 * 返回提取的代码行数组。如果无法找到方法边界则返回上下文。
 *
 * @param {string[]} lines - 文件所有行
 * @param {number} targetIdx - 0-based 行索引
 * @param {string} lang - 语言标识
 * @param {number} maxLines - 最大提取行数
 * @returns {string[]}
 */
function _extractEnclosingBlock(lines, targetIdx, lang, maxLines = 40) {
  // Python：基于缩进
  if (lang === 'python') {
    let startIdx = targetIdx;
    for (let i = targetIdx; i >= Math.max(0, targetIdx - 50); i--) {
      if (/^\s*(def |class |async\s+def )/.test(lines[i])) { startIdx = i; break; }
    }
    const baseIndent = lines[startIdx].search(/\S/);
    let endIdx = startIdx;
    for (let i = startIdx + 1; i < Math.min(lines.length, startIdx + maxLines); i++) {
      if (lines[i].trim() === '') { endIdx = i; continue; }
      const indent = lines[i].search(/\S/);
      if (indent <= baseIndent) break;
      endIdx = i;
    }
    return lines.slice(startIdx, endIdx + 1);
  }

  // C 系语言（ObjC, Swift, JS/TS, Java, Go, Rust, etc.）：大括号平衡
  // Step 1: 向上找方法/函数起始行
  let startIdx = targetIdx;
  const methodStartRe = _getMethodStartRe(lang);
  for (let i = targetIdx; i >= Math.max(0, targetIdx - 60); i--) {
    if (methodStartRe.test(lines[i])) { startIdx = i; break; }
  }

  // Step 2: 向下用大括号计数找结束
  let braceCount = 0;
  let foundBrace = false;
  let endIdx = startIdx;
  for (let i = startIdx; i < Math.min(lines.length, startIdx + maxLines + 20); i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { braceCount++; foundBrace = true; }
      if (ch === '}') braceCount--;
    }
    endIdx = i;
    if (foundBrace && braceCount <= 0) break;
  }

  // 限制最大行数
  const extracted = lines.slice(startIdx, endIdx + 1);
  if (extracted.length > maxLines) {
    return [...extracted.slice(0, maxLines - 1), '    // ... (truncated)'];
  }
  return extracted;
}

/**
 * 获取"方法/函数起始行"识别正则
 */
function _getMethodStartRe(lang) {
  switch (lang) {
    case 'objectivec':
      return /^[-+]\s*\(|^@implementation\b|^@interface\b|^@protocol\b/;
    case 'swift':
      return /^\s*(public |open |internal |private |fileprivate )?(override\s+)?(static |class )?(func\s|init[?(]|deinit\b|subscript\s*[[(]|var\s+\w+.*\{\s*$)/;
    case 'javascript': case 'typescript':
      return /^\s*(export\s+)?(default\s+)?(async\s+)?function\b|^\s*(export\s+)?(default\s+)?class\b|^\s*(public |private |protected |static |async |get |set |readonly )*[\w$]+\s*\(|^\s*(const|let|var)\s+\w+\s*=/;
    case 'python':
      return /^\s*(async\s+)?def\s+|^\s*class\s+/;
    case 'java': case 'kotlin':
      return /^\s*(public |private |protected |static |final |abstract |override |suspend |open )*(fun |void |int |long |String |boolean |class |interface |Object |List |Map )/;
    case 'go':
      return /^\s*func\s/;
    case 'rust':
      return /^\s*(pub\s+)?(fn|impl|struct|enum|trait)\s/;
    default:
      return /^\s*(function|def|class|func|fn|pub fn|pub async fn|sub|proc)\b/;
  }
}

/**
 * 对一组文件按模式集合收集代码块。
 * 每个模式最多收集 samplePerPattern 个文件的代码块。
 * 返回 { codeBlocks: string[], sources: string[], stats: {label→fileCount} }
 */
function _collectPatternBlocks(patterns, allFiles, lang, { maxFileScan = 150, samplePerPattern = 3, maxLinesPerBlock = 35 } = {}) {
  const codeBlocks = [];
  const sources = [];
  const stats = {};

  for (const [key, p] of Object.entries(patterns)) {
    p._collected = [];
  }

  for (const f of allFiles.slice(0, maxFileScan)) {
    const lines = f.content.split('\n');
    for (const [key, p] of Object.entries(patterns)) {
      if (p._collected.length >= samplePerPattern) continue;
      if (!p.regex.test(f.content)) continue;

      // 找到第一个匹配行，提取完整方法体
      const matchIdx = lines.findIndex(l => p.regex.test(l));
      if (matchIdx < 0) continue;

      const block = _extractEnclosingBlock(lines, matchIdx, lang, maxLinesPerBlock);
      if (block.length < 2) continue; // 太短没意义

      const header = `// ── ${f.relativePath}:${matchIdx + 1} ──`;
      codeBlocks.push(header, ...block, '');
      p._collected.push(f.relativePath);
      if (!sources.includes(f.relativePath)) sources.push(f.relativePath);
    }
  }

  // 统计每个模式的全量命中文件数
  for (const [key, p] of Object.entries(patterns)) {
    stats[p.label] = allFiles.filter(f => p.regex.test(f.content)).length;
  }

  return { codeBlocks, sources, stats };
}

// ─── Phase 5 辅助：Skill 内容解析与融合 ────────────────────

/**
 * 将 Skill section 内容（分号分隔的摘要）解析为结构化规则列表
 * 处理 3 种格式：✅/❌ 代码注释、Markdown 表格行、纯文本描述
 * @param {string} content — _extractSectionSummary 输出
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

// ─── Phase 5 辅助：根据维度提取代表性代码 ───────────────────

/**
 * v3: 从扫描文件中按维度提取 N 条单一职责候选。
 * 每条候选: { title, subTopic, code, language, sources, summary, knowledgeType, tags, relations }
 * 不使用 AI，纯启发式。未检测到内容的子主题不产出。
 */
function _extractDimensionCandidates(dim, allFiles, targetFileMap, context) {
  const { depGraphData, guardAudit, langStats, primaryLang, astProjectSummary } = context;
  const lang = primaryLang || 'swift';
  const ast = astProjectSummary || null;

  let candidates;
  switch (dim.id) {
    case 'code-standard':    candidates = _extractCodeStandard(allFiles, lang, ast); break;
    case 'code-pattern':     candidates = _extractCodePattern(allFiles, lang, ast); break;
    case 'architecture':     candidates = _extractArchitecture(targetFileMap, depGraphData, lang, ast); break;
    case 'best-practice':    candidates = _extractBestPractice(allFiles, lang); break;
    case 'call-chain':       candidates = _extractCallChain(allFiles, lang); break;
    case 'data-flow':        candidates = _extractDataFlow(allFiles, lang); break;
    case 'bug-fix':          candidates = _extractBugFix(allFiles, guardAudit, lang); break;
    case 'project-profile':  candidates = _extractProjectProfile(allFiles, targetFileMap, depGraphData, guardAudit, langStats, lang, ast); break;
    case 'agent-guidelines': candidates = _extractAgentGuidelines(allFiles, lang); break;
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

// ── 辅助：构建 Markdown 候选文档 ──────────────────────────

function _buildCandidateDoc({ heading, oneLiner, bodyLines, codeBlocks, agentNotes, relationLines }) {
  const lines = [`# ${heading}`, '', `> ${oneLiner}`, ''];
  if (bodyLines?.length) {
    lines.push('## 约定', '', ...bodyLines, '');
  }
  if (codeBlocks?.length) {
    lines.push('## 代码示例', '');
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

function _makeTitle(dimId, subTopic) {
  return `[Bootstrap] ${dimId}/${subTopic}`;
}

// ── code-standard ─────────────────────────────────────────

function _extractCodeStandard(allFiles, lang, ast) {
  const results = [];
  const highPriFiles = allFiles.filter(f => inferFilePriority(f.name) === 'high');
  const samples = highPriFiles.length > 0 ? highPriFiles.slice(0, 6) : allFiles.filter(f => inferFilePriority(f.name) === 'medium').slice(0, 4);

  // ── naming ──
  const prefixCounts = {};

  // AST 增强：直接从解析的类名统计前缀（比 regex 更精确）
  if (ast && ast.classes.length > 0) {
    for (const cls of ast.classes) {
      const name = cls.name;
      if (!name || name.length < 3) continue;
      const prefix3 = name.slice(0, 3);
      const prefix2 = name.slice(0, 2);
      if (/^[A-Z]{2,3}$/.test(prefix3)) {
        prefixCounts[prefix3] = (prefixCounts[prefix3] || 0) + 1;
      } else if (/^[A-Z]{2}$/.test(prefix2)) {
        prefixCounts[prefix2] = (prefixCounts[prefix2] || 0) + 1;
      }
    }
  } else {
    // 降级：regex 扫描
    const typeDefRe = _getTypeDefPattern(lang);
    for (const f of allFiles.slice(0, 100)) {
      const match = f.content.match(typeDefRe);
      if (!match) continue;
      const name = match[0].trim().split(/\s+/).pop();
      if (!name || name.length < 3) continue;
      const prefix2 = name.slice(0, 2);
      const prefix3 = name.slice(0, 3);
      if (/^[A-Z]{2,3}$/.test(prefix3)) {
        prefixCounts[prefix3] = (prefixCounts[prefix3] || 0) + 1;
      } else if (/^[A-Z]{2}$/.test(prefix2)) {
        prefixCounts[prefix2] = (prefixCounts[prefix2] || 0) + 1;
      }
    }
  }
  const topPrefix = Object.entries(prefixCounts).sort((a, b) => b[1] - a[1])[0];

  if (samples.length > 0) {
    const codeBlocks = [];
    const sources = [];
    const typeDefRe = _getTypeDefPattern(lang);
    for (const f of samples.slice(0, 2)) {
      const fileLines = f.content.split('\n');
      const typeIdx = fileLines.findIndex(l => typeDefRe.test(l));
      const endLine = typeIdx >= 0 && typeIdx < 80 ? Math.min(fileLines.length, typeIdx + 20) : Math.min(fileLines.length, 40);
      codeBlocks.push({ language: lang, source: `${f.relativePath}:1`, lines: fileLines.slice(0, endLine) });
      sources.push(f.relativePath);
    }

    const prefixNote = topPrefix ? `项目使用 ${topPrefix[0]} 前缀（出现 ${topPrefix[1]} 次）` : '未检测到统一前缀';
    const bodyLines = [
      topPrefix ? `- **类名前缀**：统一使用 \`${topPrefix[0]}\` 前缀` : '- **类名前缀**：未检测到统一前缀',
      '- **命名风格**：以采样代码为准（见下方代码示例）',
    ];
    // AST 增强：补充类型声明统计
    if (ast) {
      bodyLines.push(`- **类型声明**：${ast.classes.length} 个类/结构体, ${ast.protocols.length} 个协议, ${ast.categories.length} 个 Category`);
      // 展示主要协议遵循关系
      const conformances = ast.classes.filter(c => c.protocols && c.protocols.length > 0);
      if (conformances.length > 0) {
        bodyLines.push(`- **协议遵循**：${conformances.length} 个类声明了协议遵循`);
      }
    }
    results.push({
      title: _makeTitle('code-standard', 'naming'),
      subTopic: 'naming',
      code: _buildCandidateDoc({
        heading: `${lang === 'objectivec' ? 'ObjC' : lang} 命名约定`,
        oneLiner: `${prefixNote}，从 ${ast ? ast.classes.length + ' 个 AST 类声明' : samples.length + ' 个核心文件'}中分析`,
        bodyLines,
        codeBlocks,
        agentNotes: [
          topPrefix ? `新建类必须使用 \`${topPrefix[0]}\` 前缀` : '遵循项目现有命名风格',
        ],
        relationLines: ['ENFORCES: [code-standard/file-organization] — 文件名需与类名匹配'],
      }),
      language: lang,
      sources,
      summary: `命名约定：${prefixNote}`,
      knowledgeType: 'code-standard',
      tags: ['naming'],
      relations: [{ type: 'ENFORCES', target: _makeTitle('code-standard', 'file-organization'), description: '文件名需与类名匹配' }],
    });
  }

  // ── file-organization ──
  const markCount = allFiles.filter(f => /\/\/\s*MARK:\s*-|#pragma\s+mark\s+/m.test(f.content)).length;
  const docCommentCount = allFiles.filter(f => /\/\/\/\s|\/\*\*[\s\S]*?\*\//.test(f.content)).length;

  if (samples.length > 0) {
    // 提取有 MARK 分段的文件示例
    const markSample = allFiles.find(f => /\/\/\s*MARK:\s*-|#pragma\s+mark\s+/.test(f.content));
    const codeBlocks = [];
    const sources = [];
    if (markSample) {
      const fileLines = markSample.content.split('\n');
      codeBlocks.push({ language: lang, source: `${markSample.relativePath}:1`, lines: fileLines.slice(0, 50) });
      sources.push(markSample.relativePath);
    }

    results.push({
      title: _makeTitle('code-standard', 'file-organization'),
      subTopic: 'file-organization',
      code: _buildCandidateDoc({
        heading: '文件组织与分段',
        oneLiner: `${markCount} 个文件使用 MARK 分段，${docCommentCount} 个文件使用文档注释`,
        bodyLines: [
          `- **MARK 分段**：${markCount} 个文件使用 MARK/pragma mark 分段`,
          `- **文档注释**：${docCommentCount} 个文件使用 /// 或 /** */ 注释`,
        ],
        codeBlocks,
        agentNotes: markCount > 0 ? ['新代码应使用 MARK: - 对代码分段'] : [],
      }),
      language: lang,
      sources,
      summary: `文件组织：MARK 分段 ${markCount} 文件, 文档注释 ${docCommentCount} 文件`,
      knowledgeType: 'code-standard',
      tags: ['file-organization'],
    });
  }

  return results;
}

// ── code-pattern ──────────────────────────────────────────

function _extractCodePattern(allFiles, lang, ast) {
  const results = [];

  // 检测设计模式
  const patternDefs = {
    singleton: { regex: lang === 'objectivec' ? /\bsharedInstance\b|dispatch_once/ : lang === 'swift' ? /\bstatic\s+(let|var)\s+shared\b/ : /\bgetInstance\b|\binstance\b.*=.*null/, label: '单例模式' },
    'protocol-delegate': { regex: lang === 'objectivec' ? /@protocol\s+\w+Delegate|<\w+Delegate>/ : lang === 'swift' ? /protocol\s+\w+Delegate|\.delegate\s*=/ : /implements\s+\w+Listener|\.addListener/, label: '协议委托模式' },
    category: { regex: lang === 'objectivec' ? /@interface\s+\w+\s*\(\w+\)/ : /extension\s+\w+/, label: lang === 'objectivec' ? 'Category 扩展' : 'Extension 扩展' },
    factory: { regex: /\+\s*\(instancetype\)|class\s+func\s+make|static\s+(func|create|from)/, label: '工厂方法' },
  };

  for (const [patternName, patternDef] of Object.entries(patternDefs)) {
    // AST 增强：优先用 AST 检测的模式来统计数量
    let astCount = 0;
    let astInstances = [];
    if (ast && ast.patternStats[patternName]) {
      astCount = ast.patternStats[patternName].count;
      astInstances = ast.patternStats[patternName].instances || [];
    }

    const matchingFiles = allFiles.filter(f => patternDef.regex.test(f.content));
    // AST + regex 联合：取更大的覆盖面
    const totalCount = Math.max(matchingFiles.length, astCount);
    if (totalCount === 0) continue;

    const sorted = matchingFiles
      .sort((a, b) => {
        const p = { high: 0, medium: 1, low: 2 };
        return (p[inferFilePriority(a.name)] || 1) - (p[inferFilePriority(b.name)] || 1);
      })
      .slice(0, 2);

    const codeBlocks = [];
    const sources = [];
    for (const f of sorted) {
      const fileLines = f.content.split('\n');
      const matchIdx = fileLines.findIndex(l => patternDef.regex.test(l));
      if (matchIdx < 0) continue;
      const block = _extractEnclosingBlock(fileLines, matchIdx, lang, 40);
      codeBlocks.push({ language: lang, source: `${f.relativePath}:${matchIdx + 1}`, lines: block });
      sources.push(f.relativePath);
    }

    if (codeBlocks.length === 0) continue;

    // AST 增强：补充结构化信息到 bodyLines
    const bodyLines = [
      `- **使用范围**：${totalCount} 处检测到此模式（AST: ${astCount}, 正则: ${matchingFiles.length}）`,
      `- **代表文件**：${sorted.map(f => f.relativePath).join(', ')}`,
    ];

    // AST 详细信息
    if (patternName === 'singleton' && astInstances.length > 0) {
      bodyLines.push(`- **单例方法**：${astInstances.map(i => '`' + (i.className || '') + '.' + (i.methodName || '') + '`').join(', ')}`);
    }
    if (patternName === 'protocol-delegate' && ast) {
      const delegateProps = (ast.fileSummaries || []).flatMap(fs => (fs.properties || []).filter(p => /delegate/i.test(p.name)));
      if (delegateProps.length > 0) {
        const weakCount = delegateProps.filter(p => (p.attributes || []).includes('weak')).length;
        bodyLines.push(`- **Delegate 属性**：${delegateProps.length} 个（weak: ${weakCount}, 非 weak: ${delegateProps.length - weakCount}）`);
        if (weakCount < delegateProps.length) {
          bodyLines.push(`- ⚠️ **建议**：${delegateProps.length - weakCount} 个 delegate 属性未使用 weak，存在循环引用风险`);
        }
      }
    }
    if (patternName === 'category' && ast && ast.categories.length > 0) {
      bodyLines.push(`- **Category 列表**：${ast.categories.slice(0, 8).map(c => '`' + c.className + '(' + c.categoryName + ')' + '`').join(', ')}`);
    }

    results.push({
      title: _makeTitle('code-pattern', patternName),
      subTopic: patternName,
      code: _buildCandidateDoc({
        heading: patternDef.label,
        oneLiner: `${totalCount} 处使用${patternDef.label}`,
        bodyLines,
        codeBlocks,
        agentNotes: [`使用${patternDef.label}时参考以上实现方式`],
      }),
      language: lang,
      sources,
      summary: `${patternDef.label}：${totalCount} 处检测到`,
      knowledgeType: 'code-pattern',
      tags: [patternName],
    });
  }

  // AST 增强：添加继承关系候选（仅当 AST 可用时）
  if (ast && ast.inheritanceGraph.length > 0) {
    const inheritEdges = ast.inheritanceGraph.filter(e => e.type === 'inherits');
    const conformEdges = ast.inheritanceGraph.filter(e => e.type === 'conforms');

    if (inheritEdges.length > 0 || conformEdges.length > 0) {
      const bodyLines = [`- **继承边**：${inheritEdges.length} 条`, `- **协议遵循边**：${conformEdges.length} 条`];

      // 构建继承树文本
      const treeLines = [];
      // 按超类分组
      const bySuper = {};
      for (const e of inheritEdges) {
        if (!bySuper[e.to]) bySuper[e.to] = [];
        bySuper[e.to].push(e.from);
      }
      for (const [superClass, subs] of Object.entries(bySuper).slice(0, 10)) {
        treeLines.push(`${superClass}`);
        for (const sub of subs.slice(0, 5)) {
          const protos = conformEdges.filter(e => e.from === sub).map(e => e.to);
          const protoStr = protos.length > 0 ? ` <${protos.join(', ')}>` : '';
          treeLines.push(`  └─ ${sub}${protoStr}`);
        }
      }

      results.push({
        title: _makeTitle('code-pattern', 'inheritance'),
        subTopic: 'inheritance',
        code: _buildCandidateDoc({
          heading: '类继承与协议遵循关系（AST）',
          oneLiner: `${inheritEdges.length} 条继承关系，${conformEdges.length} 条协议遵循`,
          bodyLines,
          codeBlocks: [{ language: 'text', source: 'AST 继承树', lines: treeLines }],
          agentNotes: [
            '新建类时注意选择合适的父类和协议遵循',
            '保持继承层级扁平，避免过深继承链',
          ],
        }),
        language: lang,
        sources: [...new Set(ast.classes.slice(0, 10).map(c => c.file).filter(Boolean))],
        summary: `继承关系：${inheritEdges.length} 条继承, ${conformEdges.length} 条协议遵循`,
        knowledgeType: 'code-pattern',
        tags: ['inheritance', 'protocol-conformance'],
      });
    }
  }

  return results;
}

// ── architecture ──────────────────────────────────────────

function _extractArchitecture(targetFileMap, depGraphData, lang, ast) {
  const results = [];
  const targetNames = Object.keys(targetFileMap);
  if (targetNames.length === 0) return results;

  // ── layer-overview ──
  const roles = {};
  for (const tn of targetNames) {
    const role = inferTargetRole(tn);
    if (!roles[role]) roles[role] = [];
    roles[role].push({ name: tn, files: (targetFileMap[tn] || []).length });
  }

  const bodyLines = [];
  bodyLines.push('| 角色 | 模块 | 文件数 |', '|------|------|--------|');
  for (const [role, targets] of Object.entries(roles).sort((a, b) => b[1].length - a[1].length)) {
    for (const t of targets) {
      bodyLines.push(`| ${role} | ${t.name} | ${t.files} |`);
    }
  }

  // AST 增强：补充代码结构统计
  if (ast) {
    bodyLines.push('');
    bodyLines.push(`- **AST 类型统计**：${ast.classes.length} 类, ${ast.protocols.length} 协议, ${ast.categories.length} Category`);
    if (ast.projectMetrics) {
      bodyLines.push(`- **方法统计**：${ast.projectMetrics.totalMethods} 个方法，平均 ${ast.projectMetrics.avgMethodsPerClass.toFixed(1)} 个/类`);
      bodyLines.push(`- **最大嵌套深度**：${ast.projectMetrics.maxNestingDepth}`);
      if (ast.projectMetrics.complexMethods.length > 0) {
        bodyLines.push(`- ⚠️ **高复杂度方法**：${ast.projectMetrics.complexMethods.length} 个 (cyclomatic > 10)`);
      }
      if (ast.projectMetrics.longMethods.length > 0) {
        bodyLines.push(`- ⚠️ **过长方法**：${ast.projectMetrics.longMethods.length} 个 (> 50 行)`);
      }
    }
  }

  results.push({
    title: _makeTitle('architecture', 'layer-overview'),
    subTopic: 'layer-overview',
    code: _buildCandidateDoc({
      heading: '分层架构概览',
      oneLiner: `${targetNames.length} 个模块/Target，按职责分为 ${Object.keys(roles).length} 种角色`,
      bodyLines,
      agentNotes: ['新增模块需明确所属层级', '遵循已有分层结构'],
      relationLines: ['PREREQUISITE: [project-profile] — 理解项目全貌后使用'],
    }),
    language: 'markdown',
    sources: targetNames.slice(0, 10),
    summary: `${targetNames.length} 个模块按职责分类`,
    knowledgeType: 'architecture',
    tags: ['layer-overview'],
    relations: [{ type: 'PREREQUISITE', target: _makeTitle('project-profile', 'overview'), description: '理解项目全貌后使用' }],
  });

  // ── dependency-graph ──
  if (depGraphData?.edges?.length > 0) {
    const depLines = depGraphData.edges.slice(0, 30).map(e => `- \`${e.from}\` → \`${e.to}\``);
    if (depGraphData.edges.length > 30) depLines.push(`- …另有 ${depGraphData.edges.length - 30} 条依赖`);

    results.push({
      title: _makeTitle('architecture', 'dependency-graph'),
      subTopic: 'dependency-graph',
      code: _buildCandidateDoc({
        heading: '模块依赖关系',
        oneLiner: `${depGraphData.edges.length} 条模块间依赖`,
        bodyLines: depLines,
        agentNotes: ['新增模块间依赖需遵循已有方向，禁止反向引入'],
      }),
      language: 'markdown',
      sources: ['SPM manifest'],
      summary: `${depGraphData.edges.length} 条模块间依赖关系`,
      knowledgeType: 'module-dependency',
      tags: ['dependency-graph'],
      relations: [{ type: 'RELATED', target: _makeTitle('architecture', 'layer-overview'), description: '依赖图支撑分层概览' }],
    });
  }

  return results;
}

// ── best-practice ─────────────────────────────────────────

function _extractBestPractice(allFiles, lang) {
  const results = [];
  const patterns = _getBestPracticePatterns(lang);

  for (const [key, pattern] of Object.entries(patterns)) {
    const matchingFiles = allFiles.filter(f => pattern.regex.test(f.content));
    if (matchingFiles.length === 0) continue;

    const sorted = matchingFiles.sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 };
      return (p[inferFilePriority(a.name)] || 1) - (p[inferFilePriority(b.name)] || 1);
    });

    const codeBlocks = [];
    const sources = [];
    for (const f of sorted.slice(0, 2)) {
      const fileLines = f.content.split('\n');
      const matchIdx = fileLines.findIndex(l => pattern.regex.test(l));
      if (matchIdx < 0) continue;
      const block = _extractEnclosingBlock(fileLines, matchIdx, lang, 35);
      if (block.length < 2) continue;
      codeBlocks.push({ language: lang, source: `${f.relativePath}:${matchIdx + 1}`, lines: block });
      sources.push(f.relativePath);
    }

    if (codeBlocks.length === 0) continue;

    // 构建关联关系
    const relations = [];
    if (key === 'errorHandling') {
      relations.push({ type: 'DEPENDS_ON', target: _makeTitle('code-standard', 'naming'), description: 'Error domain 遵循类名命名' });
    }
    if (key === 'memoryMgmt') {
      relations.push({ type: 'RELATED', target: _makeTitle('best-practice', 'concurrency'), description: 'weakSelf 与 GCD 结合使用' });
    }
    if (key === 'concurrency') {
      relations.push({ type: 'EXTENDS', target: _makeTitle('best-practice', 'memoryMgmt'), description: 'GCD 中的 weakSelf 模式' });
    }

    // 映射 key 到可读的 subTopic
    const subTopicMap = { errorHandling: 'error-handling', concurrency: 'concurrency', memoryMgmt: 'memory-mgmt' };
    const subTopic = subTopicMap[key] || key;

    results.push({
      title: _makeTitle('best-practice', subTopic),
      subTopic,
      code: _buildCandidateDoc({
        heading: `${pattern.label}约定`,
        oneLiner: `${matchingFiles.length} 个文件使用${pattern.label}模式`,
        bodyLines: [
          `- **使用范围**：${matchingFiles.length} 个文件`,
          `- **模式特征**：参考以下代码示例中的实际用法`,
        ],
        codeBlocks,
        agentNotes: [`新代码应遵循项目现有的${pattern.label}模式`],
        relationLines: relations.map(r => `${r.type}: [${r.target}] — ${r.description}`),
      }),
      language: lang,
      sources,
      summary: `${pattern.label}：${matchingFiles.length} 个文件使用`,
      knowledgeType: 'best-practice',
      tags: [subTopic],
      relations,
    });
  }

  return results;
}

// ── call-chain ────────────────────────────────────────────

function _extractCallChain(allFiles, lang) {
  const results = [];
  const patterns = _getCallChainPatterns(lang);

  for (const [key, pattern] of Object.entries(patterns)) {
    const matchingFiles = allFiles.filter(f => pattern.regex.test(f.content));
    if (matchingFiles.length === 0) continue;

    const sorted = matchingFiles.sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 };
      return (p[inferFilePriority(a.name)] || 1) - (p[inferFilePriority(b.name)] || 1);
    });

    const codeBlocks = [];
    const sources = [];
    for (const f of sorted.slice(0, 2)) {
      const fileLines = f.content.split('\n');
      const matchIdx = fileLines.findIndex(l => pattern.regex.test(l));
      if (matchIdx < 0) continue;
      const block = _extractEnclosingBlock(fileLines, matchIdx, lang, 35);
      if (block.length < 2) continue;
      codeBlocks.push({ language: lang, source: `${f.relativePath}:${matchIdx + 1}`, lines: block });
      sources.push(f.relativePath);
    }

    if (codeBlocks.length === 0) continue;

    results.push({
      title: _makeTitle('call-chain', key),
      subTopic: key,
      code: _buildCandidateDoc({
        heading: `${pattern.label}`,
        oneLiner: `${matchingFiles.length} 个文件使用${pattern.label}`,
        bodyLines: [
          `- **使用范围**：${matchingFiles.length} 个文件`,
          `- **使用场景**：参考以下代码示例`,
        ],
        codeBlocks,
        agentNotes: [`实现${pattern.label}时参考项目现有模式`],
      }),
      language: lang,
      sources,
      summary: `${pattern.label}：${matchingFiles.length} 个文件使用`,
      knowledgeType: 'call-chain',
      tags: [key],
    });
  }

  return results;
}

// ── data-flow ─────────────────────────────────────────────

function _extractDataFlow(allFiles, lang) {
  const results = [];
  const patterns = _getDataFlowPatterns(lang);

  for (const [key, pattern] of Object.entries(patterns)) {
    const matchingFiles = allFiles.filter(f => pattern.regex.test(f.content));
    if (matchingFiles.length === 0) continue;

    const sorted = matchingFiles.sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 };
      return (p[inferFilePriority(a.name)] || 1) - (p[inferFilePriority(b.name)] || 1);
    });

    const codeBlocks = [];
    const sources = [];
    for (const f of sorted.slice(0, 2)) {
      const fileLines = f.content.split('\n');
      const matchIdx = fileLines.findIndex(l => pattern.regex.test(l));
      if (matchIdx < 0) continue;
      const block = _extractEnclosingBlock(fileLines, matchIdx, lang, 35);
      if (block.length < 2) continue;
      codeBlocks.push({ language: lang, source: `${f.relativePath}:${matchIdx + 1}`, lines: block });
      sources.push(f.relativePath);
    }

    if (codeBlocks.length === 0) continue;

    results.push({
      title: _makeTitle('data-flow', key),
      subTopic: key,
      code: _buildCandidateDoc({
        heading: `${pattern.label}`,
        oneLiner: `${matchingFiles.length} 个文件使用${pattern.label}`,
        bodyLines: [
          `- **使用范围**：${matchingFiles.length} 个文件`,
        ],
        codeBlocks,
        agentNotes: [`数据管理应遵循项目现有的${pattern.label}模式`],
      }),
      language: lang,
      sources,
      summary: `${pattern.label}：${matchingFiles.length} 个文件使用`,
      knowledgeType: 'data-flow',
      tags: [key],
    });
  }

  return results;
}

// ── bug-fix ───────────────────────────────────────────────

function _extractBugFix(allFiles, guardAudit, lang) {
  const results = [];

  if (!guardAudit?.files) return results;

  const violationFiles = guardAudit.files.filter(f => f.violations.length > 0);
  if (violationFiles.length === 0) return results;

  // 按 ruleId 聚合
  const byRule = {};
  for (const vf of violationFiles) {
    for (const v of vf.violations) {
      if (!byRule[v.ruleId]) byRule[v.ruleId] = { ruleId: v.ruleId, severity: v.severity, message: v.message, files: [] };
      if (!byRule[v.ruleId].files.find(f => f.filePath === vf.filePath)) {
        byRule[v.ruleId].files.push({ filePath: vf.filePath, line: v.line });
      }
    }
  }

  for (const [ruleId, ruleData] of Object.entries(byRule)) {
    const codeBlocks = [];
    const sources = [];
    // 找到第一个有实际源码的违规
    for (const vf of ruleData.files.slice(0, 2)) {
      const matchFile = allFiles.find(f => f.path === vf.filePath);
      if (!matchFile) continue;
      const fileLines = matchFile.content.split('\n');
      const vLine = Math.max(0, (vf.line || 1) - 1);
      const block = _extractEnclosingBlock(fileLines, Math.min(vLine, fileLines.length - 1), lang, 30);
      codeBlocks.push({
        language: lang,
        source: `${matchFile.relativePath}:${vf.line || 1} ⚠️ [${ruleData.severity}]`,
        lines: [`// ⚠️ ${ruleData.ruleId}: ${ruleData.message}`, ...block],
      });
      sources.push(matchFile.relativePath);
    }

    if (codeBlocks.length === 0 && sources.length === 0) {
      // 没有源码但有违规记录
      sources.push('guard-audit');
    }

    // 推断关联的 best-practice
    const relations = [];
    if (/thread|sync|dispatch|main/.test(ruleId)) {
      relations.push({ type: 'ENFORCES', target: _makeTitle('best-practice', 'concurrency'), description: '并发安全约束' });
    }
    if (/retain|cycle|leak|memory/.test(ruleId)) {
      relations.push({ type: 'ENFORCES', target: _makeTitle('best-practice', 'memory-mgmt'), description: '内存管理约束' });
    }

    const slugRule = ruleId.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();

    results.push({
      title: _makeTitle('bug-fix', slugRule),
      subTopic: slugRule,
      code: _buildCandidateDoc({
        heading: `⚠️ ${ruleId}`,
        oneLiner: `${ruleData.files.length} 处违规 [${ruleData.severity}]: ${ruleData.message}`,
        bodyLines: [
          `- **严重级别**：${ruleData.severity}`,
          `- **违规次数**：${ruleData.files.length} 个文件`,
          `- **说明**：${ruleData.message}`,
        ],
        codeBlocks,
        agentNotes: [`⛔ 禁止触发 ${ruleId} 规则`],
        relationLines: relations.map(r => `${r.type}: [${r.target}] — ${r.description}`),
      }),
      language: lang,
      sources,
      summary: `${ruleId}: ${ruleData.files.length} 处违规 [${ruleData.severity}]`,
      knowledgeType: 'solution',
      tags: [slugRule, ruleData.severity],
      relations,
    });
  }

  return results;
}

// ── project-profile ───────────────────────────────────────

function _extractProjectProfile(allFiles, targetFileMap, depGraphData, guardAudit, langStats, lang, ast) {
  const targetNames = Object.keys(targetFileMap);
  const totalFiles = allFiles.length;
  const sortedLangs = Object.entries(langStats).sort((a, b) => b[1] - a[1]);

  const bodyLines = [];
  bodyLines.push('| 指标 | 值 |', '|------|-----|');
  bodyLines.push(`| 主语言 | ${lang} |`);
  bodyLines.push(`| 扫描文件数 | ${totalFiles} |`);
  bodyLines.push(`| 模块/Target 数 | ${targetNames.length} |`);
  bodyLines.push(`| SPM 依赖边数 | ${depGraphData?.edges?.length || 0} |`);
  bodyLines.push(`| Guard 违规数 | ${guardAudit?.summary?.totalViolations || 0} |`);

  // AST 增强指标
  if (ast) {
    bodyLines.push(`| 类/结构体 (AST) | ${ast.classes.length} |`);
    bodyLines.push(`| 协议 (AST) | ${ast.protocols.length} |`);
    bodyLines.push(`| Category/Extension (AST) | ${ast.categories.length} |`);
    bodyLines.push(`| 方法总数 (AST) | ${ast.projectMetrics?.totalMethods || 0} |`);
    bodyLines.push(`| 平均方法数/类 (AST) | ${(ast.projectMetrics?.avgMethodsPerClass || 0).toFixed(1)} |`);
    bodyLines.push(`| 最大嵌套深度 (AST) | ${ast.projectMetrics?.maxNestingDepth || 0} |`);
    if (ast.projectMetrics?.complexMethods?.length > 0) {
      bodyLines.push(`| ⚠️ 高复杂度方法 (AST) | ${ast.projectMetrics.complexMethods.length} |`);
    }
    if (ast.projectMetrics?.longMethods?.length > 0) {
      bodyLines.push(`| ⚠️ 过长方法 (AST) | ${ast.projectMetrics.longMethods.length} |`);
    }
    // 设计模式汇总
    const patternNames = Object.keys(ast.patternStats || {});
    if (patternNames.length > 0) {
      bodyLines.push(`| 检测到设计模式 (AST) | ${patternNames.join(', ')} |`);
    }
  }
  bodyLines.push('');
  bodyLines.push('### 语言分布', '', '| 扩展名 | 文件数 | 占比 |', '|--------|--------|------|');
  for (const [ext, count] of sortedLangs.slice(0, 8)) {
    bodyLines.push(`| .${ext} | ${count} | ${((count / totalFiles) * 100).toFixed(1)}% |`);
  }
  bodyLines.push('');
  bodyLines.push('### 模块结构', '', '| 模块名 | 职责 | 文件数 |', '|--------|------|--------|');
  for (const tn of targetNames.slice(0, 15)) {
    bodyLines.push(`| ${tn} | ${inferTargetRole(tn)} | ${(targetFileMap[tn] || []).length} |`);
  }
  if (targetNames.length > 15) bodyLines.push(`| …另有 ${targetNames.length - 15} 个模块 | | |`);

  const topLang = sortedLangs[0];
  return [{
    title: _makeTitle('project-profile', 'overview'),
    subTopic: 'overview',
    code: _buildCandidateDoc({
      heading: '项目概况',
      oneLiner: `${lang} 项目，${totalFiles} 个文件，${targetNames.length} 个模块`,
      bodyLines,
      agentNotes: ['阅读此文档了解项目全貌，再应用具体 Recipe'],
    }),
    language: 'markdown',
    sources: ['SPM manifest', 'file scan'],
    summary: `${lang} 项目，${totalFiles} 个文件，${targetNames.length} 个模块，主语言 ${topLang ? `.${topLang[0]}(${topLang[1]})` : '未知'}`,
    knowledgeType: 'architecture',
    tags: ['overview'],
  }];
}

// ── agent-guidelines ──────────────────────────────────────

function _extractAgentGuidelines(allFiles, lang) {
  const results = [];

  // ── TODO/FIXME 提取 ──
  const markerRe = /\/\/\s*(TODO|FIXME|WARNING|⚠️|IMPORTANT|HACK|XXX):\s*/;
  const pragmaRe = /^#pragma\s+mark\s+/;
  const hashMarkerRe = /^#\s*(TODO|FIXME|HACK|XXX|WARNING|IMPORTANT):\s*/;

  const markersByType = {};
  const markerSources = [];

  for (const f of allFiles.slice(0, 60)) {
    const fileLines = f.content.split('\n');
    for (let i = 0; i < fileLines.length; i++) {
      const line = fileLines[i];
      const match = line.match(markerRe) || line.match(hashMarkerRe);
      if (!match && !pragmaRe.test(line)) continue;

      const markerType = match ? match[1] : 'MARK';
      if (!markersByType[markerType]) markersByType[markerType] = [];
      if (markersByType[markerType].length >= 4) continue;

      const start = Math.max(0, i - 2);
      const end = Math.min(fileLines.length, i + 6);
      markersByType[markerType].push({
        file: f.relativePath,
        line: i + 1,
        context: fileLines.slice(start, end),
      });
      if (!markerSources.includes(f.relativePath)) markerSources.push(f.relativePath);
      i = end; // skip context
    }
  }

  // TODO/FIXME → 单独一条
  const todoFixmeTypes = ['TODO', 'FIXME', 'HACK', 'XXX'];
  const todoMarkers = todoFixmeTypes.flatMap(t => (markersByType[t] || []).map(m => ({ ...m, type: t })));

  if (todoMarkers.length > 0) {
    const codeBlocks = todoMarkers.slice(0, 6).map(m => ({
      language: lang,
      source: `${m.file}:${m.line} [${m.type}]`,
      lines: m.context,
    }));

    results.push({
      title: _makeTitle('agent-guidelines', 'todo-fixme'),
      subTopic: 'todo-fixme',
      code: _buildCandidateDoc({
        heading: '待办事项 (TODO/FIXME)',
        oneLiner: `${todoMarkers.length} 条待办标注`,
        bodyLines: todoFixmeTypes.filter(t => markersByType[t]?.length).map(t => `- **${t}**: ${markersByType[t].length} 条`),
        codeBlocks,
        agentNotes: ['修改相关代码时注意处理这些 TODO/FIXME'],
      }),
      language: lang,
      sources: markerSources,
      summary: `${todoMarkers.length} 条待办标注`,
      knowledgeType: 'boundary-constraint',
      tags: ['todo-fixme'],
    });
  }

  // WARNING/IMPORTANT → mandatory-rules
  const warnTypes = ['WARNING', '⚠️', 'IMPORTANT'];
  const warnMarkers = warnTypes.flatMap(t => (markersByType[t] || []).map(m => ({ ...m, type: t })));

  if (warnMarkers.length > 0) {
    const codeBlocks = warnMarkers.slice(0, 4).map(m => ({
      language: lang,
      source: `${m.file}:${m.line} [${m.type}]`,
      lines: m.context,
    }));

    results.push({
      title: _makeTitle('agent-guidelines', 'mandatory-rules'),
      subTopic: 'mandatory-rules',
      code: _buildCandidateDoc({
        heading: '强制规则 (WARNING/IMPORTANT)',
        oneLiner: `${warnMarkers.length} 条强制约束标注`,
        bodyLines: warnTypes.filter(t => markersByType[t]?.length).map(t => `- **${t}**: ${markersByType[t].length} 条`),
        codeBlocks,
        agentNotes: ['⛔ 这些标注是强制约束，必须遵守'],
      }),
      language: lang,
      sources: markerSources,
      summary: `${warnMarkers.length} 条强制约束`,
      knowledgeType: 'boundary-constraint',
      tags: ['mandatory-rules'],
    });
  }

  // fallback：如果什么都没检测到
  if (results.length === 0) {
    results.push({
      title: _makeTitle('agent-guidelines', 'todo-fixme'),
      subTopic: 'todo-fixme',
      code: _buildCandidateDoc({
        heading: '注释标注',
        oneLiner: '未发现 TODO/FIXME/WARNING/IMPORTANT 注释标注',
        bodyLines: ['- 已扫描 60 个文件，未检测到注释标注'],
        agentNotes: [],
      }),
      language: lang,
      sources: ['bootstrap-scan'],
      summary: '未发现注释标注',
      knowledgeType: 'boundary-constraint',
      tags: ['todo-fixme'],
    });
  }

  return results;
}
