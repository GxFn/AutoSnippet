/**
 * RecipeFileWriter — 将 Recipe 领域对象序列化为标准 .md 文件
 *
 * 职责：
 *  - Recipe domain object → YAML frontmatter + Markdown body
 *  - 落盘到 AutoSnippet/recipes/{category}/ 目录
 *  - .md 文件 = 完整唯一数据源（Source of Truth），DB = 索引缓存
 *
 * Frontmatter 分层：
 *  - 基础字段（人类可读/可编辑）：id, title, trigger, category, language, summary_cn, ...
 *  - 机器管理字段（_ 前缀）：_quality, _statistics, _relations, _constraints, _contentHash
 *    — 由系统自动维护，手动修改会被 `asd sync` 检测并记录违规
 *
 * 文件名策略：trigger > title slug
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { RECIPES_DIR } from '../../infrastructure/config/Defaults.js';
import Logger from '../../infrastructure/logging/Logger.js';

export class RecipeFileWriter {
  /**
   * @param {string} projectRoot 项目根目录
   */
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.recipesDir = path.join(projectRoot, RECIPES_DIR);
    this.logger = Logger.getInstance();
  }

  /* ═══ 序列化 ═══════════════════════════════════════════ */

  /**
   * 将 Recipe 领域对象序列化为完整 .md（YAML frontmatter + body）
   * 包含所有运行时数据，确保 .md 是完整 Source of Truth
   * @param {import('../../domain/recipe/Recipe.js').Recipe} recipe
   * @returns {string}
   */
  serializeToMarkdown(recipe) {
    const lines = ['---'];

    // ── 基础字段（人类可读）──
    lines.push(`id: ${recipe.id}`);
    lines.push(`title: ${this.#yamlStr(recipe.title)}`);
    if (recipe.trigger)    lines.push(`trigger: ${recipe.trigger}`);
    lines.push(`category: ${recipe.category || 'general'}`);
    lines.push(`language: ${recipe.language || 'swift'}`);
    if (recipe.summaryCn)  lines.push(`summary_cn: ${this.#yamlStr(recipe.summaryCn)}`);
    if (recipe.summaryEn)  lines.push(`summary_en: ${this.#yamlStr(recipe.summaryEn)}`);

    // ── headers ──
    const headers = recipe.dimensions?.headers || recipe.content?.headers || [];
    if (Array.isArray(headers) && headers.length > 0) {
      lines.push(`headers: [${headers.map(h => `"${this.#esc(h)}"`).join(', ')}]`);
    }

    // ── 分类 & 元数据 ──
    if (recipe.knowledgeType) lines.push(`knowledgeType: ${recipe.knowledgeType}`);
    if (recipe.kind)          lines.push(`kind: ${recipe.kind}`);
    if (recipe.complexity)    lines.push(`complexity: ${recipe.complexity}`);
    if (recipe.scope)         lines.push(`scope: ${recipe.scope}`);

    // ── 标签 ──
    if (recipe.tags?.length > 0) {
      lines.push(`tags: [${recipe.tags.map(t => `"${this.#esc(t)}"`).join(', ')}]`);
    }

    // ── 扩展维度 ──
    const dims = recipe.dimensions || {};
    if (dims.authority != null)  lines.push(`authority: ${dims.authority}`);
    if (dims.difficulty)         lines.push(`difficulty: ${dims.difficulty}`);
    if (dims.version)            lines.push(`version: "${dims.version}"`);

    // ── 状态 & 时间 ──
    lines.push(`status: ${recipe.status || 'active'}`);
    lines.push(`createdBy: ${recipe.createdBy || 'system'}`);
    lines.push(`createdAt: ${recipe.createdAt || Math.floor(Date.now() / 1000)}`);
    lines.push(`updatedAt: ${recipe.updatedAt || Math.floor(Date.now() / 1000)}`);
    if (recipe.publishedBy) lines.push(`publishedBy: ${recipe.publishedBy}`);
    if (recipe.publishedAt) lines.push(`publishedAt: ${recipe.publishedAt}`);
    if (recipe.sourceCandidate) lines.push(`sourceCandidate: ${recipe.sourceCandidate}`);

    // ── 废弃信息 ──
    if (recipe.deprecation) {
      lines.push(`deprecated: true`);
      if (recipe.deprecation.reason)       lines.push(`deprecationReason: ${this.#yamlStr(recipe.deprecation.reason)}`);
      if (recipe.deprecation.deprecatedAt) lines.push(`deprecatedAt: ${recipe.deprecation.deprecatedAt}`);
    }

    // ── 人类可读关系（简化版，触发器列表）──
    const relatedTriggers = this.#extractRelatedTriggers(recipe.relations);
    if (relatedTriggers.length > 0) {
      lines.push(`relatedRecipes: [${relatedTriggers.map(t => `"${t}"`).join(', ')}]`);
    }

    // ── 机器管理字段（_ 前缀，单行 JSON）──
    const quality = recipe.quality || {};
    if (this.#hasValues(quality)) {
      lines.push(`_quality: ${JSON.stringify(quality)}`);
    }

    const stats = recipe.statistics || {};
    if (this.#hasValues(stats)) {
      lines.push(`_statistics: ${JSON.stringify(stats)}`);
    }

    const relations = recipe.relations || {};
    if (this.#hasNonEmptyArrays(relations)) {
      lines.push(`_relations: ${JSON.stringify(relations)}`);
    }

    const constraints = recipe.constraints || {};
    if (this.#hasNonEmptyArrays(constraints)) {
      lines.push(`_constraints: ${JSON.stringify(constraints)}`);
    }

    // _contentHash 占位索引（后续替换为真实 hash）
    const hashIdx = lines.length;
    lines.push('');  // 占位行

    lines.push('---');
    lines.push('');

    // ── Body ──
    if (recipe.content?.markdown) {
      const body = recipe.content.markdown.replace(/^---[\s\S]*?---\s*/, '').trim();
      lines.push(body);
    } else {
      lines.push(this.#buildBodyFromStructured(recipe));
    }

    lines.push('');

    // ── 计算 content hash ──
    // 去掉占位行后计算，确保与 SyncService 读取时 computeContentHash 的输入一致
    const linesForHash = [...lines];
    linesForHash.splice(hashIdx, 1);
    const hash = computeContentHash(linesForHash.join('\n'));
    lines[hashIdx] = `_contentHash: ${hash}`;
    return lines.join('\n');
  }

  /* ═══ 文件操作 ═══════════════════════════════════════════ */

  /**
   * 将 Recipe 落盘到 AutoSnippet/recipes/{category}/ 目录
   * @param {import('../../domain/recipe/Recipe.js').Recipe} recipe
   * @returns {string|null} 写入的文件路径，失败返回 null
   */
  persistRecipe(recipe) {
    try {
      if (!recipe?.id || !recipe?.title) {
        this.logger.warn('Cannot persist recipe: missing id or title');
        return null;
      }

      const filename = this.#getFilename(recipe);
      const category = (recipe.category || 'general').toLowerCase();
      const categoryDir = path.join(this.recipesDir, category);

      if (!fs.existsSync(categoryDir)) {
        fs.mkdirSync(categoryDir, { recursive: true });
      }

      // 检查是否有旧文件需要清理（trigger 或 category 可能变了）
      this.#cleanupOldFile(recipe, path.join(categoryDir, filename));

      const filePath = path.join(categoryDir, filename);
      const markdown = this.serializeToMarkdown(recipe);
      fs.writeFileSync(filePath, markdown, 'utf8');

      // 更新 recipe 的 sourceFile 溯源
      recipe.sourceFile = path.relative(this.projectRoot, filePath);

      this.logger.info('Recipe persisted to file', {
        recipeId: recipe.id,
        path: recipe.sourceFile,
      });

      return filePath;
    } catch (error) {
      this.logger.error('Failed to persist recipe to file', {
        recipeId: recipe.id,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * 删除 Recipe 对应的 .md 文件
   * @param {import('../../domain/recipe/Recipe.js').Recipe} recipe
   * @returns {boolean}
   */
  removeRecipe(recipe) {
    const filename = this.#getFilename(recipe);
    const searchPaths = this.#buildSearchPaths(recipe, filename);

    for (const fp of searchPaths) {
      if (fs.existsSync(fp)) {
        fs.unlinkSync(fp);
        this.logger.info('Recipe file removed', {
          recipeId: recipe.id,
          path: path.relative(this.projectRoot, fp),
        });
        return true;
      }
    }

    return this.#removeByIdScan(recipe.id);
  }

  /* ═══ 内部工具 ═══════════════════════════════════════════ */

  #getFilename(recipe) {
    if (recipe.trigger) {
      const clean = recipe.trigger
        .replace(/^@/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 60);
      return `${clean}.md`;
    }
    const slug = (recipe.title || 'untitled')
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60);
    return `${slug}.md`;
  }

  #buildSearchPaths(recipe, filename) {
    const category = (recipe.category || 'general').toLowerCase();
    return [
      path.join(this.recipesDir, category, filename),
      path.join(this.recipesDir, filename),
      recipe.sourceFile ? path.join(this.projectRoot, recipe.sourceFile) : null,
    ].filter(Boolean);
  }

  #cleanupOldFile(recipe, newPath) {
    if (!recipe.sourceFile) return;
    const oldPath = path.join(this.projectRoot, recipe.sourceFile);
    if (oldPath !== newPath && fs.existsSync(oldPath)) {
      fs.unlinkSync(oldPath);
      this.logger.info('Cleaned up old recipe file', {
        recipeId: recipe.id,
        oldPath: recipe.sourceFile,
      });
    }
  }

  #removeByIdScan(recipeId) {
    if (!fs.existsSync(this.recipesDir)) return false;
    try {
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (walk(full)) return true;
          } else if (entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
            const content = fs.readFileSync(full, 'utf8');
            if (content.includes(`id: ${recipeId}`)) {
              fs.unlinkSync(full);
              this.logger.info('Recipe file removed by id scan', { recipeId, path: full });
              return true;
            }
          }
        }
        return false;
      };
      return walk(this.recipesDir);
    } catch {
      return false;
    }
  }

  #buildBodyFromStructured(recipe) {
    const parts = [];

    parts.push('## Snippet / Code Reference\n');
    if (recipe.content?.pattern) {
      const lang = recipe.language || 'swift';
      parts.push(`\`\`\`${lang}`);
      parts.push(recipe.content.pattern);
      parts.push('```\n');
    } else {
      parts.push('```swift\n// TODO: 添加代码\n```\n');
    }

    parts.push('## AI Context / Usage Guide\n');

    if (recipe.usageGuideCn) { parts.push(recipe.usageGuideCn); parts.push(''); }
    if (recipe.usageGuideEn) { parts.push(recipe.usageGuideEn); parts.push(''); }
    if (recipe.content?.rationale) {
      parts.push('### 设计原理\n');
      parts.push(recipe.content.rationale);
      parts.push('');
    }
    if (recipe.content?.steps?.length > 0) {
      parts.push('### 使用步骤\n');
      recipe.content.steps.forEach((step, i) => { parts.push(`${i + 1}. ${step}`); });
      parts.push('');
    }
    if (recipe.constraints?.boundaries?.length > 0) {
      parts.push('### 约束与边界\n');
      for (const b of recipe.constraints.boundaries) { parts.push(`- ${b}`); }
      parts.push('');
    }

    return parts.join('\n');
  }

  #extractRelatedTriggers(relations) {
    if (!relations) return [];
    const triggers = [];
    for (const rel of ['related', 'dependsOn', 'extends', 'conflicts']) {
      const items = relations[rel] || [];
      for (const item of items) {
        if (typeof item === 'string') triggers.push(item);
        else if (item?.target) triggers.push(item.target);
      }
    }
    return [...new Set(triggers)];
  }

  #hasValues(obj) {
    return Object.values(obj).some(v => v != null && v !== 0 && v !== '');
  }

  #hasNonEmptyArrays(obj) {
    return Object.values(obj).some(v => Array.isArray(v) ? v.length > 0 : false);
  }

  #yamlStr(str) {
    if (!str) return '""';
    if (/[:#\[\]{}&*!|>'"`,@]/.test(str) || str.includes('\n')) {
      return `"${this.#esc(str)}"`;
    }
    return str;
  }

  #esc(str) {
    return (str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }
}

