/**
 * RecipeStatsTracker — Recipe 使用统计追踪器
 * 记录 guard/human/ai 三档使用次数，计算热度和权威分
 * 持久化到 AutoSnippet/recipe-stats.json（Git 友好）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import Logger from '../../infrastructure/logging/Logger.js';
import pathGuard from '../../shared/PathGuard.js';

const SCHEMA_VERSION = 1;
const DEFAULT_HEAT_WEIGHTS = { guard: 1.0, human: 2.0, ai: 1.5 };
const AUTHORITY_ALPHA = 0.6;

export class RecipeStatsTracker {
  #statsPath;
  #data;       // { schemaVersion, byTrigger: {}, byFile: {} }

  constructor(projectRoot, options = {}) {
    const kbDir = options.knowledgeBaseDir || 'AutoSnippet';
    this.#statsPath = join(projectRoot, kbDir, 'recipe-stats.json');
    pathGuard.assertProjectWriteSafe(this.#statsPath);
    this.#migrateOldPath(projectRoot, options.internalDir || '.autosnippet');
    this.#data = this.#load();
  }

  /**
   * 记录一次 Recipe 使用
   * @param {{ trigger?: string, recipeFilePath?: string, source: 'guard'|'human'|'ai' }} usage
   */
  recordUsage(usage) {
    const { trigger, recipeFilePath, source = 'human' } = usage;
    const key = trigger || recipeFilePath;
    if (!key) return;

    const store = trigger ? this.#data.byTrigger : this.#data.byFile;
    if (!store[key]) {
      store[key] = { guardUsageCount: 0, humanUsageCount: 0, aiUsageCount: 0, lastUsedAt: null, authority: 0 };
    }

    const entry = store[key];
    if (source === 'guard') entry.guardUsageCount++;
    else if (source === 'ai') entry.aiUsageCount++;
    else entry.humanUsageCount++;
    entry.lastUsedAt = new Date().toISOString();

    this.#save();
  }

  /**
   * 设置权威分 (0-5)
   */
  setAuthority(key, value) {
    const entry = this.#data.byTrigger[key] || this.#data.byFile[key];
    if (entry) {
      entry.authority = Math.max(0, Math.min(5, value));
      this.#save();
    }
  }

  /**
   * 计算使用热度
   * heat = w_guard * guard + w_human * human + w_ai * ai
   */
  getUsageHeat(entry, weights = DEFAULT_HEAT_WEIGHTS) {
    if (!entry) return 0;
    return (entry.guardUsageCount || 0) * weights.guard
         + (entry.humanUsageCount || 0) * weights.human
         + (entry.aiUsageCount || 0) * weights.ai;
  }

  /**
   * 综合权威分 = α * normalize(heat) + (1-α) * (authority/5)
   */
  getAuthorityScore(entry, allEntries = null) {
    if (!entry) return 0;
    const heat = this.getUsageHeat(entry);
    const maxHeat = allEntries
      ? Math.max(...Object.values(allEntries).map(e => this.getUsageHeat(e)), 1)
      : Math.max(heat, 1);
    const normalizedHeat = heat / maxHeat;
    const normalizedAuthority = (entry.authority || 0) / 5;
    return AUTHORITY_ALPHA * normalizedHeat + (1 - AUTHORITY_ALPHA) * normalizedAuthority;
  }

  /**
   * 获取所有统计
   */
  getStats() {
    return { ...this.#data };
  }

  /**
   * 获取指定 Recipe 的统计
   */
  getEntryStats(key) {
    return this.#data.byTrigger[key] || this.#data.byFile[key] || null;
  }

  /**
   * 获取热门 Recipes (top N)
   */
  getTopRecipes(n = 10) {
    const allEntries = { ...this.#data.byTrigger, ...this.#data.byFile };
    return Object.entries(allEntries)
      .map(([key, entry]) => ({
        key,
        heat: this.getUsageHeat(entry),
        authorityScore: this.getAuthorityScore(entry, allEntries),
        ...entry,
      }))
      .sort((a, b) => b.authorityScore - a.authorityScore)
      .slice(0, n);
  }

  #load() {
    try {
      if (existsSync(this.#statsPath)) {
        return JSON.parse(readFileSync(this.#statsPath, 'utf-8'));
      }
    } catch { /* silent */ }
    return { schemaVersion: SCHEMA_VERSION, byTrigger: {}, byFile: {} };
  }

  #save() {
    try {
      const dir = dirname(this.#statsPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.#statsPath, JSON.stringify(this.#data, null, 2));
    } catch (err) {
      Logger.getInstance().warn('RecipeStatsTracker: failed to persist stats', { error: err.message });
    }
  }

  #migrateOldPath(projectRoot, internalDir) {
    try {
      const oldPath = join(projectRoot, internalDir, 'recipe-stats.json');
      if (existsSync(oldPath) && !existsSync(this.#statsPath)) {
        const content = readFileSync(oldPath, 'utf-8');
        const dir = dirname(this.#statsPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(this.#statsPath, content);
        unlinkSync(oldPath);
      }
    } catch { /* 迁移失败不阻断启动 */ }
  }
}
