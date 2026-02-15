/**
 * pipeline/orchestrator.js — Bootstrap 异步维度填充管线 (v6)
 *
 * v6 架构: Signal → ChatAgent Production
 *   Phase 5:   启发式扫描 → 轻量信号 (不含 Markdown 文档)
 *   Phase 5.1: AI 可用性检查 + 用户决策
 *   Phase 5.2: 按维度分批 ChatAgent 生产 (AI 路径)
 *           或 v5 启发式直接入库 (降级路径)
 *   Phase 5.5: 全部维度完成后统一生成 Project Skill
 *
 * 核心变化:
 *   - 不再有 3 轮 AI 后置审查 (reviewRound1/2/3)
 *   - ChatAgent 一步到位产出最终质量候选
 *   - 跨维度 DimensionContext 提供全局视野
 *   - 支持维度重算 (self-optimization)
 */

import fs from 'node:fs';
import path from 'node:path';
import { extractDimensionCandidates } from '../dimensions.js';
import { extractDimensionSignals } from './signal-extractor.js';
import { DimensionContext, parseDimensionDigest } from './dimension-context.js';
import { buildDimensionProductionPrompt, buildMinimalPrompt } from './production-prompts.js';
import { buildProjectSkillContent } from '../projectSkills.js';
import { PipelineContext } from './context.js';

/**
 * 维度执行顺序 — 信息依赖排序
 *
 * ⑧⑨ 基础数据层 → ⑥ 项目概貌(依赖⑧⑨缓存) → ① 规范
 * → ③ 架构 → ② 模式(参考规范+架构) → ⑤ 事件流(参考模式)
 * → ④ 最佳实践(参考所有前序) → ⑦ Agent 指南(总结层,最后)
 */
const DIMENSION_EXECUTION_ORDER = [
  'objc-deep-scan', 'category-scan',      // 基础数据层
  'project-profile',                       // 项目概貌 (依赖 ⑧⑨)
  'code-standard',                         // 规范层 (参考概貌)
  'architecture',                          // 架构层
  'code-pattern',                          // 模式层 (参考规范+架构)
  'event-and-data-flow',                   // 流转层 (参考模式)
  'best-practice',                         // 实践层 (参考所有前序)
  'agent-guidelines',                      // 总结层 (最后,看到全貌)
];

/**
 * fillDimensionsAsync — 异步维度填充 (v6 Signal→ChatAgent Production)
 *
 * @param {object} fillContext 由 bootstrapKnowledge 构建的上下文对象
 */