/* ═══ 公共工具函数（SyncService 等共用）═══════════════════ */

/**
 * 计算 .md 内容的 SHA-256 hash（去除 _contentHash 行后）
 * @param {string} content
 * @returns {string} 16 字符 hex
 */
export function computeContentHash(content) {
  // 删除整行（含尾部换行），确保 write/read 两条路径 hash 输入一致
  const cleaned = content.replace(/^_contentHash:.*\n?/m, '').trim();
  return createHash('sha256').update(cleaned, 'utf8').digest('hex').slice(0, 16);
}

/**
 * 从 .md 内容完整解析 Recipe 数据（基础字段 + 机器字段）
 * 供 SyncService / SetupService 共用
 * @param {string} content  .md 文件全文
 * @param {string} relPath  相对于 recipes/ 的路径
 * @returns {object}
 */
export function parseRecipeMarkdown(content, relPath) {
  const fmMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};

  if (fmMatch) {
    const lines = fmMatch[1].split('\n');
    let currentKey = null;
    let multilineValue = null;
    let multilineIndent = 0;

    const flushMultiline = () => {
      if (currentKey && multilineValue !== null) {
        fm[currentKey] = multilineValue.join('\n').trimEnd();
        currentKey = null;
        multilineValue = null;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 多行值收集中 — 检查缩进
      if (multilineValue !== null) {
        if (line.length === 0 || /^\s/.test(line)) {
          // 仍在多行块内（缩进行或空行）
          const stripped = multilineIndent > 0 ? line.slice(multilineIndent) : line;
          multilineValue.push(stripped);
          continue;
        } else {
          // 新的顶级 key — 结束多行
          flushMultiline();
        }
      }

      const colonIdx = line.indexOf(':');
      if (colonIdx <= 0) continue;
      const key = line.slice(0, colonIdx).trim();
      if (/\s/.test(key)) continue; // 跳过带空格的非正常 key
      let value = line.slice(colonIdx + 1).trim();

      // YAML 多行块标量: key: | 或 key: >
      if (value === '|' || value === '>') {
        currentKey = key;
        multilineValue = [];
        // 自动检测下一行缩进
        if (i + 1 < lines.length) {
          const indentMatch = lines[i + 1].match(/^(\s+)/);
          multilineIndent = indentMatch ? indentMatch[1].length : 2;
        }
        continue;
      }

      // 单行 JSON（_ 前缀机器字段）
      if (key.startsWith('_') && value.startsWith('{')) {
        try { fm[key] = JSON.parse(value); continue; } catch { /* fall through */ }
      }

      // 数组
      if (value.startsWith('[') && value.endsWith(']')) {
        value = value.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
        fm[key] = value;
        continue;
      }

      // 布尔/数字
      if (value === 'true')  { fm[key] = true; continue; }
      if (value === 'false') { fm[key] = false; continue; }
      if (/^\d+$/.test(value)) { fm[key] = parseInt(value, 10); continue; }
      if (/^\d+\.\d+$/.test(value)) { fm[key] = parseFloat(value); continue; }

      // 字符串（去引号）
      fm[key] = value.replace(/^['"]|['"]$/g, '');
    }

    // 冲刷最后一个多行值
    flushMultiline();
  }

  // fallback 逻辑
  const basename = relPath.includes('/') ? relPath.split('/').pop() : relPath;
  const titleMatch = content.match(/^#\s+(.+)$/m);

  return {
    // ── 基础 ──
    id:             fm.id || basename.replace(/\.md$/i, ''),
    title:          fm.title || (titleMatch ? titleMatch[1].trim() : basename.replace(/\.md$/i, '')),
    trigger:        fm.trigger || '',
    category:       fm.category || 'general',
    language:       fm.language || 'swift',
    summaryCn:      fm.summary_cn || '',
    summaryEn:      fm.summary_en || '',
    knowledgeType:  fm.knowledgeType || fm.knowledge_type || 'code-pattern',
    kind:           fm.kind || '',
    complexity:     fm.complexity || 'intermediate',
    scope:          fm.scope || null,
    tags:           Array.isArray(fm.tags) ? fm.tags : [],
    headers:        Array.isArray(fm.headers) ? fm.headers : [],
    status:         fm.status || 'active',

    // ── 时间 & 作者 ──
    createdBy:       fm.createdBy || fm.author || 'system',
    createdAt:       fm.createdAt || Math.floor(Date.now() / 1000),
    updatedAt:       fm.updatedAt || Math.floor(Date.now() / 1000),
    publishedBy:     fm.publishedBy || null,
    publishedAt:     fm.publishedAt || null,
    sourceCandidate: fm.sourceCandidate || null,

    // ── 废弃 ──
    deprecated:        fm.deprecated || false,
    deprecationReason: fm.deprecationReason || null,
    deprecatedAt:      fm.deprecatedAt || null,

    // ── 维度 ──
    authority:  fm.authority ?? null,
    difficulty: fm.difficulty || null,
    version:    fm.version || null,

    // ── 机器管理（完整结构）──
    quality:     fm._quality    || { codeCompleteness: 0, projectAdaptation: 0, documentationClarity: 0, overall: 0 },
    statistics:  fm._statistics || { adoptionCount: 0, applicationCount: 0, guardHitCount: 0, viewCount: 0, successCount: 0, feedbackScore: 0 },
    relations:   fm._relations  || {},
    constraints: fm._constraints || {},

    // ── 完整性 ──
    _contentHash: fm._contentHash || null,
    relatedRecipes: Array.isArray(fm.relatedRecipes) ? fm.relatedRecipes : [],

    // ── 原始 markdown（body 部分 + 完整内容）──
    markdown: content,
    sourceFile: relPath,
  };
}
