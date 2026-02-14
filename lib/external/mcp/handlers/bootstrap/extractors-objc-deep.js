/**
 * Bootstrap — ObjC/Swift 深度扫描提取器
 *
 * ⑧ objc-deep-scan 子主题（2 个）：
 *   1. defines-and-constants  — 全量 #define/extern/static 常量 + 项目实际使用方式（按频次）
 *   2. swizzle-hooks          — Method Swizzling hook 对 + 完整实现代码
 *
 * ⑨ category-scan（独立维度，从 objc-deep-scan 拆分）：
 *   - category-methods        — Foundation/UIKit Category 方法实现代码 + 调用方式（按频次）
 *   - 仅扫描基础类分类，不含业务代码
 *
 * 核心设计原则：
 *   - 代码展示 **项目特征** — 不是功能的通用用法，而是当前项目中的实际写法
 *   - 所有使用方式按频次排序，多种写法全部列举
 *   - Agent 注意事项使用强制语气 — 确保 Code Agent 遵循项目约定
 *   - dualOutput: 同时生成 Project Skill（宏观聚合）和 Candidate（精细粒度 → Recipe → Snippet）
 */

import { _buildCandidateDoc, _makeTitle } from './dimensions.js';
import { extractEnclosingBlock } from './patterns.js';
import { FOUNDATION_TYPES, UIKIT_TYPES, classifyBase, escapeRegex, collectMultilineMacro, inferMacroCategory } from './shared/objc-swift-utils.js';
import { isThirdParty } from './shared/third-party-filter.js';
import { scanUsages } from './shared/scanner.js';

const DIM_ID = 'objc-deep-scan';

/** 每个常量/方法展示详细使用方式的最大数量 */
const MAX_DETAIL_ITEMS = 12;
/** 方法实现显示最大行数 */
const MAX_IMPL_LINES = 25;
/** 单个 Candidate code 字段最大字节数（CandidateService 限制 50KB，预留 5KB 给 header/notes） */
const MAX_BODY_CHARS = 42 * 1024;

// ─── 三方库路径过滤（使用 shared/third-party-filter.js）─────
const _isThirdPartyFile = isThirdParty;

// ─── 通用工具函数（使用 shared/objc-swift-utils.js）──────
const _escapeRegex = escapeRegex;
const _collectMultilineMacro = collectMultilineMacro;
const _inferMacroCategory = inferMacroCategory;

// ─── 使用频率扫描（使用 shared/scanner.js）──────
const _scanUsages = scanUsages;

// ─── Foundation / UIKit 类型集（使用 shared/objc-swift-utils.js）──
const _classifyBase = classifyBase;

// ═══════════════════════════════════════════════════════════
//  子主题 1: defines-and-constants
//  核心变化：每个常量附带「项目中的实际使用方式」+ 按频次排序
// ═══════════════════════════════════════════════════════════

