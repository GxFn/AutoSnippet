/**
 * TierScheduler.js — 维度分层并行调度器
 *
 * 按维度间信息依赖关系分 3 层执行:
 * - Tier 1: 基础数据层 (project-profile, objc-deep-scan, category-scan) — 可并行
 * - Tier 2: 规范+架构+模式 (code-standard, architecture, code-pattern) — 依赖 Tier 1
 * - Tier 3: 流转+实践+总结 (event-and-data-flow, best-practice, agent-guidelines) — 依赖 Tier 2
 *
 * 每层内部可并行 (受 concurrency 限制)，层间串行。
 *
 * @module TierScheduler
 */

import Logger from '../../../../../infrastructure/logging/Logger.js';

const logger = Logger.getInstance();

// ──────────────────────────────────────────────────────────────────
// 分层定义
// ──────────────────────────────────────────────────────────────────

const DEFAULT_TIERS = [
  ['project-profile', 'objc-deep-scan', 'category-scan'],                   // Tier 1: 基础数据
  ['code-standard', 'architecture', 'code-pattern'],                        // Tier 2: 规范+架构+模式
  ['event-and-data-flow', 'best-practice', 'agent-guidelines'],             // Tier 3: 流转+实践+总结
];

// ──────────────────────────────────────────────────────────────────
// 简单信号量 (控制并发)
// ──────────────────────────────────────────────────────────────────

class Semaphore {
  #permits;
  #queue = [];

  constructor(permits) {
    this.#permits = permits;
  }

  async acquire() {
    if (this.#permits > 0) {
      this.#permits--;
      return;
    }
    return new Promise(resolve => {
      this.#queue.push(resolve);
    });
  }

  release() {
    if (this.#queue.length > 0) {
      const resolve = this.#queue.shift();
      resolve();
    } else {
      this.#permits++;
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// TierScheduler
// ──────────────────────────────────────────────────────────────────

export class TierScheduler {
  /** @type {string[][]} */
  #tiers;

  /**
   * @param {string[][]} [tiers] — 自定义分层 (默认使用 DEFAULT_TIERS)
   */
  constructor(tiers = DEFAULT_TIERS) {
    this.#tiers = tiers;
  }

  /**
   * 分层执行维度
   *
   * @param {Function} executeDimension — async (dimId) => DimensionResult
   * @param {object} [options]
   * @param {number} [options.concurrency=3] — Tier 内最大并行数
   * @param {Function} [options.onTierComplete] — (tierIndex, tierResults) => void
   * @param {Function} [options.shouldAbort] — () => boolean — 外部中止信号
   * @returns {Promise<Map<string, any>>} — dimId → result
   */
  async execute(executeDimension, options = {}) {
    const { concurrency = 3, onTierComplete, shouldAbort } = options;
    const results = new Map();

    for (let tierIndex = 0; tierIndex < this.#tiers.length; tierIndex++) {
      const tier = this.#tiers[tierIndex];

      if (shouldAbort?.()) {
        logger.warn(`[TierScheduler] Aborted before Tier ${tierIndex + 1}`);
        break;
      }

      logger.info(`[TierScheduler] ── Tier ${tierIndex + 1}/${this.#tiers.length}: [${tier.join(', ')}] (concurrency=${concurrency})`);

      const tierResults = await this.#executeTier(tier, executeDimension, concurrency, shouldAbort);

      for (const [dimId, result] of tierResults) {
        results.set(dimId, result);
      }

      onTierComplete?.(tierIndex, tierResults);
    }

    return results;
  }

  /**
   * 执行单个 Tier 内的所有维度 (并发控制)
   */
  async #executeTier(dimensionIds, executeDimension, concurrency, shouldAbort) {
    const semaphore = new Semaphore(concurrency);
    const results = new Map();

    await Promise.all(
      dimensionIds.map(async (dimId) => {
        if (shouldAbort?.()) return;

        await semaphore.acquire();
        try {
          if (shouldAbort?.()) return;
          const result = await executeDimension(dimId);
          results.set(dimId, result);
        } catch (err) {
          logger.error(`[TierScheduler] Dimension "${dimId}" failed: ${err.message}`);
          results.set(dimId, { error: err.message, candidateCount: 0 });
        } finally {
          semaphore.release();
        }
      })
    );

    return results;
  }

  /**
   * 获取维度所在的 Tier 索引
   * @param {string} dimId
   * @returns {number} — 0-based tier index, -1 if not found
   */
  getTierIndex(dimId) {
    for (let i = 0; i < this.#tiers.length; i++) {
      if (this.#tiers[i].includes(dimId)) return i;
    }
    return -1;
  }

  /**
   * 获取分层定义
   * @returns {string[][]}
   */
  getTiers() {
    return this.#tiers;
  }
}

export default TierScheduler;
