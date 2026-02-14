/**
 * 渲染 & 候选构建工具
 *
 * 将扫描结果转换为 Markdown 文档的公共渲染层：
 *   - buildVariantBody(): 三层结构（写法概述→基本使用→项目示例）
 *   - trimExampleToEssence(): 智能裁剪代码示例
 *
 * @module shared/rendering
 */

import { BASIC_USAGE } from '../canonical-examples.js';

// ═══════════════════════════════════════════════════════════
//  三层结构渲染 (原 extractors-micro._buildVariantBody)
// ═══════════════════════════════════════════════════════════

/**
 * 将变体扫描结果转为 Candidate body（Markdown）
 *
 * v6 三层结构：
 *   1. 写法概述 — 描述此变体及使用频次
 *   2. 基本使用 — 纯粹的、最精简的该写法模板（从 BASIC_USAGE 查找）
 *   3. 项目示例 — 精简后的真实项目代码（只保留与写法相关的行）
 *
 * @param {object} scanResult — scanVariants() 返回值
 * @param {string} lang
 * @param {object} [opts]
 * @param {string} [opts.patternKey] — patterns 的 key (如 'singleton', 'notification')
 * @param {string} [opts.projectPrefix] — 项目前缀 (如 'XX'), 用于替换模板中的 {PREFIX}
 * @returns {string[]}
 */
export function buildVariantBody(scanResult, lang, opts = {}) {
  const { patternKey, projectPrefix } = opts;
  const { totalFiles, variants, otherVariant } = scanResult;
  if (variants.length === 0 && !otherVariant) return [];

  const displayCount = variants.length + (otherVariant && otherVariant.fileCount > 0 ? 1 : 0);
  const bodyLines = [
    `> 项目中共 **${totalFiles}** 个文件使用此功能，检测到 **${displayCount}** 种写法`,
    '',
  ];

  let idx = 0;
  for (const v of variants) {
    idx++;
    const pct = totalFiles > 0 ? Math.round((v.fileCount / totalFiles) * 100) : 0;
    const primary = idx === 1 ? ' ⭐ 项目主流' : '';
    bodyLines.push(`### 写法 ${idx}: ${v.label}（${v.fileCount} 个文件，${pct}%）${primary}`, '');

    // ── 层 A: 基本使用（纯写法模板）──
    if (patternKey) {
      const usageKey = `${lang}:${patternKey}:${v.key}`;
      const basic = BASIC_USAGE[usageKey];
      if (basic) {
        bodyLines.push('#### 基本使用', '');
        bodyLines.push('```' + lang);
        for (const line of basic.code) {
          bodyLines.push(projectPrefix ? line.replace(/\{PREFIX\}/g, projectPrefix) : line.replace(/\{PREFIX\}/g, ''));
        }
        bodyLines.push('```', '');
      }
    }

    // ── 层 B: 项目示例（精简后的真实代码）──
    if (v.examples.length > 0) {
      bodyLines.push('#### 项目示例', '');
      for (const ex of v.examples) {
        // 精简：去除与写法无关的行
        const trimmed = trimExampleToEssence(ex.block, v.key, scanResult._variantDefs, lang);
        bodyLines.push('```' + lang);
        bodyLines.push(`// ── ${ex.file}:L${ex.lineNum} ──`);
        for (const line of trimmed) bodyLines.push(line);
        bodyLines.push('```', '');
      }
    }
  }

  // "其他写法" 不展示代码示例 — 只添加汇总说明
  if (otherVariant && otherVariant.fileCount > 0) {
    const otherPct = totalFiles > 0 ? Math.round((otherVariant.fileCount / totalFiles) * 100) : 0;
    bodyLines.push(`> 另有 **${otherVariant.fileCount}** 个文件（${otherPct}%）使用其他写法，未归入以上分类`, '');
  }

  return bodyLines;
}

// ═══════════════════════════════════════════════════════════
//  智能裁剪 (原 extractors-micro._trimExampleToEssence)
// ═══════════════════════════════════════════════════════════

/**
 * 精简项目代码示例 — 只保留与写法相关的核心行 + 少量上下文
 *
 * 策略：
 *   1. 找到 block 中所有与 variant regex 匹配的行
 *   2. 保留这些行 ± CONTEXT_LINES 行的上下文
 *   3. 不相关的部分用 "// ..." 省略
 *   4. 始终保留函数/方法签名行（第一行）和闭合行（最后行）
 *
 * @param {string[]} block — 原始代码块
 * @param {string} variantKey — 写法变体 key
 * @param {object} variantDefs — 写法变体定义
 * @param {string} lang
 * @returns {string[]}
 */
export function trimExampleToEssence(block, variantKey, variantDefs, lang) {
  // 短代码块不裁剪（ <= 20 行直接原样返回）
  if (!block || block.length <= 20) return block;

  const def = variantDefs?.[variantKey];
  if (!def?.regex) return block;

  const CONTEXT_LINES = 3;
  const keepSet = new Set();

  // 始终保留第一行（函数/方法签名）和第二行
  keepSet.add(0);
  if (block.length > 1) keepSet.add(1);

  // 标记匹配行 ± CONTEXT_LINES
  for (let i = 0; i < block.length; i++) {
    if (def.regex.test(block[i])) {
      for (let j = Math.max(0, i - CONTEXT_LINES); j <= Math.min(block.length - 1, i + CONTEXT_LINES); j++) {
        keepSet.add(j);
      }
    }
  }

  // 始终保留最后 2 行（闭合行 + 上一行）
  const lastLine = block.length - 1;
  keepSet.add(lastLine);
  if (lastLine > 0) keepSet.add(lastLine - 1);

  // 如果保留行数和原始差不多（>60%），返回原始
  if (keepSet.size > block.length * 0.6) return block;

  // 构建精简结果 — 只在省略 >= 3 行时插入省略标记，避免碎片化
  const result = [];
  let gapStart = -1;
  for (let i = 0; i < block.length; i++) {
    if (keepSet.has(i)) {
      if (gapStart >= 0) {
        const gapSize = i - gapStart;
        if (gapSize <= 2) {
          // 小间隙直接保留原始行（避免 // ... 散落）
          for (let g = gapStart; g < i; g++) result.push(block[g]);
        } else {
          result.push('    // ...');
        }
        gapStart = -1;
      }
      result.push(block[i]);
    } else if (gapStart < 0) {
      gapStart = i;
    }
  }
  // 尾部间隙
  if (gapStart >= 0) {
    const gapSize = block.length - gapStart;
    if (gapSize <= 2) {
      for (let g = gapStart; g < block.length; g++) result.push(block[g]);
    } else {
      result.push('    // ...');
    }
  }
  return result;
}
