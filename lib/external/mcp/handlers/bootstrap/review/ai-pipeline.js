/**
 * Bootstrap AI Review — 三轮审查管线
 *
 * Phase 5.1: 对提取器产出的候选进行多轮 AI 审查，确保质量和准确性。
 *
 * 核心原则：
 *   1. 用耗时但准确的方式验证候选 — 冷启动是异步的，不怕慢
 *   2. 严禁任务漂移 — 每轮审查有精确的 scope 限定
 *   3. 多轮递进 — 资格审查 → 内容精炼 → 去重合并
 *
 * 三轮审查：
 *   Round 1 — 资格审查（Eligibility Gate）
 *   Round 2 — 内容精炼（Content Refine）
 *   Round 3 — 关系推断 + 去重（Dedup & Relations）
 */

import Logger from '../../../../../infrastructure/logging/Logger.js';
import { buildRound1Prompt, buildRound2Prompt, buildRound3Prompt } from './prompts.js';
import { extractMatchCount } from './drift-guard.js';

// ─── 共用常量 ────────────────────────────────────────────

/** Round 1/3 每批候选数上限（控制 prompt token 不超窗口） */
const ROUND1_BATCH_SIZE = 12;
const ROUND3_BATCH_SIZE = 20;

/** AI 调用超时 ms（单次 chat 调用） */
const AI_CALL_TIMEOUT_MS = 90_000;

/** 失败重试次数 */
const AI_MAX_RETRIES = 2;

/** 重试基础延迟 ms（指数退避） */
const AI_RETRY_BASE_MS = 2000;

// ─── AI 调用工具 ─────────────────────────────────────────

/**
 * 带 timeout + 指数退避重试的 AI chat 调用
 *
 * @param {object} aiProvider
 * @param {string} prompt
 * @param {object} chatOptions — temperature 等
 * @param {object} [retryOptions]
 * @returns {Promise<string>}
 */
