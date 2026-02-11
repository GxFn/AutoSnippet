/**
 * MCP Handlers — Bootstrap 冷启动知识库初始化
 *
 * 设计原则：MCP 调用方是外部 AI Agent，不使用项目内置 AI。
 * 本工具做结构数据收集 + 9 维度 Candidate 自动创建：
 *   Phase 1  → 文件收集（SPM Target 源文件扫描）
 *   Phase 2  → SPM 依赖关系 → knowledge_edges（模块级图谱）
 *   Phase 3  → Guard 规则审计
 *   Phase 4  → 构建响应（filesByTarget + analysisFramework）
 *   Phase 5  → 逐维度提取代码特征 → 创建 Candidate（PENDING 状态）
 *
 * 最终每个维度生成 1 条概要 Candidate，外部 Agent 可根据返回的
 * filesByTarget 继续按文件粒度补充更多候选。
 */

import fs from 'node:fs';
import path from 'node:path';
import { envelope } from '../envelope.js';
import { inferLang, detectPrimaryLanguage, buildLanguageExtension } from './LanguageExtensions.js';
import { inferTargetRole, inferFilePriority } from './TargetClassifier.js';
import { buildReasoning, buildCandidateMetadata } from './candidate.js';

/**
 * bootstrapKnowledge — 一键初始化知识库
 *
 * 覆盖 9 大知识维度: 项目规范、使用习惯、架构模式、代码模式、最佳实践、Bug修复方式、知识图谱、项目库特征、Agent开发注意事项
 * 为每个维度自动创建 Candidate（PENDING），外部 Agent 可按文件粒度补充更多候选。
 */
