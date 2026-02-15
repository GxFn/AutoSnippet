/**
 * RuleLearner — Guard 规则学习系统
 * 追踪规则触发与用户反馈，计算 P/R/F1，识别高误报规则并给出优化建议
 * 持久化到 AutoSnippet/guard-learner.json（Git 友好）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import Logger from '../../infrastructure/logging/Logger.js';
import pathGuard from '../../shared/PathGuard.js';

const PROBLEMATIC_THRESHOLD = { falsePositiveRate: 0.3, minTriggers: 5 };

export class RuleLearner {
  #learnerPath;
  #data;   // { ruleStats: { [ruleId]: { triggers, correct, falsePositive, falseNegative } } }

  constructor(projectRoot, options = {}) {
    const kbDir = options.knowledgeBaseDir || 'AutoSnippet';
    this.#learnerPath = join(projectRoot, kbDir, 'guard-learner.json');
    pathGuard.assertProjectWriteSafe(this.#learnerPath);
    this.#migrateOldPath(projectRoot, options.internalDir || '.autosnippet');
    this.#data = this.#load();
  }

  /**
   * 记录规则触发
   * @param {string} ruleId
   * @param {{ filePath?: string, message?: string }} context
   */
  recordTrigger(ruleId, context = {}) {
    const stat = this.#ensureStat(ruleId);
    stat.triggers++;
    stat.lastTriggered = new Date().toISOString();
    this.#save();
  }

  /**
   * 记录用户反馈
   * @param {string} ruleId
   * @param {'correct'|'falsePositive'|'falseNegative'} feedbackType
   */
  recordFeedback(ruleId, feedbackType) {
    const stat = this.#ensureStat(ruleId);
    if (feedbackType === 'correct') stat.correct++;
    else if (feedbackType === 'falsePositive') stat.falsePositive++;
    else if (feedbackType === 'falseNegative') stat.falseNegative++;
    stat.lastFeedback = new Date().toISOString();
    this.#save();
  }

  /**
   * 获取规则精准度指标
   * @param {string} ruleId
   * @returns {{ precision: number, recall: number, f1: number, triggers: number, falsePositiveRate: number }}
   */
  getMetrics(ruleId) {
    const stat = this.#data.ruleStats[ruleId];
    if (!stat || stat.triggers === 0) {
      return { precision: 1, recall: 1, f1: 1, triggers: 0, falsePositiveRate: 0 };
    }

    const tp = stat.correct;
    const fp = stat.falsePositive;
    const fn = stat.falseNegative;

    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 1;
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : 1;
    const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    const falsePositiveRate = stat.triggers > 0 ? fp / stat.triggers : 0;

    return { precision, recall, f1, triggers: stat.triggers, falsePositiveRate };
  }

  /**
   * 识别问题规则（高误报）
   * @returns {Array<{ ruleId: string, metrics: object, recommendation: string }>}
   */
  getProblematicRules() {
    const results = [];
    for (const [ruleId, stat] of Object.entries(this.#data.ruleStats)) {
      if (stat.triggers < PROBLEMATIC_THRESHOLD.minTriggers) continue;

      const metrics = this.getMetrics(ruleId);
      if (metrics.falsePositiveRate >= PROBLEMATIC_THRESHOLD.falsePositiveRate) {
        let recommendation;
        if (metrics.falsePositiveRate > 0.7) {
          recommendation = 'disable';
        } else if (metrics.precision < 0.5) {
          recommendation = 'tune';
        } else {
          recommendation = 'review';
        }
        results.push({ ruleId, metrics, recommendation });
      }
    }
    return results.sort((a, b) => b.metrics.falsePositiveRate - a.metrics.falsePositiveRate);
  }

  /**
   * 获取所有规则统计
   */
  getAllStats() {
    const result = {};
    for (const [ruleId] of Object.entries(this.#data.ruleStats)) {
      result[ruleId] = {
        ...this.#data.ruleStats[ruleId],
        metrics: this.getMetrics(ruleId),
      };
    }
    return result;
  }

  /**
   * 重置指定规则或全部统计
   */
  resetStats(ruleId = null) {
    if (ruleId) {
      delete this.#data.ruleStats[ruleId];
    } else {
      this.#data.ruleStats = {};
    }
    this.#save();
  }

  // ─── 私有 ─────────────────────────────────────────────

  #ensureStat(ruleId) {
    if (!this.#data.ruleStats[ruleId]) {
      this.#data.ruleStats[ruleId] = {
        triggers: 0,
        correct: 0,
        falsePositive: 0,
        falseNegative: 0,
        lastTriggered: null,
        lastFeedback: null,
      };
    }
    return this.#data.ruleStats[ruleId];
  }

  #load() {
    try {
      if (existsSync(this.#learnerPath)) {
        return JSON.parse(readFileSync(this.#learnerPath, 'utf-8'));
      }
    } catch { /* silent */ }
    return { ruleStats: {} };
  }

  #save() {
    try {
      const dir = dirname(this.#learnerPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.#learnerPath, JSON.stringify(this.#data, null, 2));
    } catch (err) {
      Logger.getInstance().warn('RuleLearner: failed to persist learner data', { error: err.message });
    }
  }

  #migrateOldPath(projectRoot, internalDir) {
    try {
      const oldPath = join(projectRoot, internalDir, 'guard-learner.json');
      if (existsSync(oldPath) && !existsSync(this.#learnerPath)) {
        const content = readFileSync(oldPath, 'utf-8');
        const dir = dirname(this.#learnerPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(this.#learnerPath, content);
        unlinkSync(oldPath);
      }
    } catch { /* 迁移失败不阻断启动 */ }
  }
}
