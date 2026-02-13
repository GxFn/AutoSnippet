/**
 * SignalCollector — 后台行为信号收集与 Skill 推荐服务
 *
 * 在 `asd ui` 运行时作为后台定时任务静默运行，周期性分析用户行为并生成
 * Skill 推荐。支持三种工作模式：
 *
 *   - off      — 不收集，不推荐
 *   - suggest  — 收集信号并推送推荐（默认）
 *   - auto     — 收集信号 + 自动创建高优先级 Skill
 *
 * 设计原则：
 *   1. 静默 — 不打断用户，不阻塞主线程，所有 I/O 错误降级
 *   2. 增量 — 每次只扫描上次快照以来的新数据
 *   3. 去重 — 同一推荐仅推送一次（基于 name hash）
 *   4. 轻量 — 零 AI 调用（纯规则分析），定时器间隔可配置
 *
 * 生命周期：
 *   SignalCollector.create(opts) → instance.start() → ... → instance.stop()
 */

import fs from 'node:fs';
import path from 'node:path';
import { SkillAdvisor } from './SkillAdvisor.js';
import Logger from '../../infrastructure/logging/Logger.js';

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 分钟
const MIN_INTERVAL_MS = 60 * 1000;           // 最短 1 分钟（防误设）
const SNAPSHOT_FILE = 'signal-snapshot.json';

export class SignalCollector {
  #projectRoot;
  #db;
  #mode;          // 'off' | 'suggest' | 'auto'
  #intervalMs;
  #timer = null;
  #running = false;
  #logger;
  #snapshotPath;
  #snapshot;       // { lastRun, pushedNames, stats }
  #onSuggestions;  // callback(suggestions[]) — 由外部注入（如 RealtimeService 推送）
  #onAutoCreate;   // callback(suggestion) — auto 模式下自动创建 Skill 的回调

  /**
   * @param {object} opts
   * @param {string} opts.projectRoot — 用户项目根目录
   * @param {object} [opts.database]  — better-sqlite3 实例
   * @param {string} [opts.mode]      — 'off' | 'suggest' | 'auto'
   * @param {number} [opts.intervalMs] — 收集间隔（毫秒）
   * @param {function} [opts.onSuggestions] — 新建议回调 (suggestions[]) => void
   * @param {function} [opts.onAutoCreate]  — 自动创建回调 (suggestion) => Promise<void>
   */
  constructor({
    projectRoot,
    database = null,
    mode = 'suggest',
    intervalMs = DEFAULT_INTERVAL_MS,
    onSuggestions = null,
    onAutoCreate = null,
  }) {
    this.#projectRoot = projectRoot;
    this.#db = database;
    this.#mode = ['off', 'suggest', 'auto'].includes(mode) ? mode : 'suggest';
    this.#intervalMs = Math.max(intervalMs, MIN_INTERVAL_MS);
    this.#logger = Logger.getInstance();
    this.#onSuggestions = onSuggestions;
    this.#onAutoCreate = onAutoCreate;

    const dotDir = path.join(projectRoot, '.autosnippet');
    this.#snapshotPath = path.join(dotDir, SNAPSHOT_FILE);
    this.#snapshot = this.#loadSnapshot();
  }

  // ═══════════════════════════════════════════════════════
  //  公共 API
  // ═══════════════════════════════════════════════════════

  /**
   * 启动后台定时收集
   */
  start() {
    if (this.#mode === 'off') {
      this.#logger.info('[SignalCollector] mode=off, skipping start');
      return;
    }
    if (this.#timer) {
      this.#logger.warn('[SignalCollector] already running, ignoring start()');
      return;
    }

    this.#logger.info(`[SignalCollector] started — mode=${this.#mode}, interval=${this.#intervalMs}ms`);

    // 首次延迟 10 秒后执行（等启动流程稳定）
    setTimeout(() => {
      this.#tick();
      this.#timer = setInterval(() => this.#tick(), this.#intervalMs);
    }, 10_000);
  }

