/**
 * 统一扫描框架
 *
 * 将三种扫描范式统一到公共层：
 *   - scanVariants(): 两遍扫描 — 文件计数 + 代码提取（原 extractors-micro._scanVariants）
 *   - scanUsages():   全项目使用频率统计（原 extractors-objc-deep._scanUsages）
 *
 * @module shared/scanner
 */

import { extractEnclosingBlock } from '../patterns.js';
import { filterThirdParty, isThirdParty } from './third-party-filter.js';
import { escapeRegex } from './objc-swift-utils.js';

// ── 声明行识别 — 用于优先选择「使用行」作为示例 ──

/** @type {RegExp} 匹配 ObjC/Swift 声明行（@property, @interface, static 变量声明等） */
const DECL_LINE_RE = /^\s*(@property\b|@interface\b|@protocol\b|@class\b|@synthesize\b|@dynamic\b|@end\b|NS_ASSUME_NONNULL|#import\b|#include\b|#define\b)/;
/** @type {RegExp} 匹配纯类型/变量声明（如 dispatch_semaphore_t foo;） */
const TYPE_DECL_RE = /^\s*\w[\w<>*\s]+[\s*]+_?\w+\s*;$/;
/** @type {RegExp} 匹配 static 变量声明（无函数调用） */
const STATIC_DECL_RE = /^\s*static\s+\w/;

/**
 * 对匹配行打分 — 越高表示越适合作为项目示例
 *   ≥2  实际使用（方法调用、函数调用、block 调用）
 *    0  普通代码行
 *  <0  声明行（@property, @interface, 类型声明等）
 */
function _lineUsageScore(line) {
  const t = line.trim();
  // 声明/头文件噪音 — 低分
  if (DECL_LINE_RE.test(t)) return -2;
  if (TYPE_DECL_RE.test(t)) return -1;
  if (STATIC_DECL_RE.test(t) && !/\(/.test(t)) return -1;
  // 方法声明行（纯声明，没有 { 体）
  if (/^[-+]\s*\([^)]+\)\s*\w+[^{]*;\s*$/.test(t)) return -1;
  // 使用行 — 高分
  if (/\[.*\w+.*\]/.test(t)) return 2;   // ObjC message send
  if (/\w+\s*\(/.test(t)) return 2;       // C-style function call
  if (/\^\s*[{(]/.test(t)) return 1;      // block literal
  return 0;
}

/**
 * 在文件行中寻找最佳匹配行 — 优先实际使用行，跳过声明行
 * @param {string[]} lines
 * @param {RegExp} searchRe
 * @returns {number} 找到的行索引，找不到返回 -1
 */
function _findBestMatchLine(lines, searchRe) {
  let bestIdx = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < lines.length; i++) {
    if (!searchRe.test(lines[i])) continue;
    const score = _lineUsageScore(lines[i]);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
      if (score >= 2) break; // 足够好，提前终止
    }
  }
  return bestIdx;
}

/** 每个写法变体展示的代码示例数上限 */
const MAX_EXAMPLES_PER_VARIANT = 2;
/** 代码块最大行数 (v9: 30→20，减少 prompt 膨胀) */
const MAX_BLOCK_LINES = 20;
/** 每个名称收集的使用示例上限 */
const MAX_USAGE_EXAMPLES = 6;

// ═══════════════════════════════════════════════════════════
//  策略 1: 变体扫描 (原 extractors-micro._scanVariants)
// ═══════════════════════════════════════════════════════════

/**
 * 扫描项目中某功能的不同实现写法（变体）及频次
 *
 * 两遍扫描：
 *   Pass 1: 文件级正则匹配，统计每种变体的文件数（快速）
 *   Pass 2: 为有匹配的变体提取代表性代码块（按需）
 *
 * @param {object[]} allFiles
 * @param {RegExp} mainFilter — 文件级预过滤（跳过不含该功能的文件）
 * @param {Object<string, { label: string, regex: RegExp }>} variantDefs
 *        — 写法变体定义，顺序敏感：首匹配归类
 * @param {string} lang
 * @param {object} [opts]
 * @returns {{ totalFiles: number, variants: Array<{ key, label, fileCount, examples }>, otherVariant, _variantDefs }}
 */
export function scanVariants(allFiles, mainFilter, variantDefs, lang, opts = {}) {
  const { maxExamples = MAX_EXAMPLES_PER_VARIANT, maxBlockLines = MAX_BLOCK_LINES } = opts;

  // ── 预过滤: 跳过三方库文件 ──
  const filteredFiles = filterThirdParty(allFiles);

  // ── Pass 1: 统计每种变体的文件数 ──
  const variantFileSets = new Map();
  for (const key of Object.keys(variantDefs)) variantFileSets.set(key, new Set());
  variantFileSets.set('_other', new Set());

  let totalFiles = 0;
  for (const f of filteredFiles) {
    if (!mainFilter.test(f.content)) continue;
    totalFiles++;
    let classified = false;
    for (const [key, def] of Object.entries(variantDefs)) {
      if (def.regex.test(f.content)) {
        variantFileSets.get(key).add(f.relativePath);
        classified = true;
        break;
      }
    }
    if (!classified) {
      // 跳过 .h 纯声明文件 — 它们匹配 mainRegex 但不含实现细节
      const isHeaderOnly = /\.h$/i.test(f.name || f.relativePath || '');
      if (isHeaderOnly) {
        totalFiles--;
      } else {
        variantFileSets.get('_other').add(f.relativePath);
      }
    }
  }

  // ── Pass 2: 提取代码示例（优先 .m/.mm 实现文件，避免 .h 声明文件） ──
  const results = [];
  for (const [key, fileSet] of variantFileSets) {
    if (fileSet.size === 0) continue;
    const def = variantDefs[key] || { label: '其他写法', regex: mainFilter };
    const searchRe = def.regex || mainFilter;

    const examples = [];
    // 将文件分为实现文件(.m/.mm/.swift)和头文件(.h)，优先取实现文件
    const implFiles = [];
    const headerFiles = [];
    for (const f of filteredFiles) {
      if (!fileSet.has(f.relativePath)) continue;
      if (/\.(m|mm|swift)$/i.test(f.name || f.relativePath || '')) {
        implFiles.push(f);
      } else {
        headerFiles.push(f);
      }
    }
    // 优先从实现文件提取示例，不够再从头文件补充
    for (const f of [...implFiles, ...headerFiles]) {
      if (examples.length >= maxExamples) break;
      const lines = f.content.split('\n');
      const matchIdx = _findBestMatchLine(lines, searchRe);
      if (matchIdx < 0) continue;
      // 质量门：.h 头文件中若最佳匹配仍是声明行，跳过（BASIC_USAGE 会兜底）
      const isHeader = /\.h$/i.test(f.name || f.relativePath || '');
      if (isHeader && _lineUsageScore(lines[matchIdx]) < 0) continue;
      const block = extractEnclosingBlock(lines, matchIdx, lang, maxBlockLines);
      examples.push({ file: f.relativePath, lineNum: matchIdx + 1, block });
    }
    results.push({ key, label: def.label || '其他写法', fileCount: fileSet.size, examples, boilerplate: !!def.boilerplate });
  }

  // 二级排序：非 boilerplate 按频率优先，boilerplate 排后
  const sorted = results.sort((a, b) => {
    const aBp = a.boilerplate ? 1 : 0;
    const bBp = b.boilerplate ? 1 : 0;
    if (aBp !== bBp) return aBp - bBp;
    return b.fileCount - a.fileCount;
  });
  // 将 _other 从 variants 中分离出来 — 它不是真正的写法变体
  const otherIdx = sorted.findIndex(v => v.key === '_other');
  const otherVariant = otherIdx >= 0 ? sorted.splice(otherIdx, 1)[0] : null;
  return { totalFiles, variants: sorted, otherVariant, _variantDefs: variantDefs };
}

// ═══════════════════════════════════════════════════════════
//  策略 2: 使用频率扫描 (原 extractors-objc-deep._scanUsages)
// ═══════════════════════════════════════════════════════════

/**
 * 扫描项目所有文件中对指定名称的 **使用** 位置（排除定义/声明）
 *
 * 使用 includes() 预过滤 + word-boundary 正则精确匹配。
 * 自动跳过注释、#define 行、方法定义行等非使用行。
 *
 * @param {object[]} allFiles — 全量文件列表
 * @param {Set<string>} nameSet — 要搜索的名称集合
 * @param {object} [opts]
 * @returns {Map<string, { count: number, examples: Array<{ file: string, lineNum: number, code: string }> }>}
 */
export function scanUsages(allFiles, nameSet, opts = {}) {
  const { maxExamples = MAX_USAGE_EXAMPLES } = opts;
  const usages = new Map();

  // 预编译 word-boundary 正则
  const regexes = new Map();
  for (const name of nameSet) {
    if (name.length < 2) continue;
    try { regexes.set(name, new RegExp(`\\b${escapeRegex(name)}\\b`)); } catch { /* skip */ }
  }
  if (regexes.size === 0) return usages;

  for (const f of allFiles) {
    if (!/\.(m|mm|swift|h|c|cpp)$/i.test(f.name || '')) continue;
    const lines = f.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // 跳过空行和注释
      if (!trimmed) continue;
      if (/^\/\/|^\s*\*|^\/\*/.test(trimmed)) continue;

      // 跳过定义/声明行（只收集调用/使用点）
      if (/^#define\b/.test(trimmed)) continue;
      if (/^(?:static|extern|FOUNDATION_EXPORT|UIKIT_EXTERN)\b/.test(trimmed)) continue;
      if (/^@interface\b|^@implementation\b|^@end\b|^@protocol\b/.test(trimmed)) continue;
      if (/^[-+]\s*\(/.test(trimmed)) continue; // 方法定义/声明行
      if (/^@property\b/.test(trimmed)) continue;

      for (const [name, re] of regexes) {
        if (!line.includes(name)) continue; // fast pre-filter
        if (!re.test(line)) continue;

        let entry = usages.get(name);
        if (!entry) { entry = { count: 0, examples: [] }; usages.set(name, entry); }
        entry.count++;

        if (entry.examples.length < maxExamples) {
          // 去重：不添加结构完全相同的代码行
          if (!entry.examples.some(e => e.code === trimmed)) {
            entry.examples.push({ file: f.relativePath, lineNum: i + 1, code: trimmed });
          }
        }
      }
    }
  }
  return usages;
}
