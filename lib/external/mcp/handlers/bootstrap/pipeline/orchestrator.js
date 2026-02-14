/**
 * pipeline/orchestrator.js — Bootstrap 异步维度填充管线
 *
 * 从 bootstrap.js 提取的核心异步填充函数。
 * 负责 Phase 5 → Phase 5.5 全流程：
 *   Phase 5:   逐维度提取候选（纯启发式，不入库）
 *   Phase 5.1: AI 多轮审查管线（资格审查 → 内容精炼 → 去重关系）
 *   Phase 5.2: 审查通过的候选持久化入库
 *   Phase 5.5: skillWorthy 维度 → Project Skill 生成
 *
 * 逐个串行执行，通过 BootstrapTaskManager 发射进度事件
 */

import fs from 'node:fs';
import path from 'node:path';
import { extractDimensionCandidates } from '../dimensions.js';
import { buildProjectSkillContent } from '../projectSkills.js';
import { PipelineContext } from './context.js';
import {
  reviewRound1_EligibilityGate,
  reviewRound2_ContentRefine,
  reviewRound3_DedupAndRelations,
  mergeCandidateGroups,
  guardRound1Drift,
  guardRound2Drift,
} from '../ai-review.js';

/**
 * fillDimensionsAsync — 异步维度填充（v6 三阶段管线）
 *
 * @param {object} fillContext 由 bootstrapKnowledge 构建的上下文对象
 */