export async function fillDimensionsAsync(fillContext) {
  const {
    ctx, dimensions, targetFileMap,
    depGraphData, guardAudit, langStats, primaryLang, astProjectSummary,
    skillContext, skillsEnhanced, taskManager, sessionId, projectRoot,
  } = fillContext;

  ctx.logger.info('[Bootstrap] fillDimensionsAsync entered — starting pipeline');

  // ── 将 allFiles 从闭包中提取为局部变量 ──
  // v7: 保留 allFiles 引用到 Step 3 完成，供 search_project_code 使用内存缓存
  let allFiles = fillContext.allFiles;
  fillContext.allFiles = null; // 释放 fillContext 上的引用，但 allFiles 变量仍持有

  const candidateResults = { created: 0, failed: 0, errors: [] };
  const dimensionCandidates = {}; // dimId → extracted candidates (Skill 生成用)

  // ── PipelineContext: 维度间共享缓存 (⑧⑨ → ⑥ 复用) ──
  const pipelineCtx = new PipelineContext({
    lang: primaryLang || 'swift',
    ast: astProjectSummary || null,
  });

  // ═══════════════════════════════════════════════════════════
  // Step 0: AI 可用性检查
  // ═══════════════════════════════════════════════════════════
  let chatAgent = null;
  try {
    chatAgent = ctx.container.get('chatAgent');
    // hasRealAI 排除 MockProvider — Mock 无法产出有意义的 tool calls
    if (chatAgent && !chatAgent.hasRealAI) chatAgent = null;
    // 重置跨维度全局提交标题 — 新 session 从零开始
    if (chatAgent) chatAgent.resetGlobalSubmittedTitles();
  } catch { /* ChatAgent not available */ }

  if (!chatAgent) {
    ctx.logger.info('[Bootstrap] ChatAgent/AI not available — notifying user');

    // 推送前端通知 → 用户选择降级或取消
    taskManager?.emitProgress('bootstrap:ai-unavailable', {
      message: '当前未配置 AI Provider，无法执行高质量冷启动分析',
      suggestion: '建议通过 Cursor/Claude 等外部 Agent 调用 autosnippet_bootstrap_knowledge 工具完成分析',
      fallbackAvailable: true,
    });

    // 等待用户决策 (通过 Socket.io 回传)
    const userChoice = await waitForUserDecision(taskManager, sessionId, {
      timeout: 30_000,
      defaultChoice: 'degrade',
    });

    if (userChoice === 'abort') {
      ctx.logger.info('[Bootstrap] User chose to abort — stopping async fill');
      // 标记所有任务为跳过
      for (const dim of dimensions) {
        taskManager?.markTaskCompleted(dim.id, { type: 'skipped', reason: 'user-abort' });
      }
      return;
    }

    // userChoice === 'degrade' → 走 v5 启发式降级路径
    ctx.logger.info('[Bootstrap] User chose degraded mode — falling back to heuristic-only');
    await fallbackHeuristicOnly(fillContext, { ctx, dimensions, allFiles, targetFileMap,
      depGraphData, guardAudit, langStats, primaryLang, astProjectSummary,
      taskManager, sessionId, projectRoot, pipelineCtx, dimensionCandidates, candidateResults });
    return;
  }

  // ═══════════════════════════════════════════════════════════
  // Step 1: 启发式扫描 → 信号提取 (所有维度)
  // ═══════════════════════════════════════════════════════════
  ctx.logger.info('[Bootstrap] Phase 5: Starting signal extraction for all dimensions');

  const allSignals = {}; // dimId → Signal[]

  // 按执行顺序提取信号 (确保 ⑧⑨ 的 PipelineContext 缓存先填充)
  for (const dimId of DIMENSION_EXECUTION_ORDER) {
    const dim = dimensions.find(d => d.id === dimId);
    if (!dim) continue;

    if (taskManager && !taskManager.isSessionValid(sessionId)) {
      ctx.logger.warn(`[Bootstrap] Session ${sessionId} superseded — aborting signal extraction`);
      break;
    }
    try {
      // extractDimensionSignals 同时返回 signals 和原始 candidates (避免重复提取)
      // 注意: 不在此处 markTaskFilling — Step 1 是快速同步扫描,
      //        真正的 loading 状态在 Step 3 (ChatAgent production) 或 Phase 5.5 (Skill gen) 时触发
      const { signals, candidates: rawCandidates } = extractDimensionSignals(dim, allFiles, targetFileMap, {
        depGraphData, guardAudit, langStats, primaryLang, astProjectSummary, pipelineCtx,
      });
      allSignals[dimId] = signals;

      // 保存完整候选供 Skill 生成 + ChatAgent 回退 (AI 产出 0 结果时用启发式候选入库)
      if (rawCandidates.length > 0) {
        dimensionCandidates[dimId] = rawCandidates;
      }

      ctx.logger.info(`[Bootstrap] Signal extraction: ${dimId} → ${signals.length} signals, ${rawCandidates.length} candidates`);
    } catch (err) {
      ctx.logger.warn(`[Bootstrap] Signal extraction failed for ${dimId}: ${err.message}`);
      allSignals[dimId] = [];

      // 错误恢复: candidateToSignal 转换失败时，直接提取启发式候选保留数据
      try {
        const fallbackCandidates = extractDimensionCandidates(dim, allFiles, targetFileMap, {
          depGraphData, guardAudit, langStats, primaryLang, astProjectSummary, pipelineCtx,
        });
        if (fallbackCandidates.length > 0) {
          dimensionCandidates[dimId] = fallbackCandidates;
          ctx.logger.info(`[Bootstrap] Signal recovery for ${dimId}: ${fallbackCandidates.length} heuristic candidates preserved`);
        }
      } catch { /* double failure, truly empty */ }
    }
  }

  ctx.logger.info(`[Bootstrap] Phase 5 完成: ${Object.values(allSignals).reduce((s, a) => s + a.length, 0)} signals extracted from ${Object.keys(allSignals).length} dimensions`);

  // ═══════════════════════════════════════════════════════════
  // Step 2: 构建跨维度上下文 (一次性)
  // ═══════════════════════════════════════════════════════════
  const dimContext = new DimensionContext({
    projectName: path.basename(projectRoot || process.env.ASD_PROJECT_DIR || process.cwd()),
    primaryLang: primaryLang || 'swift',
    fileCount: allFiles?.length || 0,
    targetCount: Object.keys(targetFileMap || {}).length,
    modules: Object.keys(targetFileMap || {}),
    depGraph: depGraphData || null,
    astMetrics: astProjectSummary?.projectMetrics || null,
    guardSummary: guardAudit?.summary || null,
  });

  // ═══════════════════════════════════════════════════════════
  // Step 3: 按维度分批 ChatAgent 生产
  // ═══════════════════════════════════════════════════════════
  ctx.logger.info('[Bootstrap] Phase 5.2: Starting ChatAgent per-dimension production');

  // 统一预算配置 — 在链路上同步给 ChatAgent 和 production-prompt
  const baseBudget = {
    maxIterations: 30,
    searchBudget: 8,
    searchBudgetGrace: 4,
    maxSubmits: 6,
    softSubmitLimit: 4,
    idleRoundsToExit: 2,
  };

  /**
   * 按维度信号量动态调整预算
   * - 信号 ≤ 5:  默认值 (maxSubmits=6, searchBudget=8)
   * - 信号 6~15: 中等 (maxSubmits=10, softSubmitLimit=6, searchBudget=6)
   * - 信号 > 15: 大维度 (maxSubmits=15, softSubmitLimit=8, searchBudget=5)
   * - skillWorthy && !dualOutput: 不产出候选，maxSubmits=0
   */
  function computeDimensionBudget(dim, signalCount) {
    if (dim.skillWorthy && !dim.dualOutput) {
      // skill-only 维度不提交候选，减少迭代
      return { ...baseBudget, maxSubmits: 0, softSubmitLimit: 0, maxIterations: 15, searchBudget: 5 };
    }

    if (signalCount > 15) {
      // 大维度: 更多提交配额，搜索预算下调以留出提交空间
      return { ...baseBudget, maxSubmits: 15, softSubmitLimit: 8, searchBudget: 5, idleRoundsToExit: 3 };
    }

    if (signalCount > 5) {
      // 中等维度
      return { ...baseBudget, maxSubmits: 10, softSubmitLimit: 6, searchBudget: 6 };
    }

    // 小维度: 默认值
    return { ...baseBudget };
  }

  for (const dimId of DIMENSION_EXECUTION_ORDER) {
    const dim = dimensions.find(d => d.id === dimId);
    if (!dim) continue;

    // ── 并发安全检查 ──
    if (taskManager && !taskManager.isSessionValid(sessionId)) {
      ctx.logger.warn(`[Bootstrap] Session ${sessionId} superseded — aborting ChatAgent production`);
      break;
    }

    const signals = allSignals[dimId] || [];
    if (signals.length === 0) {
      // 候选维度（非 skill-only）信号为空时，尝试直接回退到启发式候选入库
      const hasFallback = dimensionCandidates[dimId]?.length > 0;
      if (hasFallback && (!dim.skillWorthy || dim.dualOutput)) {
        ctx.logger.info(`[Bootstrap] Dimension "${dimId}" → 0 signals but ${dimensionCandidates[dimId].length} heuristic candidates, falling back`);
        const candidateService = (() => {
          try { return ctx.container.get('candidateService'); } catch { return null; }
        })();
        if (candidateService) {
          let created = 0;
          for (const c of dimensionCandidates[dimId]) {
            try {
              await candidateService.createFromToolParams({
                code: c.code, language: c.language, category: dimId,
                title: c.title, summary: c.summary,
                knowledgeType: c.knowledgeType || dim.knowledgeTypes?.[0] || 'code-pattern',
                tags: ['bootstrap', dimId, ...(c.tags || [])],
                source: 'bootstrap',
                reasoning: { whyStandard: c.summary, sources: (c.sources || []).slice(0, 5), confidence: 0.5 },
              });
              created++;
            } catch { /* skip single candidate failure */ }
          }
          candidateResults.created += created;
          taskManager?.markTaskCompleted(dimId, { type: 'candidate', extracted: created, created, status: 'heuristic-fallback' });
          ctx.logger.info(`[Bootstrap] Heuristic fallback for "${dimId}": ${created} candidates persisted`);
        } else {
          taskManager?.markTaskCompleted(dimId, { type: 'empty', reason: 'no signals, no candidateService' });
        }
      } else {
        taskManager?.markTaskCompleted(dimId, { type: 'empty', reason: 'no signals' });
        ctx.logger.info(`[Bootstrap] Dimension "${dimId}" → 0 signals, skipping`);
      }
      continue;
    }

    taskManager?.markTaskFilling(dimId);

    try {
      // 构建跨维度上下文快照
      const contextSnapshot = dimContext.buildContextForDimension(dimId);

      // 按维度信号量动态计算预算
      const dimBudget = computeDimensionBudget(dim, signals.length);

      // 构建维度元数据 — 类型标注系统，传递给 ChatAgent 和 submit_candidate 做精确校验
      const dimOutputType = (dim.skillWorthy && !dim.dualOutput) ? 'skill'
        : (dim.skillWorthy && dim.dualOutput) ? 'dual'
        : 'candidate';
      const dimensionMeta = {
        id: dimId,
        outputType: dimOutputType,
        allowedKnowledgeTypes: dim.knowledgeTypes || [],
      };
      ctx.logger.info(`[Bootstrap] Dimension "${dimId}" — outputType=${dimOutputType}, allowedTypes=[${dimensionMeta.allowedKnowledgeTypes}], budget: maxSubmits=${dimBudget.maxSubmits}, searchBudget=${dimBudget.searchBudget}, signals=${signals.length}`);

      // v10: 默认使用 minimal-prompt (领域大脑模式)
      // 可通过环境变量 ASD_PROMPT_MODE='full-signal' 回退 v9
      const promptMode = process.env.ASD_PROMPT_MODE || 'minimal-prompt';
      let prompt;
      if (promptMode === 'full-signal') {
        prompt = buildDimensionProductionPrompt(dim, signals, contextSnapshot, { budget: dimBudget });
        ctx.logger.info(`[Bootstrap] Using v9 full-signal for "${dimId}"`);
      } else {
        prompt = buildMinimalPrompt(dim, contextSnapshot, { budget: dimBudget, signalCount: signals.length });
      }

      // ChatAgent ReAct: LLM 分析信号 → submit_candidate 工具调用 → digest
      // v7: 注入 fileCache 供 search_project_code / read_project_file 使用内存缓存
      chatAgent.setFileCache(allFiles);
      ctx.logger.info(`[Bootstrap] ChatAgent producing dimension "${dimId}" (${signals.length} signals)`);

      // 单维度超时保护 — 避免一个维度阻塞整个管线
      const PER_DIMENSION_TIMEOUT = 180_000; // 3 分钟
      const dimExecPromise = chatAgent.execute(prompt, {
        source: 'system',
        conversationId: `bootstrap-${sessionId}-${dimId}`,
        budget: dimBudget,
        dimensionMeta,
        promptMode,
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Dimension "${dimId}" timed out after ${PER_DIMENSION_TIMEOUT / 1000}s`)), PER_DIMENSION_TIMEOUT),
      );
      const result = await Promise.race([dimExecPromise, timeoutPromise]);

      // 解析 DimensionDigest
      const digest = parseDimensionDigest(result.reply);
      if (digest) {
        dimContext.addDimensionDigest(dimId, digest);
      } else {
        // ChatAgent 没有产出 digest → 构建一个最小的
        dimContext.addDimensionDigest(dimId, {
          summary: `维度 ${dim.label} 已分析,ChatAgent 未返回结构化摘要`,
          candidateCount: result.toolCalls.filter(tc => tc.tool === 'submit_candidate' || tc.tool === 'submit_with_check').length,
          keyFindings: [],
          crossRefs: {},
          gaps: [],
        });
      }

      // 记录已提交的候选 (从 toolCalls 中提取)
      let dimCandidateCount = 0;
      for (const tc of result.toolCalls) {
        if (tc.tool === 'submit_candidate' || tc.tool === 'submit_with_check') {
          dimCandidateCount++;
          candidateResults.created++;
          dimContext.addSubmittedCandidate(dimId, {
            title: tc.params?.title || '',
            subTopic: tc.params?.category || '',
            summary: tc.params?.summary || '',
          });
        }
      }

      // ── 回退: ChatAgent 产出 0 候选时，自动持久化启发式候选 ──
      // 注意: dualOutput 维度也需要产出 Candidate（同时生成 Skill + Candidate）
      if (dimCandidateCount === 0 && (!dim.skillWorthy || dim.dualOutput)) {
        const fallbackCandidates = dimensionCandidates[dimId] || [];
        if (fallbackCandidates.length > 0) {
          ctx.logger.info(`[Bootstrap] ChatAgent produced 0 candidates for "${dimId}" — falling back to ${fallbackCandidates.length} heuristic candidates`);
          const candidateService = (() => {
            try { return ctx.container.get('candidateService'); } catch { return null; }
          })();
          if (candidateService) {
            for (const c of fallbackCandidates) {
              try {
                await candidateService.createFromToolParams({
                  code: c.code,
                  language: c.language,
                  category: dimId,
                  title: c.title,
                  knowledgeType: c.knowledgeType || (dim.knowledgeTypes || [])[0] || 'code-pattern',
                  tags: ['bootstrap', 'heuristic-fallback', dimId, ...(c.tags || [])].filter(Boolean),
                  scope: 'project',
                  summary: c.summary,
                  trigger: c._trigger || undefined,
                  relations: c.relations || undefined,
                  reasoning: {
                    whyStandard: c._skillReference || c.summary || 'Heuristic extraction (AI fallback)',
                    sources: c.sources || [],
                    confidence: c._skillEnhanced ? 0.7 : 0.6,
                    qualitySignals: { completeness: 'heuristic-fallback', origin: 'bootstrap-scan' },
                  },
                }, 'bootstrap', {}, { userId: 'bootstrap_agent' });
                dimCandidateCount++;
                candidateResults.created++;
              } catch (itemErr) {
                candidateResults.failed++;
                candidateResults.errors.push({ dimension: dimId, subTopic: c.subTopic, error: itemErr.message });
              }
            }
            ctx.logger.info(`[Bootstrap] Fallback: ${dimCandidateCount} heuristic candidates persisted for "${dimId}"`);
          }
        }
      }

      taskManager?.markTaskCompleted(dimId, {
        type: dim.skillWorthy ? 'skill' : 'candidate',
        // 前端 skill 类型读 sourceCount, candidate 类型读 extracted
        // dualOutput 维度同时提供两个字段
        sourceCount: signals.length,
        extracted: dimCandidateCount,
        count: dimCandidateCount,
        digest: digest?.summary || '',
        // 标记是否回退到启发式候选
        ...(dimCandidateCount > 0 && result.toolCalls.filter(tc => tc.tool === 'submit_candidate' || tc.tool === 'submit_with_check').length === 0
          ? { fallback: true } : {}),
      });

      ctx.logger.info(`[Bootstrap] Dimension "${dimId}" completed: ${dimCandidateCount} candidates submitted, digest=${!!digest}`);
    } catch (dimErr) {
      candidateResults.failed++;
      candidateResults.errors.push({ dimension: dimId, error: dimErr.message });
      ctx.logger.warn(`[Bootstrap] ChatAgent production failed for ${dimId}: ${dimErr.message}`);

      // ── 异常回退: 持久化启发式候选 ──
      let fallbackCount = 0;
      if (!dim.skillWorthy || dim.dualOutput) {
        const fallbackCandidates = dimensionCandidates[dimId] || [];
        if (fallbackCandidates.length > 0) {
          ctx.logger.info(`[Bootstrap] ChatAgent failed for "${dimId}" — falling back to ${fallbackCandidates.length} heuristic candidates`);
          const candidateService = (() => {
            try { return ctx.container.get('candidateService'); } catch { return null; }
          })();
          if (candidateService) {
            for (const c of fallbackCandidates) {
              try {
                await candidateService.createFromToolParams({
                  code: c.code, language: c.language, category: dimId,
                  title: c.title, summary: c.summary,
                  knowledgeType: c.knowledgeType || (dim.knowledgeTypes || [])[0] || 'code-pattern',
                  tags: ['bootstrap', 'heuristic-fallback', dimId, ...(c.tags || [])].filter(Boolean),
                  scope: 'project',
                  reasoning: {
                    whyStandard: c.summary || 'Heuristic extraction (AI error fallback)',
                    sources: c.sources || [], confidence: 0.5,
                    qualitySignals: { completeness: 'heuristic-fallback', origin: 'bootstrap-error' },
                  },
                }, 'bootstrap', {}, { userId: 'bootstrap_agent' });
                fallbackCount++;
                candidateResults.created++;
              } catch { candidateResults.failed++; }
            }
            ctx.logger.info(`[Bootstrap] Error fallback: ${fallbackCount}/${fallbackCandidates.length} heuristic candidates persisted for "${dimId}"`);
          }
        }
      }
      taskManager?.markTaskFailed(dimId, dimErr);

      // 产出一个失败 digest 以便后续维度知道这个维度出了问题
      dimContext.addDimensionDigest(dimId, {
        summary: `维度 ${dim.label} 分析失败: ${dimErr.message}`,
        candidateCount: 0,
        keyFindings: [],
        crossRefs: {},
        gaps: [`分析失败: ${dimErr.message}`],
      });
    }
  }

  // v7: Step 3 结束 — 释放 allFiles 内存 + 清除 ChatAgent fileCache
  chatAgent.setFileCache(null);
  allFiles = null;

  // ═══════════════════════════════════════════════════════════
  // Phase 5.5: 统一生成 Project Skill (全部维度完成后)
  //
  // v6: Skill 在所有维度完成后统一生成,利用全局 digest 视野
  // ═══════════════════════════════════════════════════════════
  await generateProjectSkills({
    ctx, dimensions, dimensionCandidates, dimContext,
    primaryLang, langStats, targetFileMap, depGraphData, guardAudit, astProjectSummary,
    taskManager, sessionId,
  });

  // 汇总日志
  ctx.logger.info(`[Bootstrap] Async fill completed: ${candidateResults.created} candidates created`);

  // ── 释放大型引用 ──
  allFiles = null;
  fillContext.targetFileMap = null;
  fillContext.depGraphData = null;
  fillContext.astProjectSummary = null;
  fillContext.ctx = null;
}

// ═══════════════════════════════════════════════════════════
// 降级路径: v5 启发式直接入库 (AI 不可用时)
// ═══════════════════════════════════════════════════════════

async function fallbackHeuristicOnly(fillContext, params) {
  const { ctx, dimensions, allFiles, targetFileMap,
    depGraphData, guardAudit, langStats, primaryLang, astProjectSummary,
    taskManager, sessionId, projectRoot, pipelineCtx, dimensionCandidates, candidateResults } = params;

  ctx.logger.info('[Bootstrap] Degraded mode: extracting candidates with heuristic-only (v5 path)');

  const candidatePool = [];

  for (const dim of dimensions) {
    if (taskManager && !taskManager.isSessionValid(sessionId)) break;

    const taskId = dim.id;
    if (!dim.skillWorthy || dim.dualOutput) {
      taskManager?.markTaskFilling(taskId);
    }

    try {
      const candidates = extractDimensionCandidates(dim, allFiles, targetFileMap, {
        depGraphData, guardAudit, langStats, primaryLang, astProjectSummary, pipelineCtx,
      });

      if (dim.skillWorthy && candidates.length > 0) {
        dimensionCandidates[dim.id] = candidates;
      }

      if (dim.skillWorthy && !dim.dualOutput) {
        ctx.logger.info(`[Bootstrap] [Degraded] Dimension "${dim.id}" skill-worthy → reserved for Skill (${candidates.length} items)`);
        continue;
      }

      if (candidates.length > 0) {
        for (const c of candidates) {
          c._dimId = dim.id;
          c._dimKnowledgeTypes = dim.knowledgeTypes;
          candidatePool.push(c);
        }
      }

      taskManager?.markTaskCompleted(taskId, {
        type: 'candidate',
        extracted: candidates.length,
        created: 0,
        status: 'heuristic-only',
      });
    } catch (dimErr) {
      candidateResults.failed++;
      candidateResults.errors.push({ dimension: dim.id, error: dimErr.message });
      ctx.logger.warn(`[Bootstrap] [Degraded] Extraction failed for ${dim.id}: ${dimErr.message}`);
      taskManager?.markTaskFailed(taskId, dimErr);
    }
  }

  // 直接入库 (无 AI 审查)
  const candidateService = (() => {
    try { return ctx.container.get('candidateService'); } catch { return null; }
  })();

  if (candidateService && candidatePool.length > 0) {
    for (const c of candidatePool) {
      try {
        const confidence = c._skillEnhanced ? 0.7 : 0.6;
        await candidateService.createFromToolParams({
          code: c.code,
          language: c.language,
          category: c._dimId || 'bootstrap',
          title: c.title,
          knowledgeType: c.knowledgeType || (c._dimKnowledgeTypes || [])[0] || 'code-pattern',
          tags: ['bootstrap', 'heuristic-only', c._dimId || '', ...(c.tags || [])].filter(Boolean),
          scope: 'project',
          summary: c.summary,
          trigger: c._trigger || undefined,
          relations: c.relations || undefined,
          reasoning: {
            whyStandard: c._skillReference || c.summary,
            sources: c.sources,
            confidence,
            qualitySignals: { completeness: 'heuristic-only', origin: 'bootstrap-scan' },
          },
        }, 'bootstrap', {}, { userId: 'bootstrap_agent' });
        candidateResults.created++;
      } catch (itemErr) {
        candidateResults.failed++;
        candidateResults.errors.push({ dimension: c._dimId || 'unknown', subTopic: c.subTopic, error: itemErr.message });
      }
    }
    ctx.logger.info(`[Bootstrap] [Degraded] ${candidateResults.created} candidates persisted (heuristic-only)`);
  } else if (!candidateService && candidatePool.length > 0) {
    ctx.logger.warn(`[Bootstrap] [Degraded] candidateService unavailable — ${candidatePool.length} candidates extracted but cannot be persisted (database not initialized?)`);
  }

  // Skill 生成 (降级路径依然生成)
  await generateProjectSkills({
    ctx, dimensions, dimensionCandidates, dimContext: null,
    primaryLang, langStats, targetFileMap, depGraphData, guardAudit, astProjectSummary,
    taskManager, sessionId,
  });
}

// ═══════════════════════════════════════════════════════════
// Skill 生成 (统一入口)
// ═══════════════════════════════════════════════════════════

async function generateProjectSkills(params) {
  const { ctx, dimensions, dimensionCandidates, dimContext,
    primaryLang, langStats, targetFileMap, depGraphData, guardAudit, astProjectSummary,
    taskManager, sessionId } = params;

  const autoSkillResults = { created: 0, failed: 0, skills: [], errors: [] };

  try {
    const { createSkill } = await import('../../skill.js');
    const skillWorthyDims = dimensions.filter(d => d.skillWorthy && dimensionCandidates[d.id]?.length > 0);

    for (const dim of skillWorthyDims) {
      if (taskManager && !taskManager.isSessionValid(sessionId)) {
        ctx.logger.warn(`[Bootstrap] Session ${sessionId} superseded — aborting Skill generation`);
        break;
      }

      const taskId = dim.id;
      taskManager?.markTaskFilling(taskId);

      try {
        const candidates = dimensionCandidates[dim.id];
        const skillContent = buildProjectSkillContent(dim, candidates, {
          primaryLang, langStats, targetFileMap, depGraphData, guardAudit, astProjectSummary,
        });

        // buildProjectSkillContent 可能返回 string | string[]
        // 多 part 时拆分为 name-1, name-2, ... 多个独立 Skill 文件
        const parts = Array.isArray(skillContent) ? skillContent : [skillContent];

        for (let pi = 0; pi < parts.length; pi++) {
          const partContent = parts[pi];
          const partSuffix = parts.length > 1 ? `-${pi + 1}` : '';
          const partName = `${dim.skillMeta.name}${partSuffix}`;
          const partDesc = parts.length > 1
            ? `${dim.skillMeta.description} (part ${pi + 1}/${parts.length})`
            : dim.skillMeta.description;

          const result = createSkill(ctx, {
            name: partName,
            description: partDesc,
            content: partContent,
            overwrite: true,
            createdBy: 'bootstrap',
          });

          const parsed = JSON.parse(result);
          if (parsed.success) {
            autoSkillResults.created++;
            autoSkillResults.skills.push(partName);
          } else {
            throw new Error(parsed.error?.message || 'createSkill returned failure');
          }
        }

        ctx.logger.info(`[Bootstrap] Phase 5.5: Auto-generated Project Skill "${dim.skillMeta.name}" (${candidates.length} sources, ${parts.length} part${parts.length > 1 ? 's' : ''})`);
        taskManager?.markTaskCompleted(taskId, {
          type: 'skill',
          skillName: dim.skillMeta.name,
          sourceCount: candidates.length,
          parts: parts.length,
        });
      } catch (skillErr) {
        autoSkillResults.failed++;
        autoSkillResults.errors.push({ dimension: dim.id, skillName: dim.skillMeta.name, error: skillErr.message });
        ctx.logger.warn(`[Bootstrap] Phase 5.5: Failed to generate Skill "${dim.skillMeta.name}": ${skillErr.message}`);
        taskManager?.markTaskFailed(taskId, skillErr);
      }
    }

    // 没有候选内容的 skillWorthy 维度也需要标记完成
    const emptySkillDims = dimensions.filter(d => d.skillWorthy && !dimensionCandidates[d.id]?.length);
    for (const dim of emptySkillDims) {
      taskManager?.markTaskCompleted(dim.id, { type: 'skill', skillName: dim.skillMeta?.name || dim.id, sourceCount: 0, empty: true });
    }
  } catch (e) {
    ctx.logger.warn(`[Bootstrap] Phase 5.5 Skill generation failed: ${e.message}`);
  }

  ctx.logger.info(`[Bootstrap] Phase 5.5: ${autoSkillResults.created} skills generated, ${autoSkillResults.failed} failed`);
  return autoSkillResults;
}

// ═══════════════════════════════════════════════════════════
// 用户决策等待
// ═══════════════════════════════════════════════════════════

/**
 * 等待用户通过 Socket.io 回传的决策
 *
 * @param {object|null} taskManager
 * @param {string} sessionId
 * @param {object} opts — { timeout, defaultChoice }
 * @returns {Promise<'degrade'|'abort'>}
 */
function waitForUserDecision(taskManager, sessionId, { timeout = 30_000, defaultChoice = 'degrade' } = {}) {
  if (!taskManager || !taskManager.waitForUserDecision) {
    // taskManager 不支持等待 → 默认降级
    return Promise.resolve(defaultChoice);
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(defaultChoice), timeout);

    taskManager.waitForUserDecision(sessionId, (choice) => {
      clearTimeout(timer);
      resolve(choice || defaultChoice);
    });
  });
}
