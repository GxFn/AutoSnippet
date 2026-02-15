/**
 * MCP Handlers — Bootstrap 冷启动知识库初始化 (v5 + Async Fill)
 *
 * 统一底层逻辑：ChatAgent 和外部 Agent (MCP) 共享同一套 Skill 增强的 Bootstrap。
 *
 * v5 架构变更：快速骨架 + 异步逐维度填充（前端 loading 卡片 → 完成通知）
 *
 * 同步阶段（快速返回，~1-3s）:
 *   Phase 1   → 文件收集（SPM Target 源文件扫描）
 *   Phase 1.5 → AST 代码结构分析（Tree-sitter）
 *   Phase 2   → SPM 依赖关系 → knowledge_edges（模块级图谱）
 *   Phase 3   → Guard 规则审计
 *   Phase 3.5 → [Skill-aware] 加载 coldstart + language-reference Skills → 增强维度定义
 *   Phase 4   → 构建响应骨架（filesByTarget + analysisFramework + 任务清单）
 *
 * 异步阶段（后台逐一填充，通过 Socket.io 推送进度）:
 *   Phase 5   → 微观维度 × 子主题提取代码特征 → 创建 N 条 Candidate（PENDING 状态）
 *              skillWorthy 维度仅提取内容，不创建 Candidate（避免与 Skill 重复）
 *              anti-pattern 已移除 — 代码问题由 Guard 独立处理
 *   Phase 5.5 → 宏观维度（architecture/code-standard/project-profile/agent-guidelines）
 *              自动聚合为 Project Skill → 写入 AutoSnippet/skills/（不产生 Candidate）
 *
 * 进度推送事件（Socket.io + EventBus）:
 *   bootstrap:started        — 骨架创建完成，携带任务清单
 *   bootstrap:task-started   — 单个维度开始填充
 *   bootstrap:task-completed — 单个维度填充完成
 *   bootstrap:task-failed    — 单个维度失败
 *   bootstrap:all-completed  — 全部维度完成（前端弹出通知）
 *
 * 模块结构:
 *   bootstrap.js              ← 主入口 (本文件)
 *   bootstrap/skills.js       ← Skill 加载与维度增强
 *   bootstrap/patterns.js     ← 多语言代码模式匹配
 *   bootstrap/dimensions.js   ← 7 维度知识提取器
 *   bootstrap/projectSkills.js ← Phase 5.5 Project Skill 生成
 */

import fs from 'node:fs';
import path from 'node:path';
import { envelope } from '../envelope.js';
import { inferLang, detectPrimaryLanguage, buildLanguageExtension } from './LanguageExtensions.js';
import { inferTargetRole, inferFilePriority } from './TargetClassifier.js';
import { analyzeProject, generateContextForAgent, isAvailable as astIsAvailable } from '../../../core/AstAnalyzer.js';

// ── Sub-modules ──
import { loadBootstrapSkills, extractSkillDimensionGuides, enhanceDimensions } from './bootstrap/skills.js';
import { fillDimensionsV3 } from './bootstrap/pipeline/orchestrator.js';

// Re-export for external consumers
export { loadBootstrapSkills };

