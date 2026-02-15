/**
 * 渲染 & 候选构建工具
 *
 * 将扫描结果转换为 Markdown 文档的公共渲染层：
 *   - buildVariantBody(): 融合叙事 — 描述+代码交织的项目特写
 *   - trimExampleToEssence(): 智能裁剪代码示例
 *
 * @module shared/rendering
 */

import { BASIC_USAGE } from '../canonical-examples.js';

// ═══════════════════════════════════════════════════════════
//  融合叙事渲染 — 项目特写风格
// ═══════════════════════════════════════════════════════════

/**
 * 将变体扫描结果转为「项目特写」融合叙事 body（Markdown）
 *
 * v9 融合叙事：
 *   描述文字与代码交织，读完即知「这个项目的这个模式该怎么写」
 *   不使用 ### 写法 / #### 标准写法 / #### 项目代码 等固定 section
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

  const bodyLines = [];

  // ── 首选写法（第一个非 boilerplate 变体）──
  const primary = variants.find(v => !v.boilerplate) || variants[0];
  if (!primary) return [];

  const primaryPct = totalFiles > 0 ? Math.round((primary.fileCount / totalFiles) * 100) : 0;

  // 开篇统计 — 自然叙述
  if (variants.length === 1 && !(otherVariant && otherVariant.fileCount > 0)) {
    bodyLines.push(
      `项目中 ${totalFiles} 个文件使用此功能，统一采用 ${primary.label} 写法。`,
      '',
    );
  } else {
    const displayCount = variants.length + (otherVariant && otherVariant.fileCount > 0 ? 1 : 0);
    bodyLines.push(
      `项目中 ${totalFiles} 个文件使用此功能，共 ${displayCount} 种写法。` +
      `首选 **${primary.label}**（${primary.fileCount} 个文件，${primaryPct}%）。`,
      '',
    );
  }

  // ── 首选写法的标准模板 ──
  if (patternKey) {
    const usageKey = `${lang}:${patternKey}:${primary.key}`;
    const basic = BASIC_USAGE[usageKey];
    if (basic) {
      bodyLines.push('标准写法：', '');
      bodyLines.push('```' + lang);
      for (const line of basic.code) {
        bodyLines.push(projectPrefix ? line.replace(/\{PREFIX\}/g, projectPrefix) : line.replace(/\{PREFIX\}/g, ''));
      }
      bodyLines.push('```', '');
    }
  }

  // ── 首选写法的项目真实代码 ──
  if (primary.examples.length > 0) {
    // 选最典型的 1-2 个示例
    const topExamples = primary.examples.slice(0, 2);
    for (const ex of topExamples) {
      const trimmed = trimExampleToEssence(ex.block, primary.key, scanResult._variantDefs, lang);
      bodyLines.push('```' + lang);
      bodyLines.push(`// ── ${ex.file}:L${ex.lineNum} ──`);
      for (const line of trimmed) bodyLines.push(line);
      bodyLines.push('```', '');
    }
  }

  // ── 次要写法 — 简要提及 ──
  if (variants.length > 1) {
    const others = variants.filter(v => v !== primary);
    for (const v of others) {
      const pct = totalFiles > 0 ? Math.round((v.fileCount / totalFiles) * 100) : 0;
      let line = `也有 ${v.fileCount} 个文件（${pct}%）使用 ${v.label}`;
      // 仅对非 boilerplate、有示例的次要写法展示一个代码片段
      if (!v.boilerplate && v.examples.length > 0) {
        line += '：';
        bodyLines.push(line, '');
        const ex = v.examples[0];
        const trimmed = trimExampleToEssence(ex.block, v.key, scanResult._variantDefs, lang);
        bodyLines.push('```' + lang);
        bodyLines.push(`// ── ${ex.file}:L${ex.lineNum} ──`);
        for (const ln of trimmed) bodyLines.push(ln);
        bodyLines.push('```', '');
      } else {
        bodyLines.push(line + '。', '');
      }
    }
  }

  // "其他写法" 汇总
  if (otherVariant && otherVariant.fileCount > 0) {
    const otherPct = totalFiles > 0 ? Math.round((otherVariant.fileCount / totalFiles) * 100) : 0;
    bodyLines.push(`另有 ${otherVariant.fileCount} 个文件（${otherPct}%）使用其他写法，新代码不建议采用。`, '');
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