async function _aiChatWithRetry(aiProvider, prompt, chatOptions = {}, retryOptions = {}) {
  const {
    timeout = AI_CALL_TIMEOUT_MS,
    maxRetries = AI_MAX_RETRIES,
    retryBaseMs = AI_RETRY_BASE_MS,
    label = 'AI chat',
  } = retryOptions;

  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await Promise.race([
        aiProvider.chat(prompt, chatOptions),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout),
        ),
      ]);
      return result;
    } catch (err) {
      lastErr = err;
      const isTimeout = err.message?.includes('timed out');
      const isRetryable = isTimeout || /429|503|rate.?limit/i.test(err.message);

      if (!isRetryable || attempt >= maxRetries) break;

      const delay = retryBaseMs * 2 ** attempt;
      Logger.warn(`[AI Review] ${label} attempt ${attempt + 1} failed (${err.message}), retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ─── Round 1: 资格审查 ───────────────────────────────────

/**
 * Round 1: 分批资格审查 — 判定候选是否值得保留
 *
 * @param {object} aiProvider — AI provider with chat()
 * @param {object[]} candidates — 提取器原始产出
 * @param {object} projectContext — { primaryLang, fileCount, targetCount }
 * @param {object} [options] — { onProgress }
 * @returns {Promise<{ kept: object[], merged: object[][], dropped: object[] }>}
 */
export async function reviewRound1_EligibilityGate(aiProvider, candidates, projectContext, options = {}) {
  const { onProgress } = options;
  if (!aiProvider || candidates.length === 0) {
    return { kept: [...candidates], merged: [], dropped: [] };
  }

  onProgress?.('review:round1-started', { total: candidates.length });

  const allKept = [];
  const allDropped = [];
  const globalMergeGroups = new Map();
  const globalMergedIndices = new Set();

  for (let batchStart = 0; batchStart < candidates.length; batchStart += ROUND1_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + ROUND1_BATCH_SIZE, candidates.length);
    const batch = candidates.slice(batchStart, batchEnd);

    const candidateSummaries = batch.map((c, localIdx) => ({
      index: batchStart + localIdx,
      title: c.title || '',
      subTopic: c.subTopic || '',
      summary: c.summary || '',
      sources: (c.sources || []).slice(0, 3),
      matchCount: extractMatchCount(c.summary),
      codeSamplePreview: (c.code || '').substring(0, 200),
    }));

    const prompt = buildRound1Prompt(candidateSummaries, projectContext);

    try {
      const response = await _aiChatWithRetry(aiProvider, prompt, { temperature: 0.1 }, { label: `Round1 batch ${batchStart}-${batchEnd}` });
      const parsed = aiProvider.extractJSON(response, '{', '}');

      if (!parsed?.decisions || !Array.isArray(parsed.decisions)) {
        Logger.warn(`[Bootstrap AI Review] Round 1 batch ${batchStart}-${batchEnd}: AI returned invalid format, keeping all`);
        for (let i = batchStart; i < batchEnd; i++) allKept.push(candidates[i]);
        continue;
      }

      const batchProcessed = new Set();

      for (const decision of parsed.decisions) {
        const idx = decision.index;
        if (idx < batchStart || idx >= batchEnd) continue;
        batchProcessed.add(idx);

        switch (decision.verdict) {
          case 'drop':
            allDropped.push({ ...candidates[idx], _dropReason: decision.reason });
            Logger.info(`[Bootstrap AI Review] DROP: "${candidates[idx].title}" — ${decision.reason}`);
            break;

          case 'merge':
            if (Array.isArray(decision.mergeWith) && decision.mergeWith.length > 0) {
              const groupIndices = [idx, ...decision.mergeWith]
                .filter(gi => gi >= 0 && gi < candidates.length)
                .sort((a, b) => a - b);
              const leader = groupIndices[0];

              if (!globalMergeGroups.has(leader)) {
                globalMergeGroups.set(leader, []);
              }
              const group = globalMergeGroups.get(leader);
              for (const gi of groupIndices) {
                if (!globalMergedIndices.has(gi)) {
                  group.push(candidates[gi]);
                  globalMergedIndices.add(gi);
                }
              }
            } else {
              allKept.push(candidates[idx]);
            }
            break;

          case 'keep':
          default:
            if (!globalMergedIndices.has(idx)) {
              allKept.push(candidates[idx]);
            }
            break;
        }
      }

      for (let i = batchStart; i < batchEnd; i++) {
        if (!batchProcessed.has(i) && !globalMergedIndices.has(i)) {
          allKept.push(candidates[i]);
        }
      }
    } catch (err) {
      Logger.warn(`[Bootstrap AI Review] Round 1 batch ${batchStart}-${batchEnd} failed: ${err.message}, keeping all`);
      for (let i = batchStart; i < batchEnd; i++) {
        if (!globalMergedIndices.has(i)) allKept.push(candidates[i]);
      }
    }
  }

  const merged = [...globalMergeGroups.values()].filter(g => g.length > 1);

  onProgress?.('review:round1-completed', {
    total: candidates.length,
    kept: allKept.length,
    merged: merged.length,
    dropped: allDropped.length,
  });

  Logger.info(`[Bootstrap AI Review] Round 1 完成: ${allKept.length} kept, ${merged.length} merge groups, ${allDropped.length} dropped`);

  return { kept: allKept, merged, dropped: allDropped };
}

// ─── Round 2: 内容精炼 ───────────────────────────────────

/**
 * Round 2: 分批内容精炼 — AI 改写 summary/agentNotes/insight，生成 trigger，动态 confidence
 *
 * @param {object} aiProvider
 * @param {object[]} candidates — Round 1 过滤后的候选
 * @param {string[]} allTitles — 全部候选标题（含被 drop 的，供上下文用）
 * @param {object} projectContext — { primaryLang, projectName }
 * @param {object} [options] — { onProgress, batchSize, concurrency }
 * @returns {Promise<object[]>} 精炼后的候选数组
 */
export async function reviewRound2_ContentRefine(aiProvider, candidates, allTitles, projectContext, options = {}) {
  const { onProgress, batchSize = 3, concurrency = 2 } = options;
  if (!aiProvider || candidates.length === 0) return candidates;

  onProgress?.('review:round2-started', { total: candidates.length });

  for (const c of candidates) {
    c._originalSummary = c.summary;
  }

  const batches = [];
  for (let i = 0; i < candidates.length; i += batchSize) {
    batches.push({ startIdx: i, items: candidates.slice(i, i + batchSize) });
  }

  const results = new Array(candidates.length).fill(null);
  let processedCount = 0;

  const processBatch = async (batch) => {
    const { startIdx, items } = batch;
    const batchPrompt = buildRound2Prompt(items, allTitles, projectContext);

    try {
      const response = await _aiChatWithRetry(aiProvider, batchPrompt, { temperature: 0.2 }, { label: `Round2 batch ${startIdx}` });
      const parsed = aiProvider.extractJSON(response, '{', '}');

      if (parsed?.refinements && Array.isArray(parsed.refinements)) {
        for (let j = 0; j < items.length; j++) {
          const c = { ...items[j] };

          let r = parsed.refinements[j];
          if (parsed.refinements.length === items.length) {
            const titleMatch = parsed.refinements.find(ref =>
              ref?.title && ref.title === c.title,
            );
            if (titleMatch) r = titleMatch;
          }

          if (r) {
            _applyRefinement(c, r);
          }

          results[startIdx + j] = c;
          processedCount++;
        }
      } else {
        for (let j = 0; j < items.length; j++) {
          results[startIdx + j] = { ...items[j] };
          processedCount++;
        }
      }
    } catch (err) {
      Logger.warn(`[Bootstrap AI Review] Round 2 batch ${startIdx} failed: ${err.message}`);
      for (let j = 0; j < items.length; j++) {
        results[startIdx + j] = { ...items[j] };
        processedCount++;
      }
    }

    onProgress?.('review:round2-progress', {
      current: processedCount,
      total: candidates.length,
      progress: Math.round((processedCount / candidates.length) * 100),
    });
  };

  for (let i = 0; i < batches.length; i += concurrency) {
    const chunk = batches.slice(i, i + concurrency);
    await Promise.all(chunk.map(processBatch));
  }

  const refined = results.map((r, i) => r || { ...candidates[i] });

  onProgress?.('review:round2-completed', {
    total: candidates.length,
    refined: refined.filter(c => c._aiReviewed).length,
  });

  return refined;
}

/**
 * 将 AI 精炼结果安全地应用到候选上
 */
function _applyRefinement(candidate, refinement) {
  const r = refinement;

  if (r.summary && typeof r.summary === 'string' && r.summary.length <= 150) {
    candidate.summary = r.summary;
  }

  if (Array.isArray(r.agentNotes) && r.agentNotes.length >= 1 && r.agentNotes.length <= 5) {
    candidate._refinedAgentNotes = r.agentNotes;
  }

  if (r.insight && typeof r.insight === 'string') {
    candidate._aiInsight = r.insight;
  }

  if (r.trigger && typeof r.trigger === 'string' && r.trigger.length <= 100) {
    candidate._trigger = r.trigger;
  }

  if (typeof r.confidence === 'number' && r.confidence >= 0 && r.confidence <= 1) {
    candidate._aiConfidence = r.confidence;
  }

  candidate._aiReviewed = true;
}

// ─── Round 3: 去重 + 关系推断 ────────────────────────────

/**
 * Round 3: 去重与关系推断
 *
 * @param {object} aiProvider
 * @param {object[]} candidates — Round 2 精炼后的全部候选
 * @param {object} [options]
 * @returns {Promise<{ candidates: object[], relations: object[] }>}
 */
export async function reviewRound3_DedupAndRelations(aiProvider, candidates, options = {}) {
  const { onProgress } = options;
  if (!aiProvider || candidates.length <= 1) {
    return { candidates, relations: [] };
  }

  onProgress?.('review:round3-started', { total: candidates.length });

  const titleToCandidate = new Map();
  for (const c of candidates) {
    const stableId = c.title || `untitled-${Math.random().toString(36).slice(2, 8)}`;
    c._stableId = stableId;
    titleToCandidate.set(stableId, c);
  }

  const candidateOverview = candidates.map(c => ({
    id: c._stableId,
    title: c.title,
    subTopic: c.subTopic,
    summary: c.summary,
    tags: c.tags || [],
  }));

  const allDupDropIds = new Set();
  const allRelations = [];

  for (let batchStart = 0; batchStart < candidateOverview.length; batchStart += ROUND3_BATCH_SIZE) {
    const batchOverview = candidateOverview.slice(batchStart, batchStart + ROUND3_BATCH_SIZE);

    const prompt = buildRound3Prompt(batchOverview);

    try {
      const response = await _aiChatWithRetry(aiProvider, prompt, { temperature: 0.1 }, { label: `Round3 batch ${batchStart}` });
      const parsed = aiProvider.extractJSON(response, '{', '}');
      if (!parsed) continue;

      if (Array.isArray(parsed.duplicates)) {
        for (const dup of parsed.duplicates) {
          const dropId = dup.dropId || dup.drop;
          if (typeof dropId === 'string' && titleToCandidate.has(dropId)) {
            allDupDropIds.add(dropId);
            Logger.info(`[Bootstrap AI Review] DEDUP: dropping "${dropId}" — ${dup.reason}`);
          }
        }
      }

      if (Array.isArray(parsed.relations)) {
        for (const rel of parsed.relations) {
          const fromId = rel.fromId || rel.from;
          const toId = rel.toId || rel.to;
          if (typeof fromId !== 'string' || typeof toId !== 'string') continue;
          if (!titleToCandidate.has(fromId) || !titleToCandidate.has(toId)) continue;
          if (allDupDropIds.has(fromId) || allDupDropIds.has(toId)) continue;

          allRelations.push({
            type: rel.type || 'RELATED',
            fromTitle: fromId,
            toTitle: toId,
            description: rel.description || '',
          });
        }
      }
    } catch (err) {
      Logger.warn(`[Bootstrap AI Review] Round 3 batch ${batchStart} failed: ${err.message}`);
    }
  }

  const dedupedCandidates = candidates.filter(c => !allDupDropIds.has(c._stableId));

  for (const c of dedupedCandidates) {
    const relatedItems = allRelations.filter(r => r.fromTitle === c._stableId);
    if (relatedItems.length > 0) {
      c.relations = [
        ...(c.relations || []),
        ...relatedItems.map(r => ({
          type: r.type,
          target: r.toTitle,
          description: r.description,
        })),
      ];
    }
  }

  onProgress?.('review:round3-completed', {
    total: candidates.length,
    afterDedup: dedupedCandidates.length,
    relationsFound: allRelations.length,
  });

  Logger.info(`[Bootstrap AI Review] Round 3 完成: ${dedupedCandidates.length}/${candidates.length} survived dedup, ${allRelations.length} relations inferred`);

  return { candidates: dedupedCandidates, relations: allRelations };
}
