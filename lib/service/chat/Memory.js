/**
 * Memory — 跨对话轻量记忆
 *
 * 设计:
 * - JSONL 文件存储，每行一条记忆
 * - 支持 TTL 自动过期
 * - 上限 maxEntries，超出时截断旧条目
 * - 读写均做静默降级（Memory 是增强，不是核心路径）
 *
 * 记忆类型:
 * - preference: 用户偏好（"我们不用 singleton"、"以后用 DI"）
 * - decision:   关键决策（"Network 模块审核通过"）
 * - context:    项目上下文（"主语言是 Swift，使用 SPM"）
 *
 * 文件路径: .autosnippet/memory.jsonl
 */

import fs from 'node:fs';
import path from 'node:path';

export class Memory {
  #filePath;
  #maxEntries;

  /**
   * @param {string} projectRoot — 用户项目根目录
   * @param {object} [opts]
   * @param {number} [opts.maxEntries=50] — 最大记忆条数
   */
  constructor(projectRoot, { maxEntries = 50 } = {}) {
    this.#filePath = path.join(projectRoot, '.autosnippet', 'memory.jsonl');
    this.#maxEntries = maxEntries;
  }

  /**
   * 读取最近 N 条记忆，过滤过期项
   * @param {number} [limit=20]
   * @returns {{ ts: string, type: string, content: string, ttl?: number }[]}
   */
  load(limit = 20) {
    try {
      if (!fs.existsSync(this.#filePath)) return [];
      const raw = fs.readFileSync(this.#filePath, 'utf-8').trim();
      if (!raw) return [];
      const lines = raw.split('\n').filter(Boolean);
      const now = Date.now();
      return lines
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean)
        .filter(m => !m.ttl || (now - new Date(m.ts).getTime()) < m.ttl * 86400000)
        .slice(-limit);
    } catch {
      return [];
    }
  }

  /**
   * 追加一条记忆
   * @param {{ type: string, content: string, ttl?: number }} entry
   */
  append(entry) {
    try {
      const dir = path.dirname(this.#filePath);
      fs.mkdirSync(dir, { recursive: true });
      const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
      fs.appendFileSync(this.#filePath, line + '\n', 'utf-8');
      this.#compact();
    } catch { /* write failure non-critical */ }
  }

  /**
   * 生成供系统提示词的记忆摘要
   * @returns {string}
   */
  toPromptSection() {
    const memories = this.load();
    if (memories.length === 0) return '';
    const lines = memories.map(m => `- [${m.type}] ${m.content}`).join('\n');
    return `\n## 历史记忆\n以下是之前对话中积累的项目偏好和决策，请参考：\n${lines}\n`;
  }

  /**
   * 当前记忆条数
   */
  get size() {
    return this.load(this.#maxEntries).length;
  }

  /**
   * 超过 maxEntries 时截断旧条目
   */
  #compact() {
    try {
      const raw = fs.readFileSync(this.#filePath, 'utf-8').trim();
      if (!raw) return;
      const lines = raw.split('\n').filter(Boolean);
      if (lines.length > this.#maxEntries) {
        fs.writeFileSync(this.#filePath, lines.slice(-this.#maxEntries).join('\n') + '\n', 'utf-8');
      }
    } catch { /* ignore */ }
  }
}

export default Memory;
