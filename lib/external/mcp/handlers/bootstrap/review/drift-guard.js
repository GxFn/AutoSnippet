/**
 * Bootstrap AI Review — 反漂移护栏
 *
 * 检测 AI 审查结果是否发生"任务漂移"（过度丢弃/偏离语义/一刀切赋分），
 * 在检测到异常时自动回退到保守策略。
 */

import Logger from '../../../../../infrastructure/logging/Logger.js';

// ─── 工具函数 ────────────────────────────────────────────

/**
 * 从 summary 中提取匹配数量
 * 如 "单例模式：42 处检测到" → 42
 */
export function extractMatchCount(summary) {
  const m = (summary || '').match(/(\d+)\s*(?:处|个文件|条)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * P2-7: 计算 title 与 summary 的语义重叠度（中英文双策略）
 *
 * 英文: 按空格/分隔符分词，检查词级重叠
 * 中文: 使用字符级 bigram overlap（2-gram），因为中文无空格分词
 * 最终取两种策略的最大值
 */
export function computeTitleSummaryOverlap(title, summary) {
  const titleLower = title.toLowerCase();
  const summaryLower = summary.toLowerCase();

  // 策略 1: 英文/混合词级重叠
  const titleWords = titleLower.split(/[\s\-_/:：·,，]+/).filter(w => w.length >= 2);
  let wordOverlap = 0;
  if (titleWords.length >= 2) {
    wordOverlap = titleWords.filter(w => summaryLower.includes(w)).length / titleWords.length;
  }

  // 策略 2: 中文字符 bigram 重叠
  const cjkCharsTitle = titleLower.match(/[\u4e00-\u9fff]/g) || [];
  let bigramOverlap = 0;
  if (cjkCharsTitle.length >= 2) {
    const titleBigrams = new Set();
    for (let i = 0; i < cjkCharsTitle.length - 1; i++) {
      titleBigrams.add(cjkCharsTitle[i] + cjkCharsTitle[i + 1]);
    }

    const cjkCharsSummary = summaryLower.match(/[\u4e00-\u9fff]/g) || [];
    const summaryBigrams = new Set();
    for (let i = 0; i < cjkCharsSummary.length - 1; i++) {
      summaryBigrams.add(cjkCharsSummary[i] + cjkCharsSummary[i + 1]);
    }

    const intersect = [...titleBigrams].filter(bg => summaryBigrams.has(bg)).length;
    bigramOverlap = intersect / titleBigrams.size;
  }

  // 策略 3: 单字符直接包含（短 title 兜底，如 "KVO" "MVVM"）
  let charOverlap = 0;
  if (titleLower.length >= 2 && titleLower.length <= 6) {
    charOverlap = summaryLower.includes(titleLower) ? 1.0 : 0;
  }

  return Math.max(wordOverlap, bigramOverlap, charOverlap);
}

// ─── Round 1 反漂移 ──────────────────────────────────────

/**
 * Round 1 反漂移：检查 AI 是否过度丢弃
 *
 * 如果 AI 丢弃了大多数候选（>60%），很可能发生了漂移
 * 此时回退到保守策略：保留全部，仅丢弃 confidence=0 的。
 */
export function guardRound1Drift(round1Result, candidates) {
  const { kept, merged, dropped } = round1Result;
  const dropRate = dropped.length / candidates.length;

  if (dropRate > 0.6) {
    Logger.warn(`[Anti-Drift] Round 1 漂移疑似！丢弃 ${dropped.length}/${candidates.length} (${(dropRate * 100).toFixed(0)}%) — 回退到保守模式`);
    // 回退：保留全部，仅去掉 Round 1 标注了最明确理由且 matchCount=0 的
    const conservativeDropped = dropped.filter(d => {
      const matchCount = extractMatchCount(d.summary);
      return matchCount === 0 && (d._dropReason || '').includes('false positive');
    });
    const conservativeKept = [
      ...kept,
      ...dropped.filter(d => !conservativeDropped.includes(d)),
    ];
    return {
      kept: conservativeKept,
      merged,
      dropped: conservativeDropped,
      _driftGuardTriggered: true,
    };
  }

  return round1Result;
}

// ─── Round 2 反漂移 ──────────────────────────────────────

/**
 * Round 2 反漂移：验证 AI 精炼结果没有偏离原始含义
 *
 * 检查项：
 *   1. summary 是否与原始 title/subTopic 语义相关（中英文双策略重叠检测）
 *   2. confidence 是否在合理范围内（不能全部 > 0.9 或全部 < 0.3）
 *   3. 全局 confidence 分布异常检测
 */
export function guardRound2Drift(refinedCandidates) {
  let driftCount = 0;

  for (const c of refinedCandidates) {
    if (!c._aiReviewed) continue;

    // 检查 1: summary 不应完全偏离原始 title
    const overlap = computeTitleSummaryOverlap(c.title || '', c.summary || '');

    if (overlap < 0.15) {
      Logger.warn(`[Anti-Drift] Round 2: "${c.title}" — summary 与 title 无关联 (overlap ${(overlap * 100).toFixed(0)}%), 回退 summary`);
      if (c._originalSummary) {
        c.summary = c._originalSummary;
      }
      c._driftDetected = 'summary';
      driftCount++;
    }

    // 检查 2: confidence 范围护栏
    if (typeof c._aiConfidence === 'number') {
      if (c._aiConfidence > 0.95) c._aiConfidence = 0.9;
      if (c._aiConfidence < 0.1) c._aiConfidence = 0.15;
    }
  }

  // 检查 3: 全局 confidence 分布异常（全部太高或太低 → AI 可能一刀切）
  const confValues = refinedCandidates
    .filter(c => typeof c._aiConfidence === 'number')
    .map(c => c._aiConfidence);

  if (confValues.length >= 3) {
    const avg = confValues.reduce((a, b) => a + b, 0) / confValues.length;
    const variance = confValues.reduce((s, v) => s + (v - avg) ** 2, 0) / confValues.length;

    if (variance < 0.005 && confValues.length > 5) {
      Logger.warn(`[Anti-Drift] Round 2: confidence 方差过低 (${variance.toFixed(4)}) — AI 可能一刀切赋分，保留但标记`);
      for (const c of refinedCandidates) {
        if (c._aiReviewed) c._confidenceFlat = true;
      }
    }
  }

  if (driftCount > 0) {
    Logger.info(`[Anti-Drift] Round 2: ${driftCount}/${refinedCandidates.filter(c => c._aiReviewed).length} candidates drift detected & reverted`);
  }

  return refinedCandidates;
}