  /**
   * 停止后台收集
   */
  stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#running = false;
    this.#logger.info('[SignalCollector] stopped');
  }

  /**
   * 手动触发一次收集（用于测试 / Dashboard 按钮）
   * @returns {Promise<{suggestions: Array, stats: object}>}
   */
  async collect() {
    return this.#tick();
  }

  /**
   * 获取最近一次快照
   */
  getSnapshot() {
    return { ...this.#snapshot };
  }

  /**
   * 获取当前模式
   */
  getMode() {
    return this.#mode;
  }

  /**
   * 动态切换模式
   */
  setMode(mode) {
    if (!['off', 'suggest', 'auto'].includes(mode)) return;
    this.#mode = mode;
    this.#logger.info(`[SignalCollector] mode changed to ${mode}`);
    if (mode === 'off') this.stop();
  }

  // ═══════════════════════════════════════════════════════
  //  核心流程
  // ═══════════════════════════════════════════════════════

  async #tick() {
    if (this.#running) return null; // 防重入
    this.#running = true;

    try {
      // 1. 收集信号（通过 SkillAdvisor）
      const advisor = new SkillAdvisor(this.#projectRoot, { database: this.#db });
      const result = advisor.suggest();
      const { suggestions, analysisContext } = result;

      // 2. 过滤已推送过的
      const newSuggestions = suggestions.filter(
        s => !this.#snapshot.pushedNames.includes(s.name),
      );

      // 3. 更新快照
      this.#snapshot.lastRun = new Date().toISOString();
      this.#snapshot.totalRuns = (this.#snapshot.totalRuns || 0) + 1;
      this.#snapshot.lastResult = {
        totalSuggestions: suggestions.length,
        newSuggestions: newSuggestions.length,
        analysisContext,
      };

      if (newSuggestions.length > 0) {
        // 记录已推送名称
        for (const s of newSuggestions) {
          if (!this.#snapshot.pushedNames.includes(s.name)) {
            this.#snapshot.pushedNames.push(s.name);
          }
        }

        // 4a. 推送建议
        if (this.#onSuggestions) {
          try {
            this.#onSuggestions(newSuggestions);
          } catch (err) {
            this.#logger.warn(`[SignalCollector] onSuggestions callback error: ${err.message}`);
          }
        }

        // 4b. Auto-create 模式：对 high 优先级自动创建
        if (this.#mode === 'auto' && this.#onAutoCreate) {
          const highPriority = newSuggestions.filter(s => s.priority === 'high');
          for (const s of highPriority) {
            try {
              await this.#onAutoCreate(s);
              this.#logger.info(`[SignalCollector] auto-created skill: ${s.name}`);
              if (!this.#snapshot.autoCreated) this.#snapshot.autoCreated = [];
              this.#snapshot.autoCreated.push({ name: s.name, createdAt: new Date().toISOString() });
            } catch (err) {
              this.#logger.warn(`[SignalCollector] auto-create failed for ${s.name}: ${err.message}`);
            }
          }
        }

        this.#logger.info(`[SignalCollector] tick completed — ${newSuggestions.length} new suggestions`);
      } else {
        this.#logger.debug('[SignalCollector] tick completed — no new suggestions');
      }

      // 5. 持久化快照
      this.#saveSnapshot();

      return { suggestions: newSuggestions, stats: this.#snapshot.lastResult };
    } catch (err) {
      this.#logger.warn(`[SignalCollector] tick error: ${err.message}`);
      return { suggestions: [], stats: null };
    } finally {
      this.#running = false;
    }
  }

  // ═══════════════════════════════════════════════════════
  //  快照持久化
  // ═══════════════════════════════════════════════════════

  #loadSnapshot() {
    try {
      if (fs.existsSync(this.#snapshotPath)) {
        const raw = fs.readFileSync(this.#snapshotPath, 'utf-8');
        const data = JSON.parse(raw);
        return {
          lastRun: data.lastRun || null,
          totalRuns: data.totalRuns || 0,
          pushedNames: Array.isArray(data.pushedNames) ? data.pushedNames : [],
          lastResult: data.lastResult || null,
          autoCreated: Array.isArray(data.autoCreated) ? data.autoCreated : [],
        };
      }
    } catch { /* corrupt — reset */ }

    return {
      lastRun: null,
      totalRuns: 0,
      pushedNames: [],
      lastResult: null,
      autoCreated: [],
    };
  }

  #saveSnapshot() {
    try {
      const dir = path.dirname(this.#snapshotPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.#snapshotPath, JSON.stringify(this.#snapshot, null, 2), 'utf-8');
    } catch (err) {
      this.#logger.warn(`[SignalCollector] snapshot save failed: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════
  //  重置（测试 / CLI 使用）
  // ═══════════════════════════════════════════════════════

  /**
   * 清除已推送记录，下次 tick 会重新推荐
   */
  resetPushed() {
    this.#snapshot.pushedNames = [];
    this.#snapshot.autoCreated = [];
    this.#saveSnapshot();
    this.#logger.info('[SignalCollector] pushed history reset');
  }
}

export default SignalCollector;