export async function fillDimensionsAsync(fillContext) {
  const {
    ctx, dimensions, targetFileMap,
    depGraphData, guardAudit, langStats, primaryLang, astProjectSummary,
    skillContext, skillsEnhanced, taskManager, sessionId, projectRoot,
  } = fillContext;

  // ── Fix 2: 将 allFiles 从闭包中提取为局部变量，用完即释放 ──
  let allFiles = fillContext.allFiles;
  fillContext.allFiles = null; // 断开闭包中的引用

  const candidateResults = { created: 0, failed: 0, errors: [] };
  const dimensionCandidates = {}; // dimId → extracted candidates（Skill 生成用）

  // ── PipelineContext: 维度间共享缓存 ──
  // ⑧ objc-deep-scan / ⑨ category-scan 的中间扫描结果缓存到 pipelineCtx，
  // 后续 ⑥ project-profile 的交叉子主题直接读取，避免重复全量扫描。
  const pipelineCtx = new PipelineContext({
    lang: primaryLang || 'swift',
    ast: astProjectSummary || null,
  });

  // ── Phase 5: 逐维度提取候选（纯启发式，不写 DB）──
  // 将所有 candidateOnly 维度候选池化，供 Phase 5.1 统一审查
  const allExtractedCandidates = []; // { dimId, candidates[] }
  const candidatePool = [];          // 打平的全部候选

  for (const dim of dimensions) {
    // ── Fix 1: 并发安全 — 检测 session 是否被新请求覆盖 ──
    if (taskManager && !taskManager.isSessionValid(sessionId)) {
      ctx.logger.warn(`[Bootstrap] Session ${sessionId} superseded — aborting async fill`);
      break;
    }

    const taskId = dim.id;

    // skillWorthy 维度在 Phase 5 不标记 filling，保持 skeleton（dualOutput 除外）
    if (!dim.skillWorthy || dim.dualOutput) {
      taskManager?.markTaskFilling(taskId);
    }

    try {
      const candidates = extractDimensionCandidates(dim, allFiles, targetFileMap, {
        depGraphData, guardAudit, langStats, primaryLang, astProjectSummary, pipelineCtx,
      });

      // 保存提取的候选（供 Skill 生成使用）
      if (dim.skillWorthy && candidates.length > 0) {
        dimensionCandidates[dim.id] = candidates;
      }

      // skillWorthy 维度只提取内容用于后续生成 Project Skill，不创建 Candidate
      // dualOutput 维度两者兼顾：既生成 Skill 又创建 Candidate → Recipe → Snippet
      if (dim.skillWorthy && !dim.dualOutput) {
        ctx.logger.info(`[Bootstrap] Dimension "${dim.id}" is skill-worthy → skip Candidate creation (${candidates.length} items reserved for Skill generation)`);
        continue;
      }

      // 非 skillWorthy：收集候选到池中（暂不写 DB）
      if (candidates.length > 0) {
        allExtractedCandidates.push({ dimId: dim.id, knowledgeTypes: dim.knowledgeTypes, candidates });
        for (const c of candidates) {
          c._dimId = dim.id;
          c._dimKnowledgeTypes = dim.knowledgeTypes;
          candidatePool.push(c);
        }
        ctx.logger.info(`[Bootstrap] Dimension "${dim.id}" extracted ${candidates.length} candidates (pending AI review)`);
      }

      // 标记维度提取完成（Phase 5 提取阶段）
      taskManager?.markTaskCompleted(taskId, {
        type: 'candidate',
        extracted: candidates.length,
        created: 0,       // Phase 5.2 入库后更新
        status: 'pending-review',
      });
    } catch (dimErr) {
      candidateResults.failed++;
      candidateResults.errors.push({ dimension: dim.id, error: dimErr.message });
      ctx.logger.warn(`[Bootstrap] Candidate extraction failed for ${dim.id}: ${dimErr.message}`);
      taskManager?.markTaskFailed(taskId, dimErr);
    }
  }

  ctx.logger.info(`[Bootstrap] Phase 5 完成: ${candidatePool.length} candidates extracted from ${allExtractedCandidates.length} dimensions`);

  // ═══════════════════════════════════════════════════════════
  // Phase 5.1: AI 多轮审查管线
  //
  // 在异步时间窗口中使用耗时但准确的 AI 审查，确保候选质量。
  // 三轮递进：资格审查 → 内容精炼 → 去重关系推断
  // 每轮有严格的 scope 限定，严禁任务漂移
  // ═══════════════════════════════════════════════════════════
  let reviewedCandidates = candidatePool;

  // 尝试获取 AI provider（可选 — 无 AI 时跳过审查，直接入库）
  let aiProvider = null;
  try {
    aiProvider = ctx.container.get('aiProvider');
    if (aiProvider && typeof aiProvider.chat !== 'function') aiProvider = null;
  } catch { /* aiProvider not available */ }

  if (aiProvider && candidatePool.length > 0) {
    const projectContext = {
      primaryLang,
      fileCount: allFiles?.length || 0,
      targetCount: Object.keys(targetFileMap || {}).length,
      projectName: path.basename(process.env.ASD_PROJECT_DIR || process.cwd()),
    };

    const progressCallback = (eventName, data) => {
      taskManager?.emitProgress(eventName, data);
    };

    // P2-8: 断点恢复 — 每轮结束后保存中间结果到 checkpoint 文件
    const checkpointDir = path.join(projectRoot, 'AutoSnippet', '.autosnippet');
    const checkpointPath = path.join(checkpointDir, `_review-checkpoint-${sessionId}.json`);
    const saveCheckpoint = (roundLabel, candidates) => {
      try {
        fs.mkdirSync(checkpointDir, { recursive: true });
        const snapshot = candidates.map(c => {
          // 只保存必要字段，避免循环引用导致 JSON 序列化失败
          const { code, ...rest } = c;
          return { ...rest, _codeLength: (code || '').length };
        });
        fs.writeFileSync(checkpointPath, JSON.stringify({ round: roundLabel, ts: Date.now(), count: candidates.length, candidates: snapshot }, null, 2));
        ctx.logger.info(`[Bootstrap] Checkpoint saved after ${roundLabel}: ${candidates.length} candidates`);
      } catch (cpErr) {
        ctx.logger.warn(`[Bootstrap] Checkpoint save failed: ${cpErr.message}`);
      }
    };
    const cleanupCheckpoint = () => {
      try { if (fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath); } catch { /* ignore */ }
    };

    // ── 并发安全检查 ──
    if (taskManager && !taskManager.isSessionValid(sessionId)) {
      ctx.logger.warn(`[Bootstrap] Session ${sessionId} superseded — skipping AI review`);
    } else {
      try {
        ctx.logger.info(`[Bootstrap] Phase 5.1: Starting AI review pipeline for ${candidatePool.length} candidates`);

        // ── Round 1: 资格审查 ──
        let round1 = await reviewRound1_EligibilityGate(
          aiProvider, candidatePool, projectContext, { onProgress: progressCallback },
        );

        // ── Round 1 反漂移护栏 ──
        round1 = guardRound1Drift(round1, candidatePool);
        if (round1._driftGuardTriggered) {
          ctx.logger.warn(`[Bootstrap] AI Round 1: drift guard triggered — conservative fallback`);
        }

        ctx.logger.info(`[Bootstrap] AI Round 1: ${round1.kept.length} kept, ${round1.merged.length} merge groups, ${round1.dropped.length} dropped`);

        // 合并 merge groups
        let afterMerge = [...round1.kept];
        if (round1.merged.length > 0) {
          const mergedItems = mergeCandidateGroups(round1.merged);
          afterMerge.push(...mergedItems);
        }

        // P2-8: 保存 Round 1 结果 checkpoint
        saveCheckpoint('round1', afterMerge);
        reviewedCandidates = afterMerge; // 兜底：如果后续轮次崩溃，至少用 Round 1 结果

        // ── 并发安全检查 ──
        if (taskManager && !taskManager.isSessionValid(sessionId)) {
          ctx.logger.warn(`[Bootstrap] Session ${sessionId} superseded — aborting AI review after Round 1`);
        } else {
          // ── Round 2: 内容精炼 ──
          const allTitles = afterMerge.map(c => c.title || '').filter(Boolean);
          afterMerge = await reviewRound2_ContentRefine(
            aiProvider, afterMerge, allTitles, projectContext, { onProgress: progressCallback },
          );

          // ── Round 2 反漂移护栏 ──
          afterMerge = guardRound2Drift(afterMerge);

          ctx.logger.info(`[Bootstrap] AI Round 2: ${afterMerge.filter(c => c._aiReviewed).length}/${afterMerge.length} refined`);

          // P2-8: 保存 Round 2 结果 checkpoint
          saveCheckpoint('round2', afterMerge);
          reviewedCandidates = afterMerge; // 兜底更新

          // ── 并发安全检查 ──
          if (taskManager && !taskManager.isSessionValid(sessionId)) {
            ctx.logger.warn(`[Bootstrap] Session ${sessionId} superseded — aborting AI review after Round 2`);
          } else {
            // ── Round 3: 去重 + 关系推断 ──
            const round3 = await reviewRound3_DedupAndRelations(
              aiProvider, afterMerge, { onProgress: progressCallback },
            );

            reviewedCandidates = round3.candidates;
            ctx.logger.info(`[Bootstrap] AI Round 3: ${reviewedCandidates.length} candidates after dedup, ${round3.relations.length} relations inferred`);
          }
        }

        // P2-8: 审查成功完成，清理 checkpoint 文件
        cleanupCheckpoint();
      } catch (reviewErr) {
        ctx.logger.warn(`[Bootstrap] AI review pipeline failed (graceful degradation): ${reviewErr.message}`);
        // reviewedCandidates 已在每轮结束后更新，此处不再回退到原始 candidatePool
        // 如果连 Round 1 都没跑完，reviewedCandidates 仍然是 candidatePool（初始赋值）
        ctx.logger.info(`[Bootstrap] Using ${reviewedCandidates.length} candidates from last successful round`);
      }
    }
  } else if (!aiProvider) {
    ctx.logger.info('[Bootstrap] AI provider not available — skipping Phase 5.1 review, using raw extracted candidates');
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 5.2: 审查通过的候选持久化入库
  // ═══════════════════════════════════════════════════════════
  const candidateService = (() => {
    try { return ctx.container.get('candidateService'); } catch { return null; }
  })();

  if (candidateService && reviewedCandidates.length > 0) {
    // ── 并发安全检查 ──
    if (taskManager && !taskManager.isSessionValid(sessionId)) {
      ctx.logger.warn(`[Bootstrap] Session ${sessionId} superseded — skipping candidate persistence`);
    } else {
      for (const c of reviewedCandidates) {
        try {
          // 计算 confidence：优先使用 AI 审查的动态评分
          const confidence = c._aiConfidence
            ?? (c._skillEnhanced ? 0.7 : 0.6);

          // 构建增强后的 reasoning
          const qualitySignals = {
            completeness: c._aiReviewed ? 'ai-reviewed' : (c._skillEnhanced ? 'skill-enhanced' : 'partial'),
            origin: 'bootstrap-scan',
            ...(c._skillEnhanced ? { skillSource: true } : {}),
            ...(c._aiReviewed ? { aiReviewRound: c._stableId ? 3 : 2 } : {}),
            ...(c._driftDetected ? { driftDetected: c._driftDetected } : {}),
            ...(c._confidenceFlat ? { confidenceFlat: true } : {}),
          };

          // 合并 AI 精炼的 agentNotes 到 code 文档
          let finalCode = c.code;
          if (c._refinedAgentNotes && Array.isArray(c._refinedAgentNotes) && c._refinedAgentNotes.length > 0) {
            // 替换 code 文档中的 Agent 注意事项
            const agentSection = '\n## Agent 注意事项\n';
            const agentIdx = finalCode.indexOf(agentSection);
            if (agentIdx >= 0) {
              const nextSection = finalCode.indexOf('\n## ', agentIdx + agentSection.length);
              const end = nextSection >= 0 ? nextSection : finalCode.length;
              const newAgentContent = c._refinedAgentNotes.map(n => `- ${n}`).join('\n');
              finalCode = finalCode.slice(0, agentIdx) + agentSection + '\n' + newAgentContent + '\n' + finalCode.slice(end);
            }
          }

          // 合并 AI insight 到 code 文档
          if (c._aiInsight) {
            const agentIdx = finalCode.indexOf('\n## Agent 注意事项\n');
            const insertIdx = agentIdx >= 0 ? agentIdx : finalCode.length;
            finalCode = finalCode.slice(0, insertIdx) +
              '\n## 架构洞察\n\n' + c._aiInsight + '\n' +
              finalCode.slice(insertIdx);
          }

          await candidateService.createFromToolParams({
            code: finalCode,
            language: c.language,
            category: c._dimId || 'bootstrap',
            title: c.title,
            knowledgeType: c.knowledgeType || (c._dimKnowledgeTypes || [])[0] || 'code-pattern',
            tags: ['bootstrap', c._dimId || '', ...(c.tags || [])].filter(Boolean),
            scope: 'project',
            summary: c.summary,
            trigger: c._trigger || undefined,
            relations: c.relations || undefined,
            reasoning: {
              whyStandard: c._skillReference || c.summary,
              sources: c.sources,
              confidence,
              qualitySignals,
            },
          }, 'bootstrap', {}, { userId: 'bootstrap_agent' });

          candidateResults.created++;
        } catch (itemErr) {
          candidateResults.failed++;
          candidateResults.errors.push({ dimension: c._dimId || 'unknown', subTopic: c.subTopic, error: itemErr.message });
        }
      }

      ctx.logger.info(`[Bootstrap] Phase 5.2: ${candidateResults.created} candidates persisted, ${candidateResults.failed} failed`);
    }
  }

  // ── Phase 5.5: Skill-Worthy 维度 → 自动生成 Project Skill ──
  const autoSkillResults = { created: 0, failed: 0, skills: [], errors: [] };
  try {
    const { createSkill } = await import('../../skill.js');
    const skillWorthyDims = dimensions.filter(d => d.skillWorthy && dimensionCandidates[d.id]?.length > 0);

    for (const dim of skillWorthyDims) {
      // ── Fix 1: 并发安全 — 检测 session 是否被新请求覆盖 ──
      if (taskManager && !taskManager.isSessionValid(sessionId)) {
        ctx.logger.warn(`[Bootstrap] Session ${sessionId} superseded — aborting Phase 5.5`);
        break;
      }

      const taskId = dim.id;

      // Fix 5: 此时才标记 skillWorthy 维度为 filling（真正开始生成 Skill）
      taskManager?.markTaskFilling(taskId);

      try {
        const candidates = dimensionCandidates[dim.id];
        const skillContent = buildProjectSkillContent(dim, candidates, {
          primaryLang, langStats, targetFileMap, depGraphData, guardAudit, astProjectSummary,
        });

        // 复用 createSkill() 统一写入逻辑
        const result = createSkill(ctx, {
          name: dim.skillMeta.name,
          description: dim.skillMeta.description,
          content: skillContent,
          overwrite: true,         // Bootstrap 每次覆盖更新
          createdBy: 'bootstrap',
        });

        const parsed = JSON.parse(result);
        if (parsed.success) {
          autoSkillResults.created++;
          autoSkillResults.skills.push(dim.skillMeta.name);
          ctx.logger.info(`[Bootstrap] Phase 5.5: Auto-generated Project Skill "${dim.skillMeta.name}" (${candidates.length} sources)`);
          taskManager?.markTaskCompleted(taskId, {
            type: 'skill',
            skillName: dim.skillMeta.name,
            sourceCount: candidates.length,
          });
        } else {
          throw new Error(parsed.error?.message || 'createSkill returned failure');
        }
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

  // 汇总日志
  ctx.logger.info(`[Bootstrap] Async fill completed: ${candidateResults.created} candidates created, ${autoSkillResults.created} skills generated`);

  // ── Fix 2: 释放大型引用，避免闭包持久占用内存 ──
  allFiles = null;
  fillContext.targetFileMap = null;
  fillContext.depGraphData = null;
  fillContext.astProjectSummary = null;
  fillContext.ctx = null;
}