export async function bootstrapKnowledge(ctx, args) {
  const t0 = Date.now();
  const projectRoot = process.env.ASD_PROJECT_DIR || process.cwd();
  const maxFiles = args.maxFiles || 500;
  const skipGuard = args.skipGuard || false;
  const contentMaxLines = args.contentMaxLines || 120;

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

  // 9 维度定义（Phase 4 响应 + Phase 5 候选创建共用）
  const dimensions = [
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
  // Phase 5: 逐维度提取代码特征 → 自动创建 Candidate
  // ═══════════════════════════════════════════════════════════
  const candidateResults = { created: 0, failed: 0, errors: [] };
  try {
    const candidateService = ctx.container.get('candidateService');
    if (candidateService) {
      for (const dim of dimensions) {
        try {
          // 收集该维度的代表性代码片段
          const codeSnippets = _extractDimensionCode(dim, allFiles, targetFileMap, {
            depGraphData, guardAudit, langStats, primaryLang,
          });

          const metadata = {
            title: `[Bootstrap] ${dim.label}`,
            description: codeSnippets.summary,
            knowledgeType: dim.knowledgeTypes[0],
            tags: ['bootstrap', dim.id],
            scope: 'project',
            summary: codeSnippets.summary,
          };

          const reasoning = {
            whyStandard: codeSnippets.summary,
            sources: codeSnippets.sources,
            confidence: 0.6,
            qualitySignals: { completeness: 'partial', origin: 'bootstrap-scan' },
          };

          await candidateService.createCandidate({
            code: codeSnippets.code,
            language: codeSnippets.language || primaryLang || 'swift',
            category: 'bootstrap',
            source: 'bootstrap',
            reasoning,
            metadata,
          }, { userId: 'bootstrap_agent' });

          candidateResults.created++;
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
  responseData.message = `Bootstrap 完成: ${allFiles.length} files, ${allTargets.length} targets, ${depEdgesWritten} graph edges, ${candidateResults.created} 维度候选已创建。外部 Agent 可按 filesByTarget 继续补充更细粒度候选。`;

  return envelope({
    success: true,
    data: responseData,
    meta: { tool: 'autosnippet_bootstrap_knowledge', responseTimeMs: Date.now() - t0 },
  });
}

// ─── Phase 5 辅助：根据维度提取代表性代码 ───────────────────

/**
 * 从扫描文件中按维度提取代表性代码，生成 Markdown 格式的分析文档。
 * 不使用 AI，纯基于文件名/内容特征的启发式匹配。
 * 返回 { code, sources, language, summary }
 */
function _extractDimensionCode(dim, allFiles, targetFileMap, context) {
  const { depGraphData, guardAudit, langStats, primaryLang } = context;
  const sources = [];
  const md = []; // markdown lines
  const lang = primaryLang || 'swift';

  switch (dim.id) {
    case 'code-standard': {
      const samples = allFiles
        .filter(f => inferFilePriority(f.name) === 'high')
        .slice(0, 3);
      const total = allFiles.filter(f => inferFilePriority(f.name) === 'high').length;
      md.push(`# 代码规范`, '');
      md.push(`> 从 ${total} 个核心文件中采样 ${samples.length} 个，展示命名约定与注释风格。`, '');
      if (samples.length === 0) {
        md.push('*未发现高优先级文件，需手动补充代码规范。*');
      }
      for (const f of samples) {
        const head = f.content.split('\n').slice(0, 25);
        // 提取 import/include 统计
        const imports = head.filter(l => /^\s*(import|#import|#include|@import)\b/.test(l));
        md.push(`## ${f.relativePath}`, '');
        if (imports.length > 0) {
          md.push(`**导入语句** (${imports.length} 条)：`);
          md.push('```' + lang);
          md.push(...imports);
          md.push('```', '');
        }
        md.push('**文件头部结构**：');
        md.push('```' + lang);
        md.push(...head);
        md.push('```', '');
        sources.push(f.relativePath);
      }
      break;
    }

    case 'code-pattern': {
      const patternFiles = allFiles
        .filter(f => /\b(class|struct|protocol|enum|interface|abstract)\b/.test(f.content));
      const defsMap = {};
      let totalDefs = 0;
      for (const f of patternFiles.slice(0, 8)) {
        const defs = f.content.split('\n')
          .filter(l => /^\s*(public |open |internal |private |fileprivate )?(class|struct|protocol|enum|interface|abstract)\b/.test(l));
        if (defs.length > 0) {
          defsMap[f.relativePath] = defs.slice(0, 6);
          totalDefs += defs.length;
          sources.push(f.relativePath);
        }
      }
      md.push(`# 代码模式 & 类型定义`, '');
      md.push(`> 扫描到 ${patternFiles.length} 个含类型定义的文件，共 ${totalDefs}+ 个声明。`, '');
      if (Object.keys(defsMap).length === 0) {
        md.push('*未发现 class/struct/protocol/enum 定义。*');
      }
      for (const [fp, defs] of Object.entries(defsMap)) {
        md.push(`## ${fp}`, '');
        md.push('```' + lang);
        md.push(...defs);
        md.push('```', '');
      }
      break;
    }

    case 'architecture': {
      const targetNames = Object.keys(targetFileMap);
      const roles = {};
      for (const tn of targetNames) {
        const role = inferTargetRole(tn);
        if (!roles[role]) roles[role] = [];
        roles[role].push({ name: tn, files: (targetFileMap[tn] || []).length });
        sources.push(tn);
      }
      md.push(`# 架构模式`, '');
      md.push(`> ${targetNames.length} 个模块/Target，按职责分类如下。`, '');
      for (const [role, targets] of Object.entries(roles).sort((a, b) => b[1].length - a[1].length)) {
        md.push(`## ${role} (${targets.length} 个模块)`, '');
        md.push('| 模块名 | 文件数 |');
        md.push('|--------|--------|');
        for (const t of targets) {
          md.push(`| ${t.name} | ${t.files} |`);
        }
        md.push('');
      }
      if (depGraphData?.edges?.length) {
        md.push(`## 模块依赖关系 (${depGraphData.edges.length} 条)`, '');
        md.push('关键依赖链：', '');
        for (const e of depGraphData.edges.slice(0, 15)) {
          md.push(`- \`${e.from}\` → \`${e.to}\``);
        }
        if (depGraphData.edges.length > 15) {
          md.push(`- …另有 ${depGraphData.edges.length - 15} 条依赖`);
        }
        md.push('');
      }
      break;
    }

    case 'best-practice': {
      const patterns = {
        errorHandling: { label: '错误处理', regex: /\b(guard .+ else|throw |catch\s*[{(]|do\s*\{|NSError|Result<)/,
          files: [] },
        concurrency: { label: '并发/异步', regex: /\b(async|await|DispatchQueue|Task\s*\{|actor\b|@MainActor|Sendable)/,
          files: [] },
        memoryMgmt: { label: '内存管理', regex: /\b(\[weak |weak var|unowned|autoreleasepool|deinit\b)/,
          files: [] },
      };
      for (const f of allFiles.slice(0, 100)) {
        for (const [key, p] of Object.entries(patterns)) {
          if (p.regex.test(f.content) && p.files.length < 3) {
            const hits = f.content.split('\n')
              .map((l, i) => ({ line: l.trim(), num: i + 1 }))
              .filter(({ line }) => p.regex.test(line))
              .slice(0, 4);
            if (hits.length > 0) {
              p.files.push({ path: f.relativePath, hits });
              sources.push(f.relativePath);
            }
          }
        }
      }
      md.push(`# 最佳实践`, '');
      for (const [key, p] of Object.entries(patterns)) {
        const fileCount = allFiles.filter(f => p.regex.test(f.content)).length;
        md.push(`## ${p.label} (${fileCount} 个文件涉及)`, '');
        if (p.files.length === 0) {
          md.push(`*未检测到 ${p.label} 模式。*`, '');
          continue;
        }
        for (const fp of p.files) {
          md.push(`**${fp.path}**：`);
          md.push('```' + lang);
          fp.hits.forEach(h => md.push(`/* L${h.num} */ ${h.line}`));
          md.push('```', '');
        }
      }
      break;
    }

    case 'call-chain': {
      const chainTypes = {
        delegate: { label: 'Delegate 委托', regex: /\b(delegate|Delegate)\b/, files: [] },
        notification: { label: 'Notification 通知', regex: /\b(NotificationCenter|\.post\(|\.addObserver)\b/, files: [] },
        reactive: { label: '响应式 (Combine/Rx)', regex: /\b(Publisher|Subscriber|\.sink|\.subscribe|Combine|RxSwift)\b/, files: [] },
        callback: { label: 'Callback / Closure', regex: /\b(completion|handler|callback|Callback)\s*[:=]/, files: [] },
      };
      for (const f of allFiles.slice(0, 100)) {
        for (const [key, p] of Object.entries(chainTypes)) {
          if (p.regex.test(f.content) && p.files.length < 3) {
            const hits = f.content.split('\n')
              .filter(l => p.regex.test(l))
              .slice(0, 5)
              .map(l => l.trim());
            if (hits.length > 0) {
              p.files.push({ path: f.relativePath, hits });
              sources.push(f.relativePath);
            }
          }
        }
      }
      md.push(`# 调用链 & 通信模式`, '');
      for (const [key, p] of Object.entries(chainTypes)) {
        const count = allFiles.filter(f => p.regex.test(f.content)).length;
        md.push(`## ${p.label} (${count} 个文件)`, '');
        if (p.files.length === 0) {
          md.push(`*未检测到 ${p.label} 模式。*`, '');
          continue;
        }
        for (const fp of p.files) {
          md.push(`**${fp.path}**：`);
          md.push('```' + lang);
          md.push(...fp.hits);
          md.push('```', '');
        }
      }
      break;
    }

    case 'data-flow': {
      const flowTypes = {
        swiftui: { label: 'SwiftUI 状态', regex: /\b(@Published|@State|@Binding|@Observable|@Environment|@ObservedObject|@StateObject)\b/, files: [] },
        combine: { label: 'Combine / Subject', regex: /\b(CurrentValueSubject|PassthroughSubject|AnyPublisher|Just\(|Future\()\b/, files: [] },
        kvo: { label: 'KVO / 属性观察', regex: /\b(willSet|didSet|observe\(|addObserver|@objc dynamic)\b/, files: [] },
      };
      for (const f of allFiles.slice(0, 100)) {
        for (const [key, p] of Object.entries(flowTypes)) {
          if (p.regex.test(f.content) && p.files.length < 3) {
            const hits = f.content.split('\n')
              .filter(l => p.regex.test(l))
              .slice(0, 5)
              .map(l => l.trim());
            if (hits.length > 0) {
              p.files.push({ path: f.relativePath, hits });
              sources.push(f.relativePath);
            }
          }
        }
      }
      md.push(`# 数据流 & 状态管理`, '');
      for (const [key, p] of Object.entries(flowTypes)) {
        const count = allFiles.filter(f => p.regex.test(f.content)).length;
        md.push(`## ${p.label} (${count} 个文件)`, '');
        if (p.files.length === 0) {
          md.push(`*未检测到 ${p.label} 模式。*`, '');
          continue;
        }
        for (const fp of p.files) {
          md.push(`**${fp.path}**：`);
          md.push('```' + lang);
          md.push(...fp.hits);
          md.push('```', '');
        }
      }
      break;
    }

    case 'bug-fix': {
      md.push(`# Bug 修复 & 反模式`, '');
      if (!guardAudit?.files || guardAudit.files.filter(f => f.violations.length > 0).length === 0) {
        md.push('*Guard 审计未发现违规，无反模式候选。*');
        md.push('', '> 可通过 `autosnippet_guard_audit_files` 对特定文件进行深度审计。');
      } else {
        const violationFiles = guardAudit.files.filter(f => f.violations.length > 0);
        const totalV = guardAudit.summary?.totalViolations || 0;
        const errorCount = guardAudit.summary?.errors || 0;
        const warnCount = guardAudit.summary?.warnings || 0;
        md.push(`> Guard 审计发现 **${totalV}** 项违规（${errorCount} errors, ${warnCount} warnings），涉及 ${violationFiles.length} 个文件。`, '');
        for (const vf of violationFiles.slice(0, 5)) {
          md.push(`## ${path.basename(vf.filePath)}`, '');
          md.push('| 级别 | 行号 | 规则 | 说明 |');
          md.push('|------|------|------|------|');
          for (const v of vf.violations.slice(0, 5)) {
            md.push(`| ${v.severity} | L${v.line} | ${v.ruleId} | ${v.message} |`);
          }
          md.push('');
          sources.push(vf.filePath);
        }
      }
      break;
    }

    case 'project-profile': {
      const targetNames = Object.keys(targetFileMap);
      const totalFiles = allFiles.length;
      const sortedLangs = Object.entries(langStats).sort((a, b) => b[1] - a[1]);
      md.push(`# 项目概况`, '');
      md.push(`| 指标 | 值 |`);
      md.push(`|------|-----|`);
      md.push(`| 主语言 | ${primaryLang || 'unknown'} |`);
      md.push(`| 扫描文件数 | ${totalFiles} |`);
      md.push(`| 模块/Target 数 | ${targetNames.length} |`);
      md.push(`| SPM 依赖边数 | ${depGraphData?.edges?.length || 0} |`);
      md.push(`| Guard 违规数 | ${guardAudit?.summary?.totalViolations || 0} |`);
      md.push('');
      md.push(`## 语言分布`, '');
      md.push('| 扩展名 | 文件数 | 占比 |');
      md.push('|--------|--------|------|');
      for (const [ext, count] of sortedLangs.slice(0, 10)) {
        const pct = ((count / totalFiles) * 100).toFixed(1);
        md.push(`| .${ext} | ${count} | ${pct}% |`);
      }
      md.push('');
      md.push(`## 模块结构`, '');
      md.push('| 模块名 | 职责 | 文件数 |');
      md.push('|--------|------|--------|');
      for (const tn of targetNames.slice(0, 20)) {
        md.push(`| ${tn} | ${inferTargetRole(tn)} | ${(targetFileMap[tn] || []).length} |`);
      }
      if (targetNames.length > 20) md.push(`| …另有 ${targetNames.length - 20} 个模块 | | |`);
      md.push('');
      sources.push('SPM manifest', 'file scan');
      break;
    }

    case 'agent-guidelines': {
      const markTypes = { MARK: [], TODO: [], FIXME: [], WARNING: [], IMPORTANT: [], NOTE: [] };
      for (const f of allFiles.slice(0, 30)) {
        const markers = f.content.split('\n')
          .map((l, i) => ({ line: l.trim(), num: i + 1, file: f.relativePath }))
          .filter(({ line }) => /\/\/\s*(MARK|TODO|FIXME|WARNING|⚠️|IMPORTANT|NOTE):/.test(line));
        for (const m of markers.slice(0, 5)) {
          const type = Object.keys(markTypes).find(k => m.line.includes(k + ':')) || 'NOTE';
          if (markTypes[type] && markTypes[type].length < 8) {
            markTypes[type].push(m);
            if (!sources.includes(m.file)) sources.push(m.file);
          }
        }
      }
      md.push(`# Agent 开发注意事项`, '');
      md.push('> 从源文件注释中提取的关键标注，反映项目约束和待办事项。', '');
      let hasAny = false;
      for (const [type, items] of Object.entries(markTypes)) {
        if (items.length === 0) continue;
        hasAny = true;
        md.push(`## ${type} (${items.length} 条)`, '');
        for (const m of items) {
          md.push(`- **${m.file}** L${m.num}: \`${m.line}\``);
        }
        md.push('');
      }
      if (!hasAny) {
        md.push('*未发现 MARK/TODO/FIXME/WARNING/IMPORTANT 注释标注。*');
      }
      break;
    }

    default:
      md.push(`# ${dim.label}`, '', `*该维度暂无自动提取规则，请手动补充分析。*`);
  }

  // 生成摘要
  const summary = _buildDimensionSummary(dim, allFiles, targetFileMap, context);

  return {
    code: md.join('\n'),
    sources: sources.length > 0 ? [...new Set(sources)] : ['bootstrap-scan'],
    language: 'markdown',
    summary,
  };
}

/**
 * 为每个维度生成简短的中文摘要
 */
function _buildDimensionSummary(dim, allFiles, targetFileMap, context) {
  const { depGraphData, guardAudit, langStats, primaryLang } = context;
  const targetCount = Object.keys(targetFileMap).length;

  switch (dim.id) {
    case 'code-standard': {
      const highCount = allFiles.filter(f => inferFilePriority(f.name) === 'high').length;
      return `${highCount} 个核心文件的命名约定与注释风格采样（${primaryLang || '多语言'}项目）`;
    }
    case 'code-pattern': {
      const patternCount = allFiles.filter(f => /\b(class|struct|protocol|enum|interface)\b/.test(f.content)).length;
      return `${patternCount} 个文件含类型定义（class/struct/protocol/enum），展示项目常用设计模式`;
    }
    case 'architecture':
      return `${targetCount} 个模块/Target 按职责分类，${depGraphData?.edges?.length || 0} 条模块依赖关系`;
    case 'best-practice': {
      const errFiles = allFiles.filter(f => /\b(guard .+ else|throw |catch)\b/.test(f.content)).length;
      const asyncFiles = allFiles.filter(f => /\b(async|await|DispatchQueue|Task\s*\{)\b/.test(f.content)).length;
      return `错误处理 ${errFiles} 个文件、并发模式 ${asyncFiles} 个文件的最佳实践采样`;
    }
    case 'call-chain': {
      const delegateCount = allFiles.filter(f => /\b(delegate|Delegate)\b/.test(f.content)).length;
      const notifCount = allFiles.filter(f => /NotificationCenter/.test(f.content)).length;
      return `调用链分析：Delegate ${delegateCount} 个文件、Notification ${notifCount} 个文件`;
    }
    case 'data-flow': {
      const reactiveCount = allFiles.filter(f => /\b(@Published|@State|@Observable|Subject)\b/.test(f.content)).length;
      return `数据流/状态管理分析：${reactiveCount} 个文件涉及响应式/状态绑定模式`;
    }
    case 'bug-fix': {
      const total = guardAudit?.summary?.totalViolations || 0;
      return total > 0
        ? `Guard 审计发现 ${total} 项违规，提取为反模式候选供审查`
        : '未发现 Guard 违规，无反模式候选';
    }
    case 'project-profile': {
      const topLang = Object.entries(langStats).sort((a, b) => b[1] - a[1])[0];
      return `${primaryLang || '未知'}项目，${allFiles.length} 个文件，${targetCount} 个模块，主要语言 ${topLang ? `.${topLang[0]}(${topLang[1]})` : '未知'}`;
    }
    case 'agent-guidelines': {
      let markCount = 0;
      for (const f of allFiles.slice(0, 30)) {
        markCount += f.content.split('\n').filter(l => /\/\/\s*(MARK|TODO|FIXME|WARNING|IMPORTANT|NOTE):/.test(l)).length;
      }
      return `从 ${Math.min(30, allFiles.length)} 个文件中提取 ${markCount} 条注释标注（MARK/TODO/FIXME 等）`;
    }
    default:
      return `${dim.label} — 自动扫描概要`;
  }
}