/**
 * bootstrapKnowledge — 一键初始化知识库 (Skill-aware)
 *
 * 覆盖 7 大知识维度: 项目规范、使用习惯、架构模式、代码模式、最佳实践、项目库特征、Agent开发注意事项
 * （注意：反模式/代码问题由 Guard 独立处理，不在 Bootstrap 覆盖范围）
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
    ? extractSkillDimensionGuides(skillContext)
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
  // skillWorthy 维度会在 Phase 5.5 自动生成 Project Skill（宏观叙事性知识）
  // 注意：anti-pattern 已移除 — 代码问题由 Guard 独立处理，bootstrap 不做错误检测
  //
  // 执行顺序优化（v5.1）：
  //   ⑧ ⑨ 提前到 ⑥ 前面执行 → deep-scan / category-scan 的中间结果
  //   通过 PipelineContext 缓存，供 project-profile 复用，避免重复扫描
  const baseDimensions = [
    // ① 代码规范（Dual: Skill + Candidate）— 新增 api-naming、comment-style 子主题
    { id: 'code-standard', label: '代码规范', guide: '命名约定（类名前缀/方法签名风格/API 命名）、注释风格（语言/格式/MARK 分段）、文件组织规范', knowledgeTypes: ['code-standard', 'code-style'],
      skillWorthy: true, dualOutput: true, skillMeta: { name: 'project-code-standard', description: 'Project coding standards and naming conventions (auto-generated by bootstrap)' } },
    // ② 代码模式（Candidate）— 新增 builder、observer、coordinator
    { id: 'code-pattern', label: '设计模式与代码惯例', guide: '单例/委托/Category·Extension/工厂/Builder/观察者/Coordinator 模式、继承关系', knowledgeTypes: ['code-pattern', 'code-relation', 'inheritance'] },
    // ③ 架构模式（Dual: Skill + Candidate）— 新增 boundary-rules 子主题
    { id: 'architecture', label: '架构模式', guide: '分层架构、模块职责与边界、依赖图、导入约束规则', knowledgeTypes: ['architecture', 'module-dependency', 'boundary-constraint'],
      skillWorthy: true, dualOutput: true, skillMeta: { name: 'project-architecture', description: 'Project architecture layers, module boundaries and dependency graph (auto-generated by bootstrap)' } },
    // ④ 最佳实践（Candidate）— 新增 logging、testing 子主题
    { id: 'best-practice', label: '最佳实践', guide: '错误处理、并发安全、内存管理、日志规范、测试模式', knowledgeTypes: ['best-practice'] },
    // ⑤ 事件与数据流（Candidate）— 合并原 call-chain + data-flow，消除重叠
    { id: 'event-and-data-flow', label: '事件与数据流', guide: '事件传播（Delegate/Notification/Block·Closure/Target-Action）、数据状态管理（KVO/属性观察/响应式/持久化）', knowledgeTypes: ['call-chain', 'data-flow'] },
    // ⑧ ObjC/Swift 深度扫描（dualOutput: Skill + Candidate → Recipe → Snippet）— 常量 + Hook
    // ★ 提前到 ⑥ 前面执行，中间结果缓存到 PipelineContext 供 project-profile 复用
    { id: 'objc-deep-scan', label: '深度扫描（常量/Hook）', guide: '全量扫描 #define 值宏/函数宏、extern/static 常量、Method Swizzling hook 对（Agent 必须使用项目常量，修改被 hook 方法前必须查阅 hook 清单）', knowledgeTypes: ['code-standard', 'code-pattern'],
      skillWorthy: true, dualOutput: true, skillMeta: { name: 'project-objc-deep-scan', description: 'Project #define macros, static constants, and Method Swizzling hooks (auto-generated by bootstrap)' } },
    // ⑨ Foundation/UIKit Category/Extension 专项扫描（dualOutput: Skill + Candidate → Recipe → Snippet）
    // ★ 提前到 ⑥ 前面执行，分类方法清单缓存到 PipelineContext 供 project-profile/base-extensions 复用
    { id: 'category-scan', label: '基础类分类方法扫描', guide: 'Foundation/UIKit Category/Extension 逐方法清单（含完整实现代码与项目使用频次），仅扫描基础类分类、不含业务代码（Agent 遇到同等功能必须使用项目已有分类方法，禁止重复实现）', knowledgeTypes: ['code-standard', 'code-pattern'],
      skillWorthy: true, dualOutput: true, skillMeta: { name: 'project-category-scan', description: 'Foundation/UIKit Category and Extension methods with implementations and usage patterns — base classes only, no business code (auto-generated by bootstrap)' } },
    // ⑥ 项目特征（Dual: Skill + Candidate）— v4.2: 8 个子主题
    // ★ 排在 ⑧⑨ 之后，可从 PipelineContext 读取 deep-scan/category-scan 的缓存结果
    { id: 'project-profile', label: '项目特征', guide: '技术栈、目录结构、三方依赖枚举与用途、Extension/Category 分类聚合、自定义基类层级与全局定义（宏/typealias/PCH）、系统事件 hook 与生命周期入口、基础设施服务注册表、Runtime 与语言互操作', knowledgeTypes: ['architecture'],
      skillWorthy: true, dualOutput: true, skillMeta: { name: 'project-profile', description: 'Project tech stack, module structure, third-party dependencies, base extensions/classes, event hooks, infrastructure services, and runtime/interop features (auto-generated by bootstrap)' } },
    // ⑦ Agent 开发注意事项（Skill）— 新增 deprecated-api、arch-constraints、coding-principles 子主题
    { id: 'agent-guidelines', label: 'Agent开发注意事项', guide: '三大核心原则（严谨性/深度特征挖掘/完整性）、命名强制、线程安全、内存约束、已废弃 API 标记、架构约束注释、TODO/FIXME', knowledgeTypes: ['boundary-constraint', 'code-standard'],
      skillWorthy: true, skillMeta: { name: 'project-agent-guidelines', description: 'Mandatory coding rules, deprecated APIs and agent constraints for this project (auto-generated by bootstrap)' } },
  ];

  // 用 Skill 内容增强维度 guide（共享层增强点）
  const dimensions = enhanceDimensions(baseDimensions, skillGuides, skillSections);

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

    // 9 维度分析框架（4 Skill-only + 2 dualOutput + 3 Candidate-only）
    // 注意：anti-pattern 已移除，代码问题由 Guard 独立处理
    analysisFramework: {
      dimensions,
      skillWorthyDimensions: dimensions.filter(d => d.skillWorthy).map(d => d.id),
      candidateOnlyDimensions: dimensions.filter(d => !d.skillWorthy).map(d => d.id),
      candidateRequiredFields: ['title', 'code', 'language', 'category', 'knowledgeType', 'reasoning'],
      submissionTool: 'autosnippet_submit_candidates',
      expectedOutput: '候选知识（微观代码维度：code-pattern/best-practice/event-and-data-flow + 深度扫描：objc-deep-scan/category-scan）+ 6 个 Project Skills（宏观叙事维度：code-standard/architecture/project-profile/agent-guidelines + 深度扫描：objc-deep-scan/category-scan）',
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
      '7. 参考 guardViolationFiles 了解已发现的规范违反（代码问题由 Guard 独立处理）',
      '8. Agent注意事项维度需包含 trigger 字段（如 @agent-threading）',
      '9. 新提交的候选重复 Step 1-3 确保质量',
      '',
      '== 注意：宏观维度走 Project Skills，不产生 Candidate ==',
      '宏观维度（architecture、code-standard、project-profile、agent-guidelines）',
      '已自动生成 Project Skill 到 AutoSnippet/skills/，可通过 autosnippet_load_skill 加载。',
      '这些维度不会创建 Candidate/Recipe，避免重复。后续 AI 精炼步骤仅针对微观维度的 Candidate。',
      '',
      '质量红线：summary 不得包含「本模块」「该文件」等泛化措辞；每条候选必须有 reasoning；confidence < 0.5 的需标注原因。',
      '三大核心原则（严谨性·深度特征·完整性）已写入 project-agent-guidelines Skill，Agent 加载后自动遵循。',
    ],
  };

  // ═══════════════════════════════════════════════════════════
  // Phase 5: 创建异步任务 — 骨架先返回，内容后填充
  //
  // 策略变更（v5）：
  //   旧：同步遍历所有维度 → 提取 + 创建 Candidate → 一次性返回
  //   新：快速创建任务清单 → 立即返回骨架 → 异步逐维度填充内容
  //       前端通过 Socket.io 接收进度更新，卡片 loading → 完成
  // ═══════════════════════════════════════════════════════════

  // 构建任务定义列表
  const taskDefs = dimensions.map(dim => ({
    id: dim.id,
    meta: {
      type: dim.skillWorthy ? 'skill' : 'candidate',
      dimId: dim.id,
      label: dim.label,
      skillWorthy: !!dim.skillWorthy,
      skillMeta: dim.skillMeta || null,
    },
  }));

  // 启动 BootstrapTaskManager 会话（通过正式 DI 获取单例）
  let bootstrapSession = null;
  try {
    const taskManager = ctx.container.get('bootstrapTaskManager');
    bootstrapSession = taskManager.startSession(taskDefs);
  } catch (e) {
    ctx.logger.warn(`[Bootstrap] BootstrapTaskManager init failed (graceful degradation): ${e.message}`);
  }

  // 立即构建骨架响应
  responseData.bootstrapSession = bootstrapSession ? bootstrapSession.toJSON() : null;
  responseData.bootstrapCandidates = { created: 0, failed: 0, errors: [], status: 'filling' };
  responseData.autoSkills = { created: 0, failed: 0, skills: [], errors: [], status: 'filling' };
  responseData.skillsLoaded = skillContext?.loaded || [];
  responseData.skillsEnhanced = skillsEnhanced;
  responseData.message = `Bootstrap 骨架已创建: ${allFiles.length} files, ${allTargets.length} targets, ${taskDefs.length} 个维度任务已排队，正在后台逐一填充...`;

  // ── 异步后台填充（fire-and-forget）──
  const fillContext = {
    ctx,
    dimensions,
    allFiles,
    targetFileMap,
    depGraphData,
    guardAudit,
    langStats,
    primaryLang,
    astProjectSummary,
    skillContext,
    skillsEnhanced,
    taskManager: (() => { try { return ctx.container.get('bootstrapTaskManager'); } catch { return null; } })(),
    sessionId: bootstrapSession?.id || null,
    projectRoot,
  };

  // 使用 setImmediate 避免阻塞 HTTP 响应
  setImmediate(() => {
    ctx.logger.info(`[Bootstrap] Dispatching v3 AI-First pipeline`);
    fillDimensionsV3(fillContext).catch(e => {
      ctx.logger.error(`[Bootstrap] Async fill (v3) failed: ${e.message}`);
    });
  });

  // ── SkillHooks: onBootstrapStarted (fire-and-forget) ──
  try {
    const skillHooks = ctx.container.get('skillHooks');
    skillHooks.run('onBootstrapComplete', {
      filesScanned: allFiles.length,
      targetsFound: allTargets.length,
      candidatesCreated: 0,       // 异步填充中，初始为 0
      candidatesFailed: 0,
      autoSkillsCreated: 0,
      autoSkills: [],
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
    return envelope({ success: false, message: 'AI provider not configured', errorCode: 'MISSING_AI_PROVIDER' });
  }

  // 接入 BootstrapTaskManager 双通道推送 refine:* 事件
  let onProgress = null;
  try {
    const taskManager = ctx.container.get('bootstrapTaskManager');
    onProgress = (eventName, data) => taskManager.emitProgress(eventName, data);
  } catch { /* optional */ }

  const result = await candidateService.refineBootstrapCandidates(
    aiProvider,
    { candidateIds: args.candidateIds, userPrompt: args.userPrompt, dryRun: args.dryRun, onProgress },
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
