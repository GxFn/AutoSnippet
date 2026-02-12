/**
 * MCP Handlers — Bootstrap 冷启动知识库初始化 (v3 + Skill-aware)
 *
 * 统一底层逻辑：ChatAgent 和外部 Agent (MCP) 共享同一套 Skill 增强的 Bootstrap。
 *
 * 共享层（所有调用者均受益）:
 *   Phase 1  → 文件收集（SPM Target 源文件扫描）
 *   Phase 2  → SPM 依赖关系 → knowledge_edges（模块级图谱）
 *   Phase 3  → Guard 规则审计
 *   Phase 3.5 → [Skill-aware] 加载 coldstart + language-reference Skills → 增强维度定义
 *   Phase 4  → 构建响应（filesByTarget + analysisFramework，含 Skill 增强的 guide）
 *   Phase 5  → 逐维度 × 子主题提取代码特征 → 创建 N 条 Candidate（PENDING 状态）
 *
 * ChatAgent-only 增强（在 ChatAgent.js #taskBootstrapPipeline 中）:
 *   Phase 6  → AI 润色候选（autoRefine=true 时）
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
 * 解析 coldstart SKILL.md 中的 "Per-Dimension Industry Reference Templates" 部分，
 * 提取每个维度的参考模板摘要作为增强 guide。
 * 解析 language-reference SKILL.md 提取语言专属最佳实践要点。
 *
 * @param {object} skillContext — 由 loadBootstrapSkills 返回
 * @returns {Record<string, string>} dimensionId → 增强后的 guide 文本
 */
function _extractSkillDimensionGuides(skillContext) {
  const guides = {};

  // ── 从 coldstart Skill 提取维度模板 ──
  if (skillContext.coldstartSkill) {
    const content = skillContext.coldstartSkill;

    // 匹配 "### 维度 N: xxx (dim-id) — 参考模板" 块
    const dimBlocks = content.matchAll(/###\s+维度\s*\d+\s*[:：]\s*(.+?)\s*\((\w[\w-]*)\)\s*[—–-]\s*参考模板\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/g);
    for (const match of dimBlocks) {
      const dimId = match[2]; // e.g. 'code-standard'
      const block = match[3];
      // 从 JSON 模板中提取 rationale 和 reasoning.whyStandard 作为增强 guide
      const rationaleMatch = block.match(/"rationale"\s*:\s*"([^"]{20,300})"/);
      const whyMatch = block.match(/"whyStandard"\s*:\s*"([^"]{20,200})"/);
      const extraGuide = [rationaleMatch?.[1], whyMatch?.[1]].filter(Boolean).join('。');
      if (extraGuide) {
        guides[dimId] = extraGuide;
      }
    }
  }

  // ── 从 language Skill 提取语言专属指引 ──
  if (skillContext.languageSkill) {
    const content = skillContext.languageSkill;

    // 提取顶层 ## 标题块的第一段文本作为语言通用增强
    const sections = content.matchAll(/^##\s+\d+\.\s+(.+?)(?:\s*\(.+\))?\s*\n([\s\S]*?)(?=\n##\s|\n---\s|$)/gm);
    for (const section of sections) {
      const heading = section[1].toLowerCase();
      const body = section[2];

      // 映射 heading → dimension id
      let dimId = null;
      if (/命名|naming/i.test(heading)) dimId = 'code-standard';
      else if (/模式|pattern|singleton|factory/i.test(heading)) dimId = 'code-pattern';
      else if (/架构|architecture|mvvm|mvc/i.test(heading)) dimId = 'architecture';
      else if (/最佳实践|best.?practice|错误处理|error|并发|concurrency|内存|memory/i.test(heading)) dimId = 'best-practice';

      if (dimId) {
        // 提取核心规则表格或第一段描述（最多200字符）
        const firstParagraph = body.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('```')).slice(0, 2).join(' ').trim();
        if (firstParagraph.length > 10) {
          guides[dimId] = guides[dimId]
            ? `${guides[dimId]}。[语言参考] ${firstParagraph.substring(0, 200)}`
            : `[语言参考] ${firstParagraph.substring(0, 200)}`;
        }
      }
    }
  }

  return guides;
}

/**
 * 增强 9 维度定义 — 将 Skill 提供的参考指引注入 dimensions[].guide
 *
 * @param {Array} dimensions — 原始维度数组
 * @param {Record<string, string>} skillGuides — 由 _extractSkillDimensionGuides 返回
 * @returns {Array} 增强后的维度数组（原数组不变，返回新数组）
 */