function _extractDefinesAndConstants(allFiles, lang, pipelineCtx) {
  const results = [];

  const constFileRe = /(?:const|constant|macro|define|config|theme|color|colour|font|size|dimension|style|key|notification|url|api|endpoint|global|common)/i;
  const isConstFile = (f) => constFileRe.test(f.name || '') || constFileRe.test(f.relativePath || '');

  // ── Phase 1: 收集所有常量/宏 ──
  const fileDefines = new Map(); // relativePath → entry

  for (const f of allFiles) {
    if (_isThirdPartyFile(f)) continue;
    if (lang === 'objectivec' && !/\.(h|m|mm|pch)$/i.test(f.name || '')) continue;
    if (lang === 'swift' && !/\.swift$/i.test(f.name || '')) continue;
    const fileLines = f.content.split('\n');
    const entry = { valueMacros: [], funcMacros: [], externConsts: [], staticConsts: [], file: f.relativePath };

    if (lang === 'objectivec') {
      for (let i = 0; i < fileLines.length; i++) {
        const line = fileLines[i];

        // extern / FOUNDATION_EXPORT 常量
        const externMatch = line.match(/(?:extern|FOUNDATION_EXPORT|UIKIT_EXTERN)\s+(?:(?:const\s+)?(?:NSString|NSInteger|CGFloat|NSNotificationName|NSErrorDomain)\s+\*?\s*(?:const\s+)?|(?:NSInteger|CGFloat|NSTimeInterval|NSUInteger)\s+)(\w+)/);
        if (externMatch) {
          entry.externConsts.push({ name: externMatch[1], file: f.relativePath });
          continue;
        }

        // static const
        const staticMatch = line.match(/^static\s+(?:const\s+)?(?:NSString\s+\*\s*const|NSInteger|CGFloat|NSTimeInterval|NSUInteger|int|float|double|BOOL|CGSize|CGRect|UIEdgeInsets)\s+(\w+)\s*=\s*(.+?);\s*$/);
        if (staticMatch) {
          entry.staticConsts.push({
            name: staticMatch[1], value: staticMatch[2].trim(),
            file: f.relativePath, category: _inferMacroCategory(staticMatch[1], staticMatch[2]),
          });
          continue;
        }

        // #define
        if (!line.startsWith('#define ') && !line.startsWith('#define\t')) continue;
        const fullLine = _collectMultilineMacro(fileLines, i);

        // 跳过头文件守卫
        const guardMatch = fullLine.match(/^#define\s+(\w+)\s*$/);
        if (guardMatch && /_H_?$|_h_?$|^__/.test(guardMatch[1])) continue;

        // 函数宏
        const funcMatch = fullLine.match(/^#define\s+(\w+)\(([^)]*)\)\s+(.+)/);
        if (funcMatch) {
          entry.funcMacros.push({
            name: funcMatch[1], params: funcMatch[2].trim(),
            body: funcMatch[3].trim().substring(0, 200),
            file: f.relativePath, category: _inferMacroCategory(funcMatch[1], funcMatch[3]),
          });
          continue;
        }

        // 值宏
        const valMatch = fullLine.match(/^#define\s+(\w+)\s+(.+)/);
        if (valMatch) {
          const macroName = valMatch[1];
          if (/_H_?$|_h_?$|^__/.test(macroName)) continue;
          entry.valueMacros.push({
            name: macroName, value: valMatch[2].trim().substring(0, 200),
            file: f.relativePath, category: _inferMacroCategory(macroName, valMatch[2]),
          });
        }
      }
    } else if (lang === 'swift') {
      let inNamespace = null;
      let braceDepth = 0;

      for (let i = 0; i < fileLines.length; i++) {
        const line = fileLines[i];
        for (const ch of line) {
          if (ch === '{') braceDepth++;
          if (ch === '}') { braceDepth--; if (inNamespace && braceDepth < inNamespace.depth) inNamespace = null; }
        }

        const taMatch = line.match(/(?:public\s+|internal\s+)?typealias\s+(\w+)\s*=\s*(.+)/);
        if (taMatch) {
          entry.staticConsts.push({ name: taMatch[1], value: taMatch[2].trim().substring(0, 100), file: f.relativePath, category: '类型别名' });
          continue;
        }

        const nsMatch = line.match(/^\s*(?:public\s+|internal\s+|private\s+)?(?:final\s+)?(enum|struct)\s+(\w+)\s*(?::\s*\w+)?\s*\{/);
        if (nsMatch) { inNamespace = { type: nsMatch[1], name: nsMatch[2], depth: braceDepth }; continue; }

        if (braceDepth === 0 || (inNamespace && braceDepth === inNamespace.depth)) {
          const constMatch = line.match(/^\s*(?:public\s+|internal\s+)?(?:static\s+)?(?:let|var)\s+(\w+)\s*(?::\s*[\w.<>\[\]?!]+)?\s*=\s*(.+)/);
          if (constMatch) {
            const cName = constMatch[1];
            const cValue = constMatch[2].trim().substring(0, 150);
            const prefix = inNamespace ? `${inNamespace.name}.` : '';
            entry.staticConsts.push({
              name: prefix + cName, value: cValue, file: f.relativePath,
              category: _inferMacroCategory(cName, cValue),
            });
          }
        }
      }
    }

    const total = entry.valueMacros.length + entry.funcMacros.length + entry.externConsts.length + entry.staticConsts.length;
    if (total > 0) fileDefines.set(f.relativePath, entry);
  }

  if (fileDefines.size === 0) return results;

  // ── 缓存中间结果到 PipelineContext（供 project-profile/base-classes 复用）──
  if (pipelineCtx) {
    // 缓存扁平化的常量/宏列表，按类别分组
    const flatDefines = { valueMacros: [], funcMacros: [], externConsts: [], staticConsts: [] };
    for (const entry of fileDefines.values()) {
      flatDefines.valueMacros.push(...entry.valueMacros);
      flatDefines.funcMacros.push(...entry.funcMacros);
      flatDefines.externConsts.push(...entry.externConsts);
      flatDefines.staticConsts.push(...entry.staticConsts);
    }
    pipelineCtx.cacheResult('objc-deep-scan', 'defines', flatDefines);
    pipelineCtx.cacheResult('objc-deep-scan', 'fileDefines', fileDefines);
  }

  // ── Phase 2: 扫描全项目使用频次 ──
  const allNames = new Set();
  for (const entry of fileDefines.values()) {
    for (const m of [...entry.valueMacros, ...entry.funcMacros, ...entry.externConsts, ...entry.staticConsts]) {
      if (m.name && m.name.length >= 3) allNames.add(m.name);
    }
  }

  const usages = _scanUsages(allFiles, allNames);

  // ── Phase 3: 构建 Candidate — 每个常量文件独立一条 ──
  const constFileEntries = [];
  const scatteredEntries = [];

  for (const [fp, entry] of fileDefines) {
    if (isConstFile({ name: fp.split('/').pop(), relativePath: fp })) {
      constFileEntries.push(entry);
    } else {
      scatteredEntries.push(entry);
    }
  }

  for (const entry of constFileEntries) {
    const allItems = [...entry.valueMacros, ...entry.funcMacros, ...entry.externConsts, ...entry.staticConsts];
    const fileName = entry.file.split('/').pop();

    // 为每个常量附加使用频次
    for (const item of allItems) {
      item._usageCount = usages.get(item.name)?.count || 0;
    }
    // 按使用频次降序
    allItems.sort((a, b) => b._usageCount - a._usageCount);
    const totalUsages = allItems.reduce((s, m) => s + m._usageCount, 0);

    // 按类别分组
    const byCategory = {};
    for (const m of allItems) {
      const cat = m.category || '其他';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(m);
    }

    const bodyLines = [];
    let detailCount = 0;
    let bodyChars = 0;

    for (const [cat, macros] of Object.entries(byCategory).sort((a, b) => {
      const aTotal = a[1].reduce((s, m) => s + m._usageCount, 0);
      const bTotal = b[1].reduce((s, m) => s + m._usageCount, 0);
      return bTotal - aTotal;
    })) {
      const catUsages = macros.reduce((s, m) => s + m._usageCount, 0);
      bodyLines.push(`### ${cat}（${macros.length} 个，引用 ${catUsages} 次）`, '');
      bodyChars += 60;

      for (const item of macros) {
        const count = item._usageCount;
        const usageInfo = usages.get(item.name);
        const budgetExceeded = bodyChars > MAX_BODY_CHARS;

        // 预算耗尽时只保留签名摘要
        if (budgetExceeded) {
          const val = item.value ? ` = \`${item.value.substring(0, 40)}\`` : '';
          bodyLines.push(`- \`${item.name}\`${val} — ${count} 次`);
          bodyChars += 60;
          continue;
        }

        // 定义行
        if (item.params !== undefined) {
          bodyLines.push(`#### \`${item.name}(${item.params})\` — 引用 ${count} 次`);
          bodyLines.push('', '定义：', '```' + (lang === 'swift' ? 'swift' : 'objectivec'));
          bodyLines.push(`#define ${item.name}(${item.params}) ${item.body}`);
          bodyLines.push('```', '');
          bodyChars += item.body.length + 80;
        } else if (item.value !== undefined) {
          bodyLines.push(`#### \`${item.name}\` — 引用 ${count} 次`);
          bodyLines.push('', '定义：', '```' + (lang === 'swift' ? 'swift' : 'objectivec'));
          bodyLines.push(lang === 'swift'
            ? `let ${item.name} = ${item.value}`
            : `#define ${item.name} ${item.value}`);
          bodyLines.push('```', '');
          bodyChars += (item.value?.length || 0) + 80;
        } else {
          bodyLines.push(`#### \`${item.name}\` — 引用 ${count} 次`);
          bodyLines.push('', '定义：`extern ... ' + item.name + '`', '');
          bodyChars += 60;
        }

        // 项目使用方式（仅为高频常量展示详细用法，每个文件限 MAX_DETAIL_ITEMS 个）
        if (usageInfo && usageInfo.examples.length > 0 && detailCount < MAX_DETAIL_ITEMS && !budgetExceeded) {
          bodyLines.push('**项目使用方式：**', '');
          bodyLines.push('```' + (lang === 'swift' ? 'swift' : 'objectivec'));
          for (const ex of usageInfo.examples) {
            bodyLines.push(`// ── ${ex.file}:L${ex.lineNum} ──`);
            bodyLines.push(ex.code);
            bodyChars += ex.code.length + 40;
          }
          bodyLines.push('```', '');
          detailCount++;
        }
      }
    }
    if (bodyChars > MAX_BODY_CHARS) {
      bodyLines.push('', `> ⚠️ 内容已截断（超出体积预算），低频项仅列签名`);
    }

    results.push({
      title: _makeTitle(DIM_ID, `defines/${fileName}`),
      subTopic: `defines/${fileName}`,
      code: _buildCandidateDoc({
        heading: `常量定义文件：${entry.file}`,
        oneLiner: `${allItems.length} 个常量/宏，在项目中累计被引用 ${totalUsages} 次`,
        bodyLines,
        agentNotes: [
          `⛔ 此文件中的所有常量/宏 **必须** 被使用 — 遇到相同值时 **禁止** 硬编码 magic number/string`,
          `新增同类常量应放在此文件（${entry.file}）中，保持常量集中管理`,
          '修改常量前确认影响范围 — 以上使用频次反映了实际引用规模',
        ],
        relationLines: ['ENFORCES: [project-profile/base-classes] — 补充详细常量清单'],
      }),
      language: lang === 'swift' ? 'swift' : 'objectivec',
      sources: [entry.file],
      summary: `objc-deep-scan/defines/${fileName} 常量文件：${allItems.length} 个宏/常量，引用 ${totalUsages} 次（Agent 必须使用、禁止硬编码）`,
      knowledgeType: 'code-standard',
      tags: ['defines', 'constants', 'macros', fileName.replace(/\.\w+$/, '')],
      relations: [
        { type: 'ENFORCES', target: _makeTitle('project-profile', 'base-classes'), description: '补充详细常量清单' },
      ],
    });
  }

  // 散落在非常量文件中的定义
  if (scatteredEntries.length > 0) {
    const allScattered = {
      valueMacros: scatteredEntries.flatMap(e => e.valueMacros),
      funcMacros: scatteredEntries.flatMap(e => e.funcMacros),
      externConsts: scatteredEntries.flatMap(e => e.externConsts),
      staticConsts: scatteredEntries.flatMap(e => e.staticConsts),
    };
    const scTotal = allScattered.valueMacros.length + allScattered.funcMacros.length +
      allScattered.externConsts.length + allScattered.staticConsts.length;

    if (scTotal > 0) {
      const scItems = [...allScattered.valueMacros, ...allScattered.staticConsts,
        ...allScattered.funcMacros, ...allScattered.externConsts];
      for (const item of scItems) { item._usageCount = usages.get(item.name)?.count || 0; }
      scItems.sort((a, b) => b._usageCount - a._usageCount);
      const scTotalUsages = scItems.reduce((s, m) => s + m._usageCount, 0);

      const bodyLines = [`> 以下定义分散在 ${scatteredEntries.length} 个非专用文件中`, ''];
      let detailCount = 0;

      for (const item of scItems.slice(0, 30)) {
        const count = item._usageCount;
        const usageInfo = usages.get(item.name);

        if (item.params !== undefined) {
          bodyLines.push(`- \`${item.name}(${item.params})\` → \`${item.body.substring(0, 80)}\` — ${count} 次使用 (${item.file})`);
        } else if (item.value !== undefined) {
          bodyLines.push(`- \`${item.name}\` = \`${item.value.substring(0, 60)}\` — ${count} 次使用 (${item.file})`);
        } else {
          bodyLines.push(`- \`${item.name}\` — ${count} 次使用 (${item.file})`);
        }

        if (usageInfo && usageInfo.examples.length > 0 && detailCount < 5) {
          bodyLines.push('', '  ```' + (lang === 'swift' ? 'swift' : 'objectivec'));
          for (const ex of usageInfo.examples.slice(0, 3)) {
            bodyLines.push(`  // ── ${ex.file}:L${ex.lineNum} ──`);
            bodyLines.push(`  ${ex.code}`);
          }
          bodyLines.push('  ```', '');
          detailCount++;
        }
      }
      if (scItems.length > 30) bodyLines.push('', `*…另有 ${scItems.length - 30} 个*`);

      results.push({
        title: _makeTitle(DIM_ID, 'defines/scattered'),
        subTopic: 'defines/scattered',
        code: _buildCandidateDoc({
          heading: '散落常量/宏定义汇总',
          oneLiner: `${scTotal} 个定义散落在 ${scatteredEntries.length} 个文件，累计引用 ${scTotalUsages} 次`,
          bodyLines,
          agentNotes: [
            '⛔ 散落常量同样 **必须** 被使用，遇到相同值时禁止硬编码',
            '建议将高频散落常量迁移到专用常量文件中统一管理',
          ],
        }),
        language: lang === 'swift' ? 'swift' : 'objectivec',
        sources: [...new Set(scatteredEntries.map(e => e.file))].slice(0, 15),
        summary: `objc-deep-scan/defines/scattered 散落常量：${scTotal} 个定义，${scTotalUsages} 次引用（Agent 必须使用）`,
        knowledgeType: 'code-standard',
        tags: ['defines', 'constants', 'scattered'],
      });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
//  子主题 2: category-methods
//  核心变化：展示方法实现代码 + 项目中的调用方式与频次
// ═══════════════════════════════════════════════════════════

function _extractCategoryMethods(allFiles, lang, pipelineCtx) {
  if (lang === 'objectivec') return _extractObjcCategories(allFiles, pipelineCtx);
  if (lang === 'swift') return _extractSwiftExtensions(allFiles, pipelineCtx);
  return [];
}

/**
 * ObjC Category 深度扫描
 * 从 .m 文件提取完整方法实现，从全项目扫描调用点
 */
function _extractObjcCategories(allFiles, pipelineCtx) {
  const categories = new Map(); // `BaseClass(CatName)` → { baseClass, catName, kind, file, methods[] }

  // ── Phase 1: 解析 .m 文件中的 Category 方法实现（跳过三方库） ──
  for (const f of allFiles) {
    if (_isThirdPartyFile(f)) continue;
    if (!/\.(m|mm)$/i.test(f.name || '')) continue;
    const lines = f.content.split('\n');
    let currentCat = null;

    for (let i = 0; i < lines.length; i++) {
      // @implementation BaseClass (CategoryName)
      const implMatch = lines[i].match(/^@implementation\s+(\w+)\s*\(\s*(\w*)\s*\)/);
      if (implMatch) {
        const baseClass = implMatch[1];
        const catName = implMatch[2] || 'Anonymous';
        const key = `${baseClass}(${catName})`;
        if (!categories.has(key)) {
          categories.set(key, {
            baseClass, catName, kind: _classifyBase(baseClass),
            file: f.relativePath, methods: [],
          });
        }
        currentCat = categories.get(key);
        continue;
      }

      if (/^@end\b/.test(lines[i].trim())) { currentCat = null; continue; }
      if (!currentCat) continue;

      // 方法实现起始行
      const mMatch = lines[i].match(/^([-+])\s*\(([^)]+)\)([^;{]*)/);
      if (!mMatch) continue;

      const isClassMethod = mMatch[1] === '+';
      const returnType = mMatch[2].trim();
      const selectorPart = mMatch[3].trim();

      // 提取方法名第一段（用于使用频次扫描）
      const selectorFirstPart = selectorPart.split(':')[0].replace(/\s+/g, '').trim();

      // 提取完整方法实现（大括号平衡）
      const implLines = [];
      let depth = 0;
      let started = false;
      for (let j = i; j < Math.min(lines.length, i + 150); j++) {
        for (const ch of lines[j]) {
          if (ch === '{') { depth++; started = true; }
          if (ch === '}') depth--;
        }
        implLines.push(lines[j]);
        if (started && depth <= 0) break;
      }

      // 截断超长实现
      let implCode;
      if (implLines.length > MAX_IMPL_LINES) {
        implCode = [...implLines.slice(0, MAX_IMPL_LINES - 2), '    // ... (更多实现省略)', '}'].join('\n');
      } else {
        implCode = implLines.join('\n');
      }

      currentCat.methods.push({
        signature: `${mMatch[1]} (${returnType})${selectorPart}`,
        selectorFirstPart,
        isClassMethod,
        implementation: implCode,
        file: f.relativePath,
        line: i + 1,
      });
    }
  }

  // 同时从 .h 文件补充声明（仅补充没有 .m 实现的 Category 方法，跳过三方库）
  for (const f of allFiles) {
    if (_isThirdPartyFile(f)) continue;
    if (!/\.h$/i.test(f.name || '')) continue;
    const lines = f.content.split('\n');
    let currentCat = null;

    for (let i = 0; i < lines.length; i++) {
      const catMatch = lines[i].match(/^@interface\s+(\w+)\s*\(\s*(\w*)\s*\)/);
      if (catMatch) {
        const key = `${catMatch[1]}(${catMatch[2] || 'Anonymous'})`;
        if (!categories.has(key)) {
          categories.set(key, {
            baseClass: catMatch[1], catName: catMatch[2] || 'Anonymous',
            kind: _classifyBase(catMatch[1]), file: f.relativePath, methods: [],
          });
        }
        currentCat = categories.get(key);
        continue;
      }
      if (/^@end\b/.test(lines[i].trim())) { currentCat = null; continue; }
      if (!currentCat) continue;

      // 方法声明（无实现体 — 仅当 .m 中未找到此方法时记录）
      const declMatch = lines[i].match(/^([-+])\s*\(([^)]+)\)([^;]+);/);
      if (declMatch) {
        const selFirst = declMatch[3].trim().split(':')[0].replace(/\s+/g, '').trim();
        const alreadyHasImpl = currentCat.methods.some(m => m.selectorFirstPart === selFirst);
        if (!alreadyHasImpl) {
          currentCat.methods.push({
            signature: `${declMatch[1]} (${declMatch[2].trim()})${declMatch[3].trim()}`,
            selectorFirstPart: selFirst,
            isClassMethod: declMatch[1] === '+',
            implementation: null, // .h only — 无实现代码
            file: f.relativePath,
            line: i + 1,
          });
        }
      }
    }
  }

  if (categories.size === 0) return [];

  // ── 缓存中间结果到 PipelineContext（供 project-profile/base-extensions 复用）──
  // ★ 在 Phase 1.5 过滤前缓存，包含所有 Category（Foundation/UIKit/自定义）
  if (pipelineCtx) {
    const extByBase = {};
    for (const cat of categories.values()) {
      if (!extByBase[cat.baseClass]) extByBase[cat.baseClass] = [];
      extByBase[cat.baseClass].push({
        name: `${cat.baseClass}(${cat.catName})`,
        file: cat.file,
        methodCount: cat.methods.length,
        kind: cat.kind,
        hasAssociatedObj: cat.methods.some(m =>
          m.implementation && /objc_setAssociatedObject|objc_getAssociatedObject/.test(m.implementation)),
      });
    }
    pipelineCtx.cacheResult('category-scan', 'extByBase', extByBase);
  }

  // ── Phase 1.5: 仅保留基础类 Category（Foundation/UIKit），跳过业务代码 ──
  for (const [key, cat] of categories) {
    if (cat.kind === 'custom') categories.delete(key);
  }
  if (categories.size === 0) return [];

  // ── Phase 2: 扫描全项目中的方法调用频次 ──
  const allSelectors = new Set();
  for (const cat of categories.values()) {
    for (const m of cat.methods) {
      if (m.selectorFirstPart && m.selectorFirstPart.length >= 3) {
        allSelectors.add(m.selectorFirstPart);
      }
    }
  }

  const usages = _scanUsages(allFiles, allSelectors);

  // 为每个方法附加使用频次
  for (const cat of categories.values()) {
    for (const m of cat.methods) {
      m._usageCount = usages.get(m.selectorFirstPart)?.count || 0;
    }
    // 方法按使用频次降序
    cat.methods.sort((a, b) => b._usageCount - a._usageCount);
  }

  // ── Phase 2.5: P4 Fix — 过滤零调用 Category，全部方法 0 次调用的分类无知识价值 ──
  for (const [key, cat] of categories) {
    const totalCalls = cat.methods.reduce((s, m) => s + m._usageCount, 0);
    if (totalCalls === 0) categories.delete(key);
  }
  if (categories.size === 0) return [];

  // ── Phase 3: 按文件构建 Candidate（每个源文件独立输出，超大文件自动拆分） ──
  const results = [];

  // 按源文件分组
  const byFile = new Map();
  for (const cat of categories.values()) {
    if (!byFile.has(cat.file)) byFile.set(cat.file, []);
    byFile.get(cat.file).push(cat);
  }

  for (const [filePath, catsInFile] of byFile) {
    // 按 category 内方法的总调用量降序排列
    catsInFile.sort((a, b) => {
      const aT = a.methods.reduce((s, m) => s + m._usageCount, 0);
      const bT = b.methods.reduce((s, m) => s + m._usageCount, 0);
      return bT - aT;
    });

    const fileName = filePath.split('/').pop() || filePath;
    const mainKind = catsInFile[0].kind;
    const kindLabel = mainKind === 'foundation' ? 'Foundation' : mainKind === 'uikit' ? 'UIKit' : '自定义类';

    let bodyLines = [];
    let bodyChars = 0;
    let partNum = 1;
    let partMethodCount = 0;
    let partCallCount = 0;

    /** flush 当前 part 为一个 Candidate，重置缓冲区 */
    const flushPart = () => {
      if (bodyLines.length === 0) return;
      const suffix = partNum > 1 ? `-p${partNum}` : '';
      const subTopic = `category/${fileName}${suffix}`;

      const agentNotes = mainKind === 'custom'
        ? [
            '⛔ 修改或扩展这些类时，先检查已有 Category 方法，优先复用',
            '新方法应添加到对应 Category 中而非新建 Category',
          ]
        : [
            `⛔ 遇到等价功能时 **必须** 使用项目的 ${kindLabel} Category 方法，**禁止** 手写相同逻辑`,
            `新增 ${kindLabel} 扩展方法前必须检查此清单，避免重复实现`,
            '以上每个方法的「项目调用方式」展示了标准用法 — Agent 必须遵循相同写法',
          ];
      if (mainKind !== 'custom') {
        agentNotes.push('Category 方法名建议加项目前缀（如 xx_methodName）防止与系统/三方库冲突');
      }

      results.push({
        title: _makeTitle(DIM_ID, subTopic),
        subTopic,
        code: _buildCandidateDoc({
          heading: `${fileName} Category 方法清单${partNum > 1 ? ` (Part ${partNum})` : ''}`,
          oneLiner: `${fileName}: ${partMethodCount} 个方法，${partCallCount} 次调用`,
          bodyLines,
          agentNotes,
          relationLines: [
            `ENFORCES: [project-profile/base-extensions] — ${kindLabel} 分类方法强制规范`,
          ],
        }),
        language: 'objectivec',
        sources: [filePath],
        summary: `objc-deep-scan/${subTopic} ${fileName} Category：${partMethodCount} 个方法，${partCallCount} 次调用（Agent 遇到同功能必须使用）`,
        knowledgeType: 'code-standard',
        tags: ['category', mainKind, 'objc'],
        relations: [
          { type: 'ENFORCES', target: _makeTitle('project-profile', 'base-extensions'), description: `${kindLabel} 分类方法强制规范` },
        ],
      });

      partNum++;
      bodyLines = [];
      bodyChars = 0;
      partMethodCount = 0;
      partCallCount = 0;
    };

    for (const cat of catsInFile) {
      bodyLines.push(`### ${cat.baseClass}(${cat.catName})`, '');
      bodyChars += 50;

      for (const m of cat.methods) {
        // 估算此方法所需空间
        const methodEstimate = 80 + (m.implementation ? m.implementation.length + 30 : 0) +
          (usages.get(m.selectorFirstPart)?.examples || []).reduce((s, ex) => s + ex.code.length + 40, 0);

        // 当前 part 已有内容且再加会超预算 → 先 flush，开启新 part
        if (bodyChars > 0 && bodyChars + methodEstimate > MAX_BODY_CHARS) {
          flushPart();
          bodyLines.push(`### ${cat.baseClass}(${cat.catName}) (续)`, '');
          bodyChars += 60;
        }

        partMethodCount++;
        partCallCount += m._usageCount;

        bodyLines.push(`#### \`${m.signature}\` — ${m._usageCount} 次调用`, '');
        bodyChars += 80;

        // 方法实现代码
        if (m.implementation) {
          bodyLines.push('实现代码：', '```objectivec', m.implementation, '```', '');
          bodyChars += m.implementation.length + 30;
        }

        // 项目调用方式
        const usageInfo = usages.get(m.selectorFirstPart);
        if (usageInfo && usageInfo.examples.length > 0) {
          bodyLines.push('项目调用方式：', '```objectivec');
          for (const ex of usageInfo.examples) {
            bodyLines.push(`// ── ${ex.file}:L${ex.lineNum} ──`);
            bodyLines.push(ex.code);
            bodyChars += ex.code.length + 40;
          }
          bodyLines.push('```', '');
        }
      }
    }

    // flush 剩余内容
    flushPart();
  }

  return results;
}

/**
 * Swift Extension 深度扫描
 */
function _extractSwiftExtensions(allFiles, pipelineCtx) {
  const extRe = /^(?:public\s+|internal\s+|private\s+|fileprivate\s+)?extension\s+(\w+)/;
  const funcRe = /^\s*(?:public\s+|internal\s+|private\s+|fileprivate\s+|open\s+|@objc\s+|static\s+|class\s+|@discardableResult\s+)*func\s+(\w+)\s*\(([^)]*)\)/;

  const extensions = new Map(); // `${baseClass}+${file}` → { baseClass, kind, file, methods[] }

  for (const f of allFiles) {
    if (_isThirdPartyFile(f)) continue;
    if (!/\.swift$/i.test(f.name || '')) continue;
    const lines = f.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const extMatch = lines[i].match(extRe);
      if (!extMatch) continue;

      const baseClass = extMatch[1];
      const key = `${baseClass}+${f.relativePath}`;
      const kind = _classifyBase(baseClass);
      const extData = { baseClass, kind, file: f.relativePath, methods: [] };

      // 扫描 extension body
      let depth = 0;
      let started = false;
      for (let j = i; j < Math.min(lines.length, i + 500); j++) {
        for (const ch of lines[j]) {
          if (ch === '{') { depth++; started = true; }
          if (ch === '}') depth--;
        }

        if (depth === 1) {
          const fMatch = lines[j].match(funcRe);
          if (fMatch) {
            // 提取方法实现代码
            const implLines = [];
            let fDepth = 0;
            let fStarted = false;
            for (let k = j; k < Math.min(lines.length, j + 100); k++) {
              for (const ch of lines[k]) {
                if (ch === '{') { fDepth++; fStarted = true; }
                if (ch === '}') fDepth--;
              }
              implLines.push(lines[k]);
              if (fStarted && fDepth <= 0) break;
            }

            let implCode;
            if (implLines.length > MAX_IMPL_LINES) {
              implCode = [...implLines.slice(0, MAX_IMPL_LINES - 2), '    // ... (更多实现省略)', '}'].join('\n');
            } else {
              implCode = implLines.join('\n');
            }

            extData.methods.push({
              name: fMatch[1],
              params: fMatch[2].trim(),
              selectorFirstPart: fMatch[1],
              implementation: implCode,
              file: f.relativePath,
              line: j + 1,
            });
          }
        }
        if (started && depth <= 0) break;
      }

      if (extData.methods.length > 0) {
        if (extensions.has(key)) {
          extensions.get(key).methods.push(...extData.methods);
        } else {
          extensions.set(key, extData);
        }
      }
    }
  }

  // ── 缓存中间结果到 PipelineContext（供 project-profile/base-extensions 复用）──
  // ★ 在过滤前缓存，包含所有 Extension（Foundation/UIKit/自定义）
  if (pipelineCtx) {
    const extByBase = {};
    for (const ext of extensions.values()) {
      if (!extByBase[ext.baseClass]) extByBase[ext.baseClass] = [];
      extByBase[ext.baseClass].push({
        name: `${ext.baseClass}+${ext.file.split('/').pop()?.replace(/\.\w+$/, '')}`,
        file: ext.file,
        methodCount: ext.methods.length,
        kind: ext.kind,
        hasComputedProp: ext.methods.some(m => /\bvar\s+\w+\s*:/.test(m.implementation || '')),
      });
    }
    pipelineCtx.cacheResult('category-scan', 'extByBase', extByBase);
  }

  // ── 仅保留基础类 Extension（Foundation/UIKit），跳过业务代码 ──
  for (const [key, ext] of extensions) {
    if (ext.kind === 'custom') extensions.delete(key);
  }
  if (extensions.size === 0) return [];

  // 扫描使用频次
  const allMethodNames = new Set();
  for (const ext of extensions.values()) {
    for (const m of ext.methods) {
      if (m.name && m.name.length >= 3) allMethodNames.add(m.name);
    }
  }
  const usages = _scanUsages(allFiles, allMethodNames);

  for (const ext of extensions.values()) {
    for (const m of ext.methods) { m._usageCount = usages.get(m.name)?.count || 0; }
    ext.methods.sort((a, b) => b._usageCount - a._usageCount);
  }

  // P4 Fix: 过滤零调用 Extension — 全部方法 0 次调用的扩展无知识价值
  for (const [key, ext] of extensions) {
    const totalCalls = ext.methods.reduce((s, m) => s + m._usageCount, 0);
    if (totalCalls === 0) extensions.delete(key);
  }
  if (extensions.size === 0) return [];

  const results = [];

  // 按源文件分组（extensions Map 的 key 已包含文件路径）
  const byFile = new Map();
  for (const ext of extensions.values()) {
    if (!byFile.has(ext.file)) byFile.set(ext.file, []);
    byFile.get(ext.file).push(ext);
  }

  for (const [filePath, extsInFile] of byFile) {
    // 按 extension 内方法总调用量降序
    extsInFile.sort((a, b) => {
      const aT = a.methods.reduce((s, m) => s + m._usageCount, 0);
      const bT = b.methods.reduce((s, m) => s + m._usageCount, 0);
      return bT - aT;
    });

    const fileName = filePath.split('/').pop() || filePath;
    const mainKind = extsInFile[0].kind;
    const kindLabel = mainKind === 'foundation' ? 'Foundation' : 'UIKit';

    let bodyLines = [];
    let bodyChars = 0;
    let partNum = 1;
    let partMethodCount = 0;
    let partCallCount = 0;

    /** flush 当前 part 为一个 Candidate，重置缓冲区 */
    const flushPart = () => {
      if (bodyLines.length === 0) return;
      const suffix = partNum > 1 ? `-p${partNum}` : '';
      const subTopic = `category/${fileName}${suffix}`;

      results.push({
        title: _makeTitle(DIM_ID, subTopic),
        subTopic,
        code: _buildCandidateDoc({
          heading: `${fileName} Extension 方法清单${partNum > 1 ? ` (Part ${partNum})` : ''}`,
          oneLiner: `${fileName}: ${partMethodCount} 个方法，${partCallCount} 次调用`,
          bodyLines,
          agentNotes: [
            `⛔ 遇到等价功能时 **必须** 使用项目的 ${kindLabel} Extension 方法，禁止手写相同逻辑`,
            `新增 ${kindLabel} 扩展方法前必须检查此清单，避免重复实现`,
            '以上每个方法的「项目调用方式」展示了标准用法 — Agent 必须遵循相同写法',
          ],
        }),
        language: 'swift',
        sources: [filePath],
        summary: `objc-deep-scan/${subTopic} ${fileName} Extension：${partMethodCount} 个方法，${partCallCount} 次调用（Agent 必须优先使用）`,
        knowledgeType: 'code-standard',
        tags: ['extension', mainKind, 'swift'],
        relations: [
          { type: 'ENFORCES', target: _makeTitle('project-profile', 'base-extensions'), description: `${kindLabel} Extension 方法强制规范` },
        ],
      });

      partNum++;
      bodyLines = [];
      bodyChars = 0;
      partMethodCount = 0;
      partCallCount = 0;
    };

    for (const ext of extsInFile) {
      bodyLines.push(`### ${ext.baseClass}`, '');
      bodyChars += 30;

      for (const m of ext.methods) {
        // 估算此方法所需空间
        const methodEstimate = 80 + (m.implementation ? m.implementation.length + 30 : 0) +
          (usages.get(m.name)?.examples || []).reduce((s, ex) => s + ex.code.length + 40, 0);

        // 当前 part 已有内容且再加会超预算 → 先 flush，开启新 part
        if (bodyChars > 0 && bodyChars + methodEstimate > MAX_BODY_CHARS) {
          flushPart();
          bodyLines.push(`### ${ext.baseClass} (续)`, '');
          bodyChars += 40;
        }

        partMethodCount++;
        partCallCount += m._usageCount;

        bodyLines.push(`#### \`func ${m.name}(${m.params})\` — ${m._usageCount} 次调用`, '');
        bodyChars += 80;
        if (m.implementation) {
          bodyLines.push('实现代码：', '```swift', m.implementation, '```', '');
          bodyChars += m.implementation.length + 30;
        }
        const usageInfo = usages.get(m.name);
        if (usageInfo && usageInfo.examples.length > 0) {
          bodyLines.push('项目调用方式：', '```swift');
          for (const ex of usageInfo.examples) {
            bodyLines.push(`// ── ${ex.file}:L${ex.lineNum} ──`);
            bodyLines.push(ex.code);
            bodyChars += ex.code.length + 40;
          }
          bodyLines.push('```', '');
        }
      }
    }

    // flush 剩余内容
    flushPart();
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
//  子主题 3: swizzle-hooks — Method Swizzling 全量扫描
//  核心变化：展示完整 swizzle 实现代码，不仅仅是表格
// ═══════════════════════════════════════════════════════════

function _extractSwizzleHooks(allFiles, lang, pipelineCtx) {
  const results = [];
  const selectorRe = /@selector\(([^)]+)\)/g;
  const classGetRe = /class_getInstanceMethod\s*\(\s*(?:\[?\s*(\w+)\s+class\]?|(\w+))\s*,\s*@selector\(([^)]+)\)\s*\)/g;

  const hookEntries = [];

  for (const f of allFiles) {
    if (_isThirdPartyFile(f)) continue;
    if (!/\.(m|mm)$/i.test(f.name || '')) continue;
    if (!/method_exchangeImplementations|class_replaceMethod|method_setImplementation|swizzl/i.test(f.content)) continue;

    const fileLines = f.content.split('\n');

    for (let i = 0; i < fileLines.length; i++) {
      if (!/method_exchangeImplementations|class_replaceMethod|method_setImplementation/i.test(fileLines[i])) continue;

      // 提取完整方法体作为代码块（extractEnclosingBlock 直接返回数组）
      const codeBlock = extractEnclosingBlock(fileLines, i, lang, 50)
        || fileLines.slice(Math.max(0, i - 8), Math.min(fileLines.length, i + 15));

      const blockText = codeBlock.join('\n');

      // 提取 selector 信息
      const selectors = [];
      const classNames = new Set();
      let match;

      const classGetReL = new RegExp(classGetRe.source, 'g');
      while ((match = classGetReL.exec(blockText)) !== null) {
        if (match[1]) classNames.add(match[1]);
        if (match[2]) classNames.add(match[2]);
        if (match[3]) selectors.push(match[3]);
      }

      const selReL = new RegExp(selectorRe.source, 'g');
      while ((match = selReL.exec(blockText)) !== null) {
        if (!selectors.includes(match[1])) selectors.push(match[1]);
      }

      // 时机检测
      let timing = 'unknown';
      if (/\+\s*(?:\(void\))?\s*load\b/.test(blockText)) timing = '+load';
      else if (/\+\s*(?:\(void\))?\s*initialize\b/.test(blockText)) timing = '+initialize';
      else if (/dispatch_once|didFinishLaunching|viewDidLoad|awakeFromNib/.test(blockText)) timing = 'runtime';

      // 所在类
      let hostClass = [...classNames][0] || null;
      if (!hostClass) {
        for (let j = i; j >= Math.max(0, i - 100); j--) {
          const implMatch = fileLines[j].match(/^@implementation\s+(\w+)/);
          if (implMatch) { hostClass = implMatch[1]; break; }
        }
      }

      // 限制代码块长度
      const displayCode = codeBlock.length > 35
        ? [...codeBlock.slice(0, 33), '    // ... (更多代码省略)', '}']
        : codeBlock;

      const entry = {
        file: f.relativePath,
        className: hostClass || 'unknown',
        originalSel: selectors[0] || 'unknown',
        swizzledSel: selectors[1] || selectors[0] || 'unknown',
        timing,
        codeBlock: displayCode,
        line: i + 1,
      };

      if (!hookEntries.find(h => h.file === entry.file && h.line === entry.line)) {
        hookEntries.push(entry);
      }
    }
  }

  // 扫描 Aspects / JRSwizzle 等第三方封装（跳过三方库内部文件）
  const thirdPartyHooks = [];
  for (const f of allFiles) {
    if (_isThirdPartyFile(f)) continue;
    if (!/\.(m|mm)$/i.test(f.name || '')) continue;
    if (!/aspect_hook|jr_swizzle|rs_swizzle/i.test(f.content)) continue;
    const fileLines = f.content.split('\n');
    for (let i = 0; i < fileLines.length; i++) {
      const aspMatch = fileLines[i].match(/\[\s*(\w+)\s+aspect_hook(?:Selector)?:\s*@selector\(([^)]+)\)/);
      if (aspMatch) {
        const aspBlock = extractEnclosingBlock(fileLines, i, lang, 30);
        thirdPartyHooks.push({
          file: f.relativePath, className: aspMatch[1],
          originalSel: aspMatch[2], swizzledSel: `aspect_hook(${aspMatch[2]})`,
          timing: 'runtime', framework: 'Aspects',
          codeBlock: aspBlock ? aspBlock.slice(0, 30) : fileLines.slice(Math.max(0, i - 3), i + 10),
          line: i + 1,
        });
      }
      const jrMatch = fileLines[i].match(/jr_swizzleMethod:\s*@selector\(([^)]+)\)\s+withMethod:\s*@selector\(([^)]+)\)/);
      if (jrMatch) {
        thirdPartyHooks.push({
          file: f.relativePath, className: 'unknown',
          originalSel: jrMatch[1], swizzledSel: jrMatch[2],
          timing: 'runtime', framework: 'JRSwizzle',
          codeBlock: fileLines.slice(Math.max(0, i - 3), i + 5),
          line: i + 1,
        });
      }
    }
  }

  const allHooks = [...hookEntries, ...thirdPartyHooks];

  // ── 缓存中间结果到 PipelineContext（供 project-profile/event-hooks 复用）──
  if (pipelineCtx) {
    pipelineCtx.cacheResult('objc-deep-scan', 'swizzle', {
      hookEntries,
      thirdPartyHooks,
      allHooks,
    });
  }

  if (allHooks.length === 0) return results;

  // ── 构建 Candidate ──
  const bodyLines = [
    `> 项目中共检测到 **${allHooks.length}** 处 Method Swizzling hook`,
    '',
  ];

  // 总览表
  bodyLines.push('## Hook 总览', '');
  bodyLines.push('| 所在类 | 原始方法 | 替换方法 | 时机 | 文件 |', '|--------|---------|---------|------|------|');
  for (const h of allHooks) {
    const fw = h.framework ? ` (${h.framework})` : '';
    bodyLines.push(`| \`${h.className}\` | \`${h.originalSel}\` | \`${h.swizzledSel}\`${fw} | ${h.timing} | ${h.file}:L${h.line} |`);
  }
  bodyLines.push('');

  // 每个 hook 的完整实现代码
  bodyLines.push('## 实现代码', '');
  let bodyChars = bodyLines.join('\n').length;

  for (const h of allHooks) {
    const fw = h.framework ? ` [${h.framework}]` : '';
    bodyLines.push(`### ${h.className} — \`${h.originalSel}\` → \`${h.swizzledSel}\`${fw}`, '');
    bodyLines.push(`文件：${h.file}:L${h.line}，时机：${h.timing}`, '');
    bodyChars += 120;

    if (bodyChars > MAX_BODY_CHARS) {
      bodyLines.push('> *(实现代码省略 — 体积预算已满)*', '');
      continue;
    }

    if (h.codeBlock && h.codeBlock.length > 0) {
      bodyLines.push('```objectivec');
      for (const line of h.codeBlock) {
        bodyLines.push(line);
        bodyChars += line.length + 1;
      }
      bodyLines.push('```', '');
    }
  }

  results.push({
    title: _makeTitle(DIM_ID, 'swizzle-hooks'),
    subTopic: 'swizzle-hooks',
    code: _buildCandidateDoc({
      heading: 'Method Swizzling Hook 全量清单',
      oneLiner: `${allHooks.length} 处 Method Swizzling hook（${hookEntries.length} 处原生 + ${thirdPartyHooks.length} 处三方封装）`,
      bodyLines,
      agentNotes: [
        '⚠️ 每一处 Swizzle 都是运行时行为变更点 — 修改被 Hook 的方法时 **必须** 同时检查 Swizzle 替换实现',
        '⛔ 禁止在不了解已有 Hook 的情况下修改被 Hook 方法的签名或行为',
        '新增 Swizzle 前检查是否已有对同一方法的 Hook，避免 Hook 冲突',
        '+load 中的 Swizzle 会在 App 启动时最先执行 — 影响启动性能，谨慎增加',
        '使用 dispatch_once 确保 Swizzle 只执行一次，防止二次交换导致恢复原实现',
        '以上实现代码展示了项目的 Swizzle 写法 — 新增 Hook 必须遵循相同编码风格',
      ],
      relationLines: [
        'RELATED: [project-profile/event-hooks] — Hook 与生命周期事件关联',
        'PREREQUISITE: [agent-guidelines] — Agent 修改被 Hook 方法前必须查阅此清单',
      ],
    }),
    language: 'objectivec',
    sources: [...new Set(allHooks.map(h => h.file))].slice(0, 20),
    summary: `objc-deep-scan/swizzle-hooks Method Swizzling：${allHooks.length} 处 hook — 含完整实现代码（Agent 修改被 hook 方法前必须查阅）`,
    knowledgeType: 'code-pattern',
    tags: ['swizzle', 'hook', 'runtime', 'method-exchange'],
    relations: [
      { type: 'RELATED', target: _makeTitle('project-profile', 'event-hooks'), description: 'Hook 与生命周期事件关联' },
      { type: 'PREREQUISITE', target: _makeTitle('agent-guidelines', 'coding-principles'), description: 'Agent 修改被 Hook 方法前必须查阅' },
    ],
  });

  return results;
}

// ═══════════════════════════════════════════════════════════
//  主入口
// ═══════════════════════════════════════════════════════════

/**
 * ObjC/Swift 深度扫描维度提取器
 *
 * 产出精细粒度 Candidate（→ 可升级为 Recipe → 生成 Snippet）。
 * 同时 dualOutput=true 使其也被聚合为 Project Skill。
 *
 * 与 project-profile 的区别：
 *   - project-profile 做概览统计（X 个宏，N 个 Category）
 *   - 本维度做 **逐项全量** + **项目使用方式**（代码 + 频次）
 *
 * @param {object[]} allFiles
 * @param {string} lang — 'objectivec' | 'swift'
 * @param {object|null} ast
 * @returns {object[]} Candidate 数组
 */
export function _extractObjcDeepScan(allFiles, lang, ast, pipelineCtx) {
  const results = [];

  // 1. #define + 静态常量全量扫描（含使用频次与项目写法）
  results.push(..._extractDefinesAndConstants(allFiles, lang, pipelineCtx));

  // 2. Method Swizzling hook 全量扫描（含完整实现代码）
  if (lang === 'objectivec') {
    results.push(..._extractSwizzleHooks(allFiles, lang, pipelineCtx));
  }

  return results;
}

/**
 * ⑨ Foundation/UIKit Category/Extension 专项扫描（独立维度）
 * 仅基础类分类方法，不含业务代码
 */
export function _extractCategoryScan(allFiles, lang, pipelineCtx) {
  return _extractCategoryMethods(allFiles, lang, pipelineCtx);
}
