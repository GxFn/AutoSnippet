/**
 * CandidateFileWriter — 将 Candidate 领域对象序列化为标准 .md 文件
 *
 * 职责：
 *  - Candidate domain → YAML frontmatter + Markdown body
 *  - 落盘到 AutoSnippet/candidates/{category}/ 目录
 *  - .md 文件可 Git 合并，使团队共享 Candidate 数据
 *
 * Frontmatter 分层：
 *  - 基础字段（人类可读）：id, status, language, category, source, createdBy, ...
 *  - 审核字段：approvedBy, rejectedBy, rejectionReason, appliedRecipeId
 *  - 机器字段（_ 前缀）：_reasoning, _metadata, _statusHistory, _contentHash
 *
 * 文件名策略：metadata.title slug > id 前 8 位
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CANDIDATES_DIR } from '../../infrastructure/config/Defaults.js';
import Logger from '../../infrastructure/logging/Logger.js';

export { CANDIDATES_DIR };

export class CandidateFileWriter {
  /**
   * @param {string} projectRoot 项目根目录
   */
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.candidatesDir = path.join(projectRoot, CANDIDATES_DIR);
    this.logger = Logger.getInstance();
  }

  /* ═══ 序列化 ═══════════════════════════════════════════ */

  /**
   * 将 Candidate 领域对象序列化为完整 .md（YAML frontmatter + body）
   * @param {object} candidate
   * @returns {string}
   */
  serializeToMarkdown(candidate) {
    const lines = ['---'];

    // ── 基础字段（人类可读）──
    lines.push(`id: ${candidate.id}`);
    lines.push(`status: ${candidate.status || 'pending'}`);
    lines.push(`language: ${candidate.language || 'swift'}`);
    lines.push(`category: ${candidate.category || 'general'}`);
    lines.push(`source: ${candidate.source || 'manual'}`);

    // ── 审核信息 ──
    if (candidate.approvedBy) lines.push(`approvedBy: ${candidate.approvedBy}`);
    if (candidate.approvedAt) lines.push(`approvedAt: ${candidate.approvedAt}`);
    if (candidate.rejectedBy) lines.push(`rejectedBy: ${candidate.rejectedBy}`);
    if (candidate.rejectionReason) lines.push(`rejectionReason: ${this.#yamlStr(candidate.rejectionReason)}`);
    if (candidate.appliedRecipeId) lines.push(`appliedRecipeId: ${candidate.appliedRecipeId}`);

    // ── 时间 ──
    lines.push(`createdBy: ${candidate.createdBy || 'system'}`);
    lines.push(`createdAt: ${candidate.createdAt || Math.floor(Date.now() / 1000)}`);
    lines.push(`updatedAt: ${candidate.updatedAt || Math.floor(Date.now() / 1000)}`);

    // ── 机器管理字段（_ 前缀，单行 JSON）──
    const reasoning = candidate.reasoning || candidate.reasoning_json;
    if (reasoning) {
      const r = typeof reasoning === 'string' ? reasoning : JSON.stringify(reasoning);
      lines.push(`_reasoning: ${r}`);
    }

    const metadata = candidate.metadata || {};
    if (Object.keys(metadata).length > 0) {
      lines.push(`_metadata: ${JSON.stringify(metadata)}`);
    }

    const history = candidate.statusHistory || candidate.status_history_json;
    if (history) {
      const h = typeof history === 'string' ? history : JSON.stringify(history);
      if (h !== '[]') lines.push(`_statusHistory: ${h}`);
    }

    // _contentHash 占位索引（后续替换为真实 hash）
    const hashIdx = lines.length;
    lines.push('');  // 占位行

    lines.push('---');
    lines.push('');

    // ── Title ──
    const title = metadata.title || metadata.description || `Candidate ${candidate.id.slice(0, 8)}`;
    lines.push(`## ${title}`);
    lines.push('');

    // ── Code Block ──
    if (candidate.code) {
      lines.push(`\`\`\`${candidate.language || 'swift'}`);
      lines.push(candidate.code);
      lines.push('```');
      lines.push('');
    }

    // ── Reasoning ──
    if (reasoning) {
      const r = typeof reasoning === 'string' ? JSON.parse(reasoning) : reasoning;
      if (r.whyStandard) {
        lines.push('## Why Standard');
        lines.push('');
        lines.push(r.whyStandard);
        lines.push('');
      }
      if (r.sources?.length > 0) {
        lines.push('## Sources');
        lines.push('');
        for (const src of r.sources) {
          lines.push(`- ${src}`);
        }
        lines.push('');
      }
    }

    // ── 计算 content hash ──
    const linesForHash = [...lines];
    linesForHash.splice(hashIdx, 1);
    const hash = computeCandidateHash(linesForHash.join('\n'));
    lines[hashIdx] = `_contentHash: ${hash}`;
    return lines.join('\n');
  }

  /* ═══ 文件操作 ═══════════════════════════════════════════ */

  /**
   * 将 Candidate 落盘到 AutoSnippet/candidates/{category}/ 目录
   * @param {object} candidate
   * @returns {string|null} 写入的文件路径，失败返回 null
   */
  persistCandidate(candidate) {
    try {
      if (!candidate?.id) {
        this.logger.warn('Cannot persist candidate: missing id');
        return null;
      }

      const filename = this.#getFilename(candidate);
      const category = (candidate.category || 'general').toLowerCase();
      const categoryDir = path.join(this.candidatesDir, category);

      if (!fs.existsSync(categoryDir)) {
        fs.mkdirSync(categoryDir, { recursive: true });
      }

      // 检查是否需要清理旧文件（category 变更场景）
      this.#cleanupOldFile(candidate, path.join(categoryDir, filename));

      const filePath = path.join(categoryDir, filename);
      const markdown = this.serializeToMarkdown(candidate);
      fs.writeFileSync(filePath, markdown, 'utf8');

      this.logger.info('Candidate persisted to file', {
        candidateId: candidate.id,
        path: path.relative(this.projectRoot, filePath),
      });

      return filePath;
    } catch (error) {
      this.logger.warn('Failed to persist candidate to file', {
        candidateId: candidate?.id,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * 删除 Candidate 对应的 .md 文件
   * @param {object} candidate
   * @returns {boolean}
   */
  removeCandidate(candidate) {
    try {
      if (!candidate?.id) return false;

      const filename = this.#getFilename(candidate);
      const category = (candidate.category || 'general').toLowerCase();
      const filePath = path.join(this.candidatesDir, category, filename);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        this.logger.info('Candidate file removed', {
          candidateId: candidate.id,
          path: path.relative(this.projectRoot, filePath),
        });
        return true;
      }

      // fallback: scan by id
      return this.#removeById(candidate.id);
    } catch (error) {
      this.logger.warn('Failed to remove candidate file', {
        candidateId: candidate?.id,
        error: error.message,
      });
      return false;
    }
  }

  /* ═══ Private helpers ═══════════════════════════════════ */

  #getFilename(candidate) {
    const meta = candidate.metadata || {};
    const title = meta.title || meta.description || '';
    if (title) {
      const slug = title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')   // 保留 Unicode 字母(含CJK)、数字、空格、连字符
        .replace(/\s+/g, '-')
        .replace(/-{2,}/g, '-')                  // 合并连续连字符
        .replace(/^-|-$/g, '')                    // 去除首尾连字符
        .slice(0, 60);
      if (slug.length >= 3) return `${slug}.md`;
    }
    return `${candidate.id.slice(0, 8)}.md`;
  }

  #cleanupOldFile(candidate, newPath) {
    // scan all category dirs for a file with matching id in frontmatter
    if (!fs.existsSync(this.candidatesDir)) return;
    try {
      const categories = fs.readdirSync(this.candidatesDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      for (const cat of categories) {
        const catDir = path.join(this.candidatesDir, cat);
        const files = fs.readdirSync(catDir).filter(f => f.endsWith('.md'));
        for (const file of files) {
          const fp = path.join(catDir, file);
          if (fp === newPath) continue;
          const head = fs.readFileSync(fp, 'utf8').slice(0, 500);
          if (head.includes(`id: ${candidate.id}`)) {
            fs.unlinkSync(fp);
            this.logger.info('Cleaned up old candidate file', { old: fp });
          }
        }
      }
    } catch { /* ignore scan errors */ }
  }

  #removeById(id) {
    if (!fs.existsSync(this.candidatesDir)) return false;
    try {
      const categories = fs.readdirSync(this.candidatesDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      for (const cat of categories) {
        const catDir = path.join(this.candidatesDir, cat);
        const files = fs.readdirSync(catDir).filter(f => f.endsWith('.md'));
        for (const file of files) {
          const fp = path.join(catDir, file);
          const head = fs.readFileSync(fp, 'utf8').slice(0, 500);
          if (head.includes(`id: ${id}`)) {
            fs.unlinkSync(fp);
            return true;
          }
        }
      }
    } catch { /* ignore */ }
    return false;
  }

  #yamlStr(str) {
    if (!str) return '""';
    if (/[:"'{}\[\]#&*!|>%@`]/.test(str) || str.trim() !== str) {
      return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return str;
  }
}

/* ═══ Standalone hash utility ═════════════════════════════ */

/**
 * 计算 Candidate .md 内容的 SHA-256 hash（去除 _contentHash 行后）
 * @param {string} content
 * @returns {string} 16 字符 hex
 */
export function computeCandidateHash(content) {
  const cleaned = content.replace(/^_contentHash:.*\n?/m, '').trim();
  return createHash('sha256').update(cleaned, 'utf8').digest('hex').slice(0, 16);
}

/**
 * 从 Candidate .md 内容解析 frontmatter
 * @param {string} content  .md 文件全文
 * @param {string} relPath  相对路径（用于日志）
 * @returns {object} 解析后的 candidate 数据
 */
export function parseCandidateMarkdown(content, relPath) {
  const fmMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const data = {};

  if (fmMatch) {
    for (const line of fmMatch[1].split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx <= 0) continue;
      const key = line.slice(0, colonIdx).trim();
      let value = line.slice(colonIdx + 1).trim();

      // 单行 JSON（_ 前缀机器字段）
      if (key.startsWith('_') && (value.startsWith('{') || value.startsWith('['))) {
        try { value = JSON.parse(value); } catch { /* keep as string */ }
      }
      // 数值
      else if (/^\d+$/.test(value)) {
        value = parseInt(value, 10);
      }
      // 去引号
      else if (/^".*"$/.test(value)) {
        value = value.slice(1, -1);
      }

      data[key] = value;
    }
  }

  // 提取 body 中的 code block
  const bodyMatch = content.match(/^---[\s\S]*?---\s*\r?\n([\s\S]*)$/);
  if (bodyMatch) {
    const body = bodyMatch[1];
    const codeMatch = body.match(/```\w*\n([\s\S]*?)```/);
    if (codeMatch) {
      data._bodyCode = codeMatch[1].trimEnd();
    }
  }

  data._sourceFile = relPath;
  return data;
}

export default CandidateFileWriter;