function _enhanceDimensions(dimensions, skillGuides) {
  if (!skillGuides || Object.keys(skillGuides).length === 0) return dimensions;

  return dimensions.map(dim => {
    const extra = skillGuides[dim.id];
    if (!extra) return dim;
    return {
      ...dim,
      guide: `${dim.guide}。[Skill 参考] ${extra}`,
      _skillEnhanced: true,
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
  const shouldLoadSkills = args.loadSkills ?? false;

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
  const skillGuides = skillContext ? _extractSkillDimensionGuides(skillContext) : {};
  const skillsEnhanced = Object.keys(skillGuides).length > 0;

  report.phases.skillLoading = {
    loaded: skillContext?.loaded || [],
    dimensionsEnhanced: Object.keys(skillGuides),
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
  const dimensions = _enhanceDimensions(baseDimensions, skillGuides);

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

    // 引导 Agent 下一步操作
    nextSteps: [
      '1. Phase 5 已为每个维度创建了概要 Candidate（见 bootstrapCandidates）',
      '2. 按 analysisFramework.dimensions 逐维度分析 filesByTarget 中的代码，补充更多候选',
      '3. 优先分析 priority=high 的文件和 inferredRole=core/service 的 Target',
      '4. 参考 dependencyGraph 理解模块间依赖关系',
      '5. 参考 guardViolationFiles 了解已发现的规范违反',
      '6. 按维度分批调用 autosnippet_submit_candidates 提交知识条目',
      '7. Bug修复维度需包含 antiPattern 字段（bad/why/fix）',
      '8. Agent注意事项维度需包含 trigger 字段（如 @agent-threading）',
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
            depGraphData, guardAudit, langStats, primaryLang,
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
                  whyStandard: c.summary,
                  sources: c.sources,
                  confidence: 0.6,
                  qualitySignals: { completeness: 'partial', origin: 'bootstrap-scan' },
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
  responseData.message = `Bootstrap 完成: ${allFiles.length} files, ${allTargets.length} targets, ${depEdgesWritten} graph edges, ${candidateResults.created} 条单一职责候选已创建${skillsEnhanced ? '（Skill 增强）' : ''}。${skillContext?.loaded?.length ? `已加载 Skills: ${skillContext.loaded.join(', ')}。` : ''}外部 Agent 可按 filesByTarget 继续补充更细粒度候选。`;

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
    { userId: 'cursor_agent' },
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

// ─── Phase 5 辅助：根据维度提取代表性代码 ───────────────────

/**
 * v3: 从扫描文件中按维度提取 N 条单一职责候选。
 * 每条候选: { title, subTopic, code, language, sources, summary, knowledgeType, tags, relations }
 * 不使用 AI，纯启发式。未检测到内容的子主题不产出。
 */
function _extractDimensionCandidates(dim, allFiles, targetFileMap, context) {
  const { depGraphData, guardAudit, langStats, primaryLang } = context;
  const lang = primaryLang || 'swift';

  switch (dim.id) {
    case 'code-standard':    return _extractCodeStandard(allFiles, lang);
    case 'code-pattern':     return _extractCodePattern(allFiles, lang);
    case 'architecture':     return _extractArchitecture(targetFileMap, depGraphData, lang);
    case 'best-practice':    return _extractBestPractice(allFiles, lang);
    case 'call-chain':       return _extractCallChain(allFiles, lang);
    case 'data-flow':        return _extractDataFlow(allFiles, lang);
    case 'bug-fix':          return _extractBugFix(allFiles, guardAudit, lang);
    case 'project-profile':  return _extractProjectProfile(allFiles, targetFileMap, depGraphData, guardAudit, langStats, lang);
    case 'agent-guidelines': return _extractAgentGuidelines(allFiles, lang);
    default:
      return [];
  }
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

function _extractCodeStandard(allFiles, lang) {
  const results = [];
  const highPriFiles = allFiles.filter(f => inferFilePriority(f.name) === 'high');
  const samples = highPriFiles.length > 0 ? highPriFiles.slice(0, 6) : allFiles.filter(f => inferFilePriority(f.name) === 'medium').slice(0, 4);

  // ── naming ──
  const prefixCounts = {};
  const typeDefRe = _getTypeDefPattern(lang);
  for (const f of allFiles.slice(0, 100)) {
    const match = f.content.match(typeDefRe);
    if (!match) continue;
    const name = match[0].trim().split(/\s+/).pop();
    if (!name || name.length < 3) continue;
    // 提取 2-3 字母前缀
    const prefix2 = name.slice(0, 2);
    const prefix3 = name.slice(0, 3);
    if (/^[A-Z]{2,3}$/.test(prefix3)) {
      prefixCounts[prefix3] = (prefixCounts[prefix3] || 0) + 1;
    } else if (/^[A-Z]{2}$/.test(prefix2)) {
      prefixCounts[prefix2] = (prefixCounts[prefix2] || 0) + 1;
    }
  }
  const topPrefix = Object.entries(prefixCounts).sort((a, b) => b[1] - a[1])[0];

  if (samples.length > 0) {
    const codeBlocks = [];
    const sources = [];
    for (const f of samples.slice(0, 2)) {
      const fileLines = f.content.split('\n');
      const typeIdx = fileLines.findIndex(l => typeDefRe.test(l));
      const endLine = typeIdx >= 0 && typeIdx < 80 ? Math.min(fileLines.length, typeIdx + 20) : Math.min(fileLines.length, 40);
      codeBlocks.push({ language: lang, source: `${f.relativePath}:1`, lines: fileLines.slice(0, endLine) });
      sources.push(f.relativePath);
    }

    const prefixNote = topPrefix ? `项目使用 ${topPrefix[0]} 前缀（出现 ${topPrefix[1]} 次）` : '未检测到统一前缀';
    results.push({
      title: _makeTitle('code-standard', 'naming'),
      subTopic: 'naming',
      code: _buildCandidateDoc({
        heading: `${lang === 'objectivec' ? 'ObjC' : lang} 命名约定`,
        oneLiner: `${prefixNote}，从 ${samples.length} 个核心文件中采样`,
        bodyLines: [
          topPrefix ? `- **类名前缀**：统一使用 \`${topPrefix[0]}\` 前缀` : '- **类名前缀**：未检测到统一前缀',
          '- **命名风格**：以采样代码为准（见下方代码示例）',
        ],
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

function _extractCodePattern(allFiles, lang) {
  const results = [];
  const typeDefRe = _getTypeDefPattern(lang);

  // 检测设计模式
  const patternDefs = {
    singleton: { regex: lang === 'objectivec' ? /\bsharedInstance\b|dispatch_once/ : lang === 'swift' ? /\bstatic\s+(let|var)\s+shared\b/ : /\bgetInstance\b|\binstance\b.*=.*null/, label: '单例模式' },
    'protocol-delegate': { regex: lang === 'objectivec' ? /@protocol\s+\w+Delegate|<\w+Delegate>/ : lang === 'swift' ? /protocol\s+\w+Delegate|\.delegate\s*=/ : /implements\s+\w+Listener|\.addListener/, label: '协议委托模式' },
    category: { regex: lang === 'objectivec' ? /@interface\s+\w+\s*\(\w+\)/ : /extension\s+\w+/, label: lang === 'objectivec' ? 'Category 扩展' : 'Extension 扩展' },
    factory: { regex: /\+\s*\(instancetype\)|class\s+func\s+make|static\s+(func|create|from)/, label: '工厂方法' },
  };

  for (const [patternName, patternDef] of Object.entries(patternDefs)) {
    const matchingFiles = allFiles.filter(f => patternDef.regex.test(f.content));
    if (matchingFiles.length === 0) continue;

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

    results.push({
      title: _makeTitle('code-pattern', patternName),
      subTopic: patternName,
      code: _buildCandidateDoc({
        heading: patternDef.label,
        oneLiner: `${matchingFiles.length} 个文件使用${patternDef.label}`,
        bodyLines: [
          `- **使用范围**：${matchingFiles.length} 个文件检测到此模式`,
          `- **代表文件**：${sorted.map(f => f.relativePath).join(', ')}`,
        ],
        codeBlocks,
        agentNotes: [`使用${patternDef.label}时参考以上实现方式`],
      }),
      language: lang,
      sources,
      summary: `${patternDef.label}：${matchingFiles.length} 个文件使用`,
      knowledgeType: 'code-pattern',
      tags: [patternName],
    });
  }

  return results;
}

// ── architecture ──────────────────────────────────────────

function _extractArchitecture(targetFileMap, depGraphData, lang) {
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

function _extractProjectProfile(allFiles, targetFileMap, depGraphData, guardAudit, langStats, lang) {
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
