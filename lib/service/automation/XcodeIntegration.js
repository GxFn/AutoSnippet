/**
 * XcodeIntegration — Xcode IDE 自动化插入
 *
 * 完全按照 V1 逻辑重新实现，覆盖：
 *  - V1 ImportWriterV2._writeImportLineXcode    单条 import Xcode osascript 自动插入
 *  - V1 ImportWriterV2._writeImportLine          文件写入回退
 *  - V1 ImportWriterV2._checkImportStatus        三级 import 去重
 *  - V1 ImportWriterV2._withAutoSnippetNote      自动插入注释后缀
 *  - V1 HeaderHandler._collectImportsFromFile    收集已有 imports
 *  - V1 HeaderHandler._collectImportsFromHeaderFile  收集 .h 对应 imports
 *  - V1 HeaderHandler.computePasteLineNumber     偏移计算
 *  - V1 HeaderHandler._getLastImportLine         最后 import 行号
 *  - V1 SearchHandler: cut → preflight → insert headers → offset → paste code
 *  - V1 injectionService: SPM 依赖检查 + block/review/continue 决策
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, relative, resolve as pathResolve, sep } from 'node:path';
import { saveEventFilter } from './SaveEventFilter.js';

// ═══════════════════════════════════════════════════════════════
// 常量与工具
// ═══════════════════════════════════════════════════════════════

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 附加 AutoSnippet 自动插入注释（V1 ImportWriterV2._withAutoSnippetNote）
 */
function _withAutoSnippetNote(importLine) {
  if (!importLine) return importLine;
  const note = '// AutoSnippet: 自动插入';
  if (importLine.includes(note)) return importLine;
  return `${importLine} ${note}`;
}

/**
 * 解析原始 header 字符串，提取 moduleName 和 headerName
 *
 * 支持格式：
 *   #import <Module/Header.h>  → { moduleName: 'Module', headerName: 'Header.h', isAngle: true }
 *   #import "Header.h"          → { moduleName: '', headerName: 'Header.h', isAngle: false }
 *   @import Module;             → { moduleName: 'Module', headerName: '', isAngle: false, isAtImport: true }
 *   import Module (Swift)       → { moduleName: 'Module', headerName: '', isAngle: false, isSwiftImport: true }
 *   Header.h                    → { moduleName: '', headerName: 'Header.h', isAngle: false, isRaw: true }
 */
function _parseHeaderString(header) {
  const t = header.trim();
  // #import <Module/Header.h>
  let m = t.match(/^#(?:import|include)\s+<([^/> ]+)\/([^>]+)>/);
  if (m) return { moduleName: m[1], headerName: m[2], isAngle: true };
  // #import <Module>  (framework umbrella)
  m = t.match(/^#(?:import|include)\s+<([^>]+)>/);
  if (m) return { moduleName: m[1], headerName: '', isAngle: true };
  // #import "Header.h" or #import "Dir/Header.h"
  m = t.match(/^#(?:import|include)\s+"([^"]+)"/);
  if (m) {
    const parts = m[1].split('/');
    return { moduleName: '', headerName: parts[parts.length - 1], isAngle: false, quotedPath: m[1] };
  }
  // @import Module;
  m = t.match(/^@import\s+(\w+)/);
  if (m) return { moduleName: m[1], headerName: '', isAngle: false, isAtImport: true };
  // import Module (Swift)
  m = t.match(/^import\s+(\w+)/);
  if (m && !['class', 'struct', 'enum', 'protocol', 'func', 'var', 'let'].includes(m[1])) {
    return { moduleName: m[1], headerName: '', isAngle: false, isSwiftImport: true };
  }
  // 裸 header 名: Header.h
  if (/\.(h|hpp|hh)$/i.test(t)) {
    return { moduleName: '', headerName: t, isAngle: false, isRaw: true };
  }
  return { moduleName: '', headerName: t, isAngle: false, isRaw: true };
}

/**
 * 在 target 源目录中搜索头文件，返回相对于当前文件的路径
 *（V1 injectionService 同目录/子目录相对路径逻辑）
 *
 * 搜索策略：
 *   1. 当前文件同目录
 *   2. 从项目根目录递归查找（最多深度 6 层，只搜 Sources/ 下）
 *   3. 找到后计算相对于当前文件目录的路径
 *
 * @param {string} headerName - 头文件名 (如 "Foo.h")
 * @param {string} currentFilePath - 当前正在编辑的文件绝对路径
 * @param {string} [projectRoot] - 项目根目录
 * @returns {string|null} 相对路径 (如 "Foo.h" 或 "../SubDir/Foo.h")，null 表示未找到
 */
function _findHeaderRelativePath(headerName, currentFilePath, projectRoot) {
  if (!headerName || !currentFilePath) return null;
  try {
    const currentDir = dirname(currentFilePath);

    // 1. 同目录检查
    const sameDir = pathResolve(currentDir, headerName);
    if (existsSync(sameDir)) return headerName;

    // 2. 向上找 Sources/ 或 target 根目录，在其下递归搜索
    const searchRoots = [];
    if (projectRoot) {
      const sourcesDir = pathResolve(projectRoot, 'Sources');
      if (existsSync(sourcesDir)) searchRoots.push(sourcesDir);
      searchRoots.push(projectRoot);
    }
    // 也从当前文件向上找 Sources 目录
    let dir = currentDir;
    for (let i = 0; i < 8; i++) {
      const base = basename(dir);
      if (base === 'Sources' || base === 'Source' || base === 'src') {
        searchRoots.unshift(dir);
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    // 在 searchRoots 中递归查找 headerName（限深度 6）
    for (const root of searchRoots) {
      const found = _findFileRecursive(root, headerName, 6);
      if (found) {
        let rel = relative(currentDir, found);
        // 统一用 / 分隔
        rel = rel.split(sep).join('/');
        return rel;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 递归查找文件（限最大深度）
 */
function _findFileRecursive(dir, fileName, maxDepth) {
  if (maxDepth <= 0) return null;
  try {
    const entries = readdirSync(dir);
    // 先在当前层查找
    for (const e of entries) {
      if (e === fileName) return pathResolve(dir, e);
    }
    // 再递归子目录（跳过隐藏目录和常见无关目录）
    for (const e of entries) {
      if (e.startsWith('.') || e === 'node_modules' || e === 'build' || e === 'DerivedData') continue;
      const full = pathResolve(dir, e);
      try {
        if (statSync(full).isDirectory()) {
          const found = _findFileRecursive(full, fileName, maxDepth - 1);
          if (found) return found;
        }
      } catch { /* 跳过不可访问的目录 */ }
    }
  } catch { /* 跳过不可读目录 */ }
  return null;
}

/**
 * 根据当前文件 target 和 header 的 module 关系，生成正确格式的 import 行
 *（V1 ImportWriterV2._buildImportLine + injectionService.handleHeaderLine 等价）
 *
 * 规则:
 *   Swift: 始终 `import Module`（无 quote/angle 区别）
 *   ObjC 同 target:  `#import "Header.h"` （引号格式）
 *   ObjC 跨 target:  `#import <Module/Header.h>` （尖括号格式）
 *   @import 格式保持原样（已经模块级）
 *
 * @param {string} rawHeader  原始 header 字符串
 * @param {object} ctx        { currentTarget, headerModuleName, isSwift, fullPath, projectRoot }
 *   - currentTarget:    当前文件所属的 target 名
 *   - headerModuleName: header 所属的 module/target 名（来自 recipe.moduleName 或推断）
 *   - isSwift:          目标文件是否是 Swift
 *   - fullPath:         当前编辑文件的绝对路径（用于计算同 target 相对路径）
 *   - projectRoot:      项目根目录（用于搜索头文件物理位置）
 * @returns {string} 格式化后的完整 import 行
 */
function _resolveHeaderFormat(rawHeader, ctx) {
  const { currentTarget, headerModuleName, isSwift, fullPath, projectRoot } = ctx;
  const parsed = _parseHeaderString(rawHeader);

  // Swift: 始终 `import Module`
  if (isSwift || parsed.isSwiftImport) {
    // 已经是完整 swift import 语句
    if (parsed.isSwiftImport) return rawHeader.trim();
    // 从 ObjC 格式推断 swift import
    const mod = parsed.moduleName || headerModuleName || '';
    if (mod) return `import ${mod}`;
    return rawHeader.trim(); // 无法推断，原样返回
  }

  // @import 保持原样（模块级引用不受 target 影响）
  if (parsed.isAtImport) return rawHeader.trim();

  // 已经是尖括号格式 → 保持（明确的跨模块引用）
  if (parsed.isAngle) return rawHeader.trim();

  // ── ObjC: 判断同 target vs 跨 target ──
  const effectiveModule = parsed.moduleName || headerModuleName || '';

  // 如果没有 target 信息，无法判断，保持原样
  if (!currentTarget || !effectiveModule) return rawHeader.trim();

  const isSameTarget = currentTarget === effectiveModule;

  if (isSameTarget) {
    // 同 target → 引号格式，计算相对路径（V1 injectionService 同目录/子目录逻辑）
    if (parsed.headerName && fullPath) {
      const relPath = _findHeaderRelativePath(parsed.headerName, fullPath, projectRoot);
      if (relPath) return `#import "${relPath}"`;
    }
    if (parsed.quotedPath) return `#import "${parsed.quotedPath}"`;
    if (parsed.headerName) return `#import "${parsed.headerName}"`;
    return rawHeader.trim();
  }

  // 跨 target → 尖括号格式 <Module/Header.h>
  if (parsed.headerName) {
    return `#import <${effectiveModule}/${parsed.headerName}>`;
  }
  // 没有 headerName（裸模块名），用 @import
  return `@import ${effectiveModule};`;
}

/** 常见 Apple 系统框架（无需 SPM 依赖检查） */
const _SYSTEM_FRAMEWORKS = new Set([
  'Foundation', 'UIKit', 'AppKit', 'SwiftUI', 'Combine', 'CoreFoundation',
  'CoreGraphics', 'CoreData', 'CoreAnimation', 'CoreLocation', 'CoreMedia',
  'CoreImage', 'CoreText', 'CoreVideo', 'QuartzCore', 'AVFoundation',
  'AVKit', 'WebKit', 'MapKit', 'Metal', 'MetalKit', 'ARKit', 'SceneKit',
  'SpriteKit', 'GameKit', 'GameplayKit', 'HealthKit', 'HomeKit', 'CloudKit',
  'StoreKit', 'PhotosUI', 'Photos', 'Contacts', 'ContactsUI', 'EventKit',
  'UserNotifications', 'MessageUI', 'MultipeerConnectivity', 'NetworkExtension',
  'SafariServices', 'AuthenticationServices', 'LocalAuthentication',
  'Security', 'CryptoKit', 'Accelerate', 'os', 'Darwin', 'ObjectiveC',
  'Dispatch', 'XCTest',
]);

// ═══════════════════════════════════════════════════════════════
// V1 Import 去重（ImportWriterV2._checkImportStatus）
// ═══════════════════════════════════════════════════════════════

/**
 * 从文件中收集已有的 import 语句
 * （V1 HeaderHandler._collectImportsFromFile）
 */
function _collectImportsFromFile(filePath, isSwift) {
  try {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const imports = [];
    for (const line of lines) {
      const t = line.trim();
      if (isSwift) {
        if (t.startsWith('import ')) imports.push(t);
      } else {
        if (t.startsWith('#import ') || t.startsWith('@import ') || t.startsWith('#include ')) {
          imports.push(t);
        }
      }
    }
    return imports;
  } catch {
    return [];
  }
}

/**
 * 收集 .m 文件对应 .h 文件的 imports
 * （V1 HeaderHandler._collectImportsFromHeaderFile）
 */
function _collectImportsFromHeaderFile(sourcePath, importArray) {
  const dotIndex = sourcePath.lastIndexOf('.');
  if (dotIndex <= 0) return;
  const headerPath = sourcePath.substring(0, dotIndex) + '.h';
  const importReg = /^#import\s*<[A-Za-z0-9_]+\/[A-Za-z0-9_+.-]+\.h>$/;
  try {
    if (!existsSync(headerPath)) return;
    const data = readFileSync(headerPath, 'utf8');
    for (const line of data.split('\n')) {
      const t = line.trim();
      if (importReg.test(t) && !importArray.includes(t)) {
        importArray.push(t);
      }
    }
  } catch { /* ignore */ }
}

/**
 * 三级 import 去重检查（V1 ImportWriterV2._checkImportStatus 完整逻辑）
 *
 *   hasHeader        精确匹配（同一 import 行）
 *   hasModule        模块级匹配（同模块不同头文件，或 @import）
 *   hasSimilarHeader 文件名 case-insensitive 匹配
 *
 * @param {string[]} importArray 已有的 import 行
 * @param {string}   headerLine 待插入的 import 行
 * @param {boolean}  isSwift
 */
function _checkImportStatus(importArray, headerLine, isSwift) {
  const trimmed = headerLine.trim();

  // 提取 module / headerFileName
  let moduleName = '';
  let headerFileName = '';

  if (isSwift) {
    const m = trimmed.match(/^import\s+(\w+)/);
    if (m) moduleName = m[1];
    headerFileName = moduleName;
  } else {
    const angle = trimmed.match(/<([^/]+)\/([^>]+)>/);
    if (angle) {
      moduleName = angle[1];
      headerFileName = angle[2];
    }
    const quote = trimmed.match(/"([^"]+)"/);
    if (quote) {
      headerFileName = basename(quote[1]);
    }
  }

  const headerFileNameLower = headerFileName.toLowerCase();

  for (const imp of importArray) {
    const impT = imp.trim();

    // ── 级别 1: 精确匹配（V1 importHeader === headNameToCheck） ──
    if (impT === trimmed) {
      return { hasHeader: true, hasModule: false, hasSimilarHeader: false };
    }
    // 去掉可能的 AutoSnippet 注释后缀再比较
    const impTClean = impT.replace(/\s*\/\/\s*AutoSnippet.*$/, '').trim();
    if (impTClean === trimmed) {
      return { hasHeader: true, hasModule: false, hasSimilarHeader: false };
    }

    if (isSwift) {
      // ── 级别 2: Swift 模块匹配 ──
      const m2 = impT.match(/^import\s+(\w+)/);
      if (m2 && m2[1] === moduleName) {
        return { hasHeader: false, hasModule: true, hasSimilarHeader: false };
      }
    } else {
      // ── 级别 2: ObjC 模块匹配（<Module/xxx> 或 @import Module） ──
      if (moduleName) {
        const impAngle = impT.match(/<([^/]+)\//);
        if (impAngle && impAngle[1] === moduleName) {
          return { hasHeader: false, hasModule: true, hasSimilarHeader: false };
        }
        const impAt = impT.match(/@import\s+(\w+)/);
        if (impAt && impAt[1] === moduleName) {
          return { hasHeader: false, hasModule: true, hasSimilarHeader: false };
        }
      }

      // ── 级别 3: 相似头文件名匹配（case-insensitive） ──
      if (headerFileNameLower) {
        let importedFileName = null;
        const a = impT.match(/<[^/]+\/([^>]+)>/);
        if (a) importedFileName = a[1].toLowerCase();
        const q = impT.match(/"([^"]+)"/);
        if (q) importedFileName = basename(q[1]).toLowerCase();
        if (importedFileName && importedFileName === headerFileNameLower) {
          return { hasHeader: false, hasModule: false, hasSimilarHeader: true };
        }
      }
    }
  }

  return { hasHeader: false, hasModule: false, hasSimilarHeader: false };
}

// ═══════════════════════════════════════════════════════════════
// V1 模块推断
// ═══════════════════════════════════════════════════════════════

/**
 * 从 import 语句推断模块名
 *
 *   #import <Module/Header.h>  → Module
 *   @import Module;            → Module
 *   import Module (Swift)      → Module
 *   #import "Local.h"          → null
 */
function _inferModulesFromHeaders(headers) {
  const modules = new Set();
  for (const h of headers) {
    const t = h.trim();
    let m;
    m = t.match(/^#import\s+<([^/> ]+)/);
    if (m) { modules.add(m[1]); continue; }
    m = t.match(/^@import\s+(\w+)/);
    if (m) { modules.add(m[1]); continue; }
    m = t.match(/^import\s+(\w+)/);
    if (m && !['class', 'struct', 'enum', 'protocol'].includes(m[1])) {
      modules.add(m[1]);
    }
  }
  return [...modules];
}

// ═══════════════════════════════════════════════════════════════
// V1 SPM 依赖检查决策引擎（ImportDecisionEngine.evaluate）
// ═══════════════════════════════════════════════════════════════

/**
 * 将 SpmService.ensureDependency 返回值映射为三种动作：
 *   continue — 依赖已存在
 *   block    — 循环/反向依赖，禁止插入
 *   review   — 依赖缺失但可添加，需用户确认
 */
function _evaluateDepResult(ensureResult, from, to) {
  if (ensureResult.exists) return { action: 'continue' };
  if (!ensureResult.canAdd) {
    return { action: 'block', reason: ensureResult.reason || 'cycleBlocked', from, to };
  }
  return { action: 'review', reason: ensureResult.reason || 'missingDependency', from, to };
}

/**
 * 公共依赖审查弹窗逻辑（insertHeaders 和 _preflightDeps 共享）
 *
 * @param {object} ctx - { spmService, currentTarget, mod, ensureResult, NU, depWarnings, label }
 * @returns {{ blocked: boolean }}
 */
function _handleDepReview(ctx) {
  const { spmService, currentTarget, mod, ensureResult, NU, depWarnings, label = '' } = ctx;

  const fixMode = spmService.getFixMode();
  const buttons = fixMode === 'fix'
    ? ['直接插入（信任架构）', '提示操作插入', '自动修复依赖', '取消操作']
    : ['直接插入（信任架构）', '提示操作插入', '取消操作'];

  const crossTag = ensureResult.crossPackage ? ' (跨包)' : '';
  const prefix = label ? `[${label}] ` : '';
  console.log(`  ⚠️  ${prefix}依赖缺失: ${currentTarget} -> ${mod}`);

  const userChoice = NU.promptWithButtons(
    `检测到依赖缺失：${currentTarget} -> ${mod}${crossTag}\n\n请选择处理方式：`,
    buttons,
    'AutoSnippet SPM 依赖决策',
  );

  if (userChoice === '取消操作' || (!userChoice && !['直接插入（信任架构）', '提示操作插入', '自动修复依赖'].includes(userChoice))) {
    return { blocked: true };
  }

  if (userChoice === '提示操作插入') {
    console.log(`  📋 ${prefix}提示操作：依赖缺失 ${currentTarget} -> ${mod}`);
    depWarnings.set(mod, `${currentTarget} -> ${mod}`);
  }

  if (userChoice === '自动修复依赖') {
    const fixResult = spmService.addDependency(currentTarget, mod);
    if (fixResult.ok) {
      console.log(`  ✅ ${prefix}已自动补齐依赖: ${currentTarget} -> ${mod}${fixResult.crossPackage ? ' (跨包)' : ''} (${fixResult.file})`);
      NU.notify(`已补齐依赖：${currentTarget} -> ${mod}`, 'AutoSnippet SPM');
    } else {
      console.warn(`  ⚠️ ${prefix}自动修复失败: ${fixResult.error}，继续插入`);
      depWarnings.set(mod, `${currentTarget} -> ${mod}`);
    }
  }

  return { blocked: false };
}

// ═══════════════════════════════════════════════════════════════
// V1 Xcode osascript 单条 import 写入（ImportWriterV2._writeImportLineXcode）
// ═══════════════════════════════════════════════════════════════

/**
 * 通过 Xcode 自动化插入一条 import，保持 Xcode Undo 可用。
 *
 * V1 逻辑：
 *   1. 保存剪贴板
 *   2. 写入 import 内容 + \n 到剪贴板
 *   3. osascript: jump to insertLine → Cmd+← → Cmd+V
 *   4. 恢复剪贴板
 *
 * @param {string} importLine  完整的 import 文本
 * @param {number} insertLine  1-based 行号（V1: lastImportIdx + 2）
 * @param {object} XA          XcodeAutomation 模块
 * @param {object} CM          ClipboardManager 模块
 * @returns {boolean}
 */
function _writeImportLineXcode(importLine, insertLine, XA, CM) {
  if (!XA.isXcodeRunning()) return false;
  try {
    const contentToWrite = String(importLine).trim() + '\n';
    const previousClipboard = CM.read();

    CM.write(contentToWrite);
    const ok = XA.insertAtLineStartInXcode(insertLine);

    // V1: 始终恢复剪贴板
    if (typeof previousClipboard === 'string') {
      CM.write(previousClipboard);
    }
    return ok;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// V1 文件写入回退（ImportWriterV2._writeImportLine readline path）
// ═══════════════════════════════════════════════════════════════

/**
 * 纯文件写入插入单条 import。
 * Xcode 会因文件变更而自动 reload。
 */
function _writeImportLineFile(filePath, importLine, isSwift) {
  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    let lastImportIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (isSwift) {
        if (t.startsWith('import ') && !t.startsWith('import (')) lastImportIdx = i;
      } else {
        if (t.startsWith('#import ') || t.startsWith('#include ') || t.startsWith('@import ')) {
          lastImportIdx = i;
        }
      }
    }
    const insertAt = lastImportIdx >= 0 ? lastImportIdx + 1 : 0;
    lines.splice(insertAt, 0, importLine);
    const newContent = lines.join('\n');
    saveEventFilter.markWrite(filePath, newContent);
    writeFileSync(filePath, newContent, 'utf8');
    return true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// V1 computePasteLineNumber（HeaderHandler.computePasteLineNumber）
// ═══════════════════════════════════════════════════════════════

/**
 * 查找文件中最后一个 import 行的行号（1-based，0 表示无 import）
 * （V1 HeaderHandler._getLastImportLine）
 */
function _getLastImportLine(filePath) {
  try {
    if (!existsSync(filePath)) return 0;
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    let lastIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t.startsWith('#import ') || t.startsWith('@import ')
        || t.startsWith('#include ') || t.startsWith('import ')) {
        lastIdx = i;
      }
    }
    return lastIdx >= 0 ? lastIdx + 1 : 0;
  } catch {
    return 0;
  }
}

/**
 * 计算代码粘贴行号（V1 HeaderHandler.computePasteLineNumber 完整逻辑）
 *
 * 如果 headers 插入在 trigger 行之前（import 区），trigger 行号需要向下偏移。
 */
function _computePasteLineNumber(triggerLineNumber, headerInsertCount, filePath, options = {}) {
  const expectedCount = Number.isFinite(options.expectedHeaderCount)
    ? options.expectedHeaderCount
    : headerInsertCount;
  if (expectedCount > 0) {
    if (options.forceOffset) {
      return triggerLineNumber + expectedCount;
    }
    const headerInsertPosition = _getLastImportLine(filePath);
    if (headerInsertPosition > 0 && headerInsertPosition < triggerLineNumber) {
      return triggerLineNumber + expectedCount;
    }
  }
  return triggerLineNumber;
}

// ═══════════════════════════════════════════════════════════════
// 主要导出：insertHeaders
// ═══════════════════════════════════════════════════════════════

/**
 * 统一的头文件插入方法（V1 HeaderHandler.handleHeadersBatch 完整流程）
 *
 * 逐条处理：
 *   1. 三级去重（V1 _checkImportStatus）
 *   2. SPM 依赖检查（V1 injectionService + ImportDecisionEngine）
 *   3. Xcode osascript 自动插入（V1 _writeImportLineXcode），失败则文件写入回退
 *   4. 附加 AutoSnippet 注释后缀
 *
 * @param {import('./FileWatcher.js').FileWatcher} watcher
 * @param {string}   fullPath  目标文件绝对路径
 * @param {string[]} headers   待插入的 import 行数组
 * @param {object}   [opts]
 * @returns {Promise<{inserted: string[], skipped: string[], cancelled: boolean}>}
 */
export async function insertHeaders(watcher, fullPath, headers, opts = {}) {
  const XA = await import('../../infrastructure/external/XcodeAutomation.js');
  const CM = await import('../../infrastructure/external/ClipboardManager.js');
  const NU = await import('../../infrastructure/external/NativeUi.js');

  const result = { inserted: [], skipped: [], cancelled: false };
  /** @type {Map<string, string>} 模块名 → 提示注释（'提示操作插入'按钮选择时记录） */
  const depWarnings = opts.depWarnings instanceof Map ? new Map(opts.depWarnings) : new Map();
  if (!headers || headers.length === 0) return result;

  const isSwift = opts.isSwift ?? fullPath.endsWith('.swift');

  // ── V1 Step 1: 收集已有 imports ──
  const importArray = _collectImportsFromFile(fullPath, isSwift);
  // V1: .m 文件还要收集对应 .h 的 imports
  if (!isSwift && !fullPath.endsWith('.h')) {
    _collectImportsFromHeaderFile(fullPath, importArray);
  }

  // ── V1 Step 2: SPM 服务准备 ──
  // 优先复用 opts 传入的 spmService/currentTarget（避免与 _preflightDeps 重复 load）
  let spmService = opts._spmService || null;
  let currentTarget = opts._currentTarget || null;
  if (!spmService && !opts.skipDepCheck) {
    const inferredModules = _inferModulesFromHeaders(headers);
    if (opts.moduleName && !inferredModules.includes(opts.moduleName)) {
      inferredModules.push(opts.moduleName);
    }
    const thirdPartyModules = inferredModules.filter(m => !_SYSTEM_FRAMEWORKS.has(m));
    if (thirdPartyModules.length > 0) {
      try {
        const { ServiceContainer } = await import('../../injection/ServiceContainer.js');
        const container = ServiceContainer.getInstance();
        spmService = container.get('spmService');
        if (spmService) {
          if (spmService.getFixMode() === 'off') {
            spmService = null;
          } else {
            try { await spmService.load(); } catch { /* Package.swift 不存在则跳过 */ }
            currentTarget = spmService.resolveCurrentTarget(fullPath);
          }
        }
      } catch { /* SPM 检查异常不阻断 */ }
    }
  }

  // ── V1 Step 3: Xcode 自动化准备 ──
  const xcodeReady = XA.isXcodeRunning();
  // 从当前文件内容计算 import 插入基准行（1-based）
  let content;
  try { content = readFileSync(fullPath, 'utf8'); } catch { return result; }
  const baseInsertLine = findImportInsertLine(content, isSwift) + 1; // 0-based → 1-based
  let xcodeOffset = 0;      // 每次 Xcode 插入成功后 +1（修正多条 header 行号偏移）
  let fileWriteUsed = false; // 一旦使用文件写入，后续全部走文件写入（避免 Xcode reload 冲突）

  // ── V1 Step 4: 逐条处理 ──
  for (const header of headers) {
    const headerTrimmed = header.trim();
    if (!headerTrimmed) continue;

    // ── 三级去重（V1 ImportWriterV2._checkImportStatus） ──
    // 先按原始格式检查，再按解析后格式检查（同一 header 可能格式不同）
    const preResolvedHeader = _resolveHeaderFormat(headerTrimmed, {
      currentTarget,
      headerModuleName: opts.moduleName || null,
      isSwift,
      fullPath,
      projectRoot: watcher?.projectRoot || null,
    });
    const status = _checkImportStatus(importArray, headerTrimmed, isSwift);
    const statusResolved = (preResolvedHeader !== headerTrimmed)
      ? _checkImportStatus(importArray, preResolvedHeader, isSwift)
      : status;
    if (status.hasHeader || statusResolved.hasHeader) {
      console.log(`     ⏭️  已存在（精确匹配）: ${preResolvedHeader}`);
      result.skipped.push(preResolvedHeader);
      continue;
    }
    if (status.hasModule || statusResolved.hasModule) {
      console.log(`     ⏭️  已存在（模块匹配）: ${preResolvedHeader}`);
      result.skipped.push(preResolvedHeader);
      continue;
    }
    if (status.hasSimilarHeader || statusResolved.hasSimilarHeader) {
      console.log(`     ⏭️  已存在（相似头文件）: ${preResolvedHeader}`);
      result.skipped.push(preResolvedHeader);
      continue;
    }

    // ── SPM 依赖检查 ──
    const headerModules = _inferModulesFromHeaders([headerTrimmed]);
    if (spmService && currentTarget && !opts.skipDepCheck) {
      for (const mod of headerModules) {
        if (_SYSTEM_FRAMEWORKS.has(mod) || mod === currentTarget) continue;

        const ensureResult = spmService.ensureDependency(currentTarget, mod);
        const decision = _evaluateDepResult(ensureResult, currentTarget, mod);

        if (decision.action === 'block') {
          console.warn(`     ⛔ 依赖被阻止: ${currentTarget} -> ${mod} (${decision.reason})`);
          NU.notify(
            `已阻止依赖注入\n${currentTarget} -> ${mod}\n${decision.reason}`,
            'AutoSnippet SPM 依赖策略',
          );
          result.cancelled = true;
          return result;
        }

        if (decision.action === 'review') {
          const reviewResult = _handleDepReview({
            spmService, currentTarget, mod, ensureResult, NU, depWarnings,
          });
          if (reviewResult.blocked) {
            console.log(`     ⏹️  用户取消`);
            result.cancelled = true;
            return result;
          }
        }
      }
    }

    // ── 构建带注释后缀的 import 行 ──
    // 复用 dedup 阶段已计算的 preResolvedHeader
    const resolvedHeader = preResolvedHeader;
    const depHint = headerModules.find(m => depWarnings.has(m));
    const importLine = depHint
      ? _withAutoSnippetNote(resolvedHeader) + ` // ⚠️ 依赖缺失: ${depWarnings.get(depHint)}，需手动补齐 Package.swift`
      : _withAutoSnippetNote(resolvedHeader);

    // ── 写入：Xcode 自动化优先 → 文件写入回退（V1 _writeImportLine） ──
    let inserted = false;

    if (xcodeReady && !fileWriteUsed) {
      // V1 _writeImportLineXcode：逐条 osascript 跳转 + 粘贴
      inserted = _writeImportLineXcode(importLine, baseInsertLine + xcodeOffset, XA, CM);
      if (inserted) {
        xcodeOffset++;
      }
    }

    if (!inserted) {
      _writeImportLineFile(fullPath, importLine, isSwift);
      fileWriteUsed = true;
    }

    result.inserted.push(resolvedHeader);
    importArray.push(resolvedHeader); // V1: 添加到去重列表（用解析后格式）
    console.log(`     + ${resolvedHeader}`);
  }

  if (result.inserted.length > 0) {
    console.log(`  📦 已添加 ${result.inserted.length} 个依赖`);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// 主要导出：insertCodeToXcode
// ═══════════════════════════════════════════════════════════════

/**
 * 将选中的搜索结果代码插入 Xcode（V1 SearchHandler autoCut + autoPaste 完整流程）
 *
 * V1 流程：
 *   1. 找到触发行号
 *   2. Preflight — 预检依赖决策（不实际写入）
 *   3. Cut 触发行内容（Xcode 剪切，不写文件）
 *   4. 构建带缩进 + 注释标记的代码块
 *   5. 插入 Headers（Xcode osascript / 文件写入）
 *   6. 计算偏移后的粘贴行号（computePasteLineNumber）
 *   7. Jump 到粘贴行 → 选中行内容 → Cmd+V 粘贴替换
 *   8. 任一步失败 → 降级到纯文件写入
 *
 * @param {import('./FileWatcher.js').FileWatcher} watcher
 */
export async function insertCodeToXcode(watcher, fullPath, selected, triggerLine) {
  const XA = await import('../../infrastructure/external/XcodeAutomation.js');
  const CM = await import('../../infrastructure/external/ClipboardManager.js');
  const NU = await import('../../infrastructure/external/NativeUi.js');

  const code = selected.code || '';
  if (!code) {
    console.log(`  ℹ️  选中项无代码内容`);
    return;
  }

  const headersToInsert = (selected.headers || []).filter(h => h && h.trim());
  const isSwift = fullPath.endsWith('.swift');

  // ═══════════════════════════════════════════════════════
  // 主路径：Xcode 自动化
  // ═══════════════════════════════════════════════════════
  if (XA.isXcodeRunning()) {
    // ── 窗口上下文验证（V1 WindowContextManager 等价）──
    if (!XA.isXcodeFrontmost()) {
      console.warn(`  ⚠️ Xcode 不是前台应用，自动化操作可能不准确`);
      // 宽松模式：仅警告，不阻断（V1 relaxed 行为）
      // 如需严格模式，可设置 ASD_XCODE_STRICT_FOCUS=1
      if (process.env.ASD_XCODE_STRICT_FOCUS === '1') {
        console.warn(`  ⏹️  ASD_XCODE_STRICT_FOCUS=1, 跳过自动化`);
        return _fileInsertFallback(fullPath, selected, triggerLine, headersToInsert, watcher);
      }
    }
    // ── Step 1: 找到触发行号 ──
    let content;
    try { content = readFileSync(fullPath, 'utf8'); } catch {
      return _fileInsertFallback(fullPath, selected, triggerLine, headersToInsert, watcher);
    }
    const triggerLineNumber = findTriggerLineNumber(content, triggerLine);
    if (triggerLineNumber < 0) {
      console.warn(`  ⚠️ 未在文件中找到触发行，降级为文件写入`);
      return _fileInsertFallback(fullPath, selected, triggerLine, headersToInsert, watcher);
    }

    // 计算触发行缩进（V1 SearchHandler 对齐逻辑）
    const lines = content.split(/\r?\n/);
    const triggerContent = lines[triggerLineNumber - 1] || '';
    const indentMatch = triggerContent.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';

    // ── Step 2: Preflight 预检依赖（V1 handleHeadersBatch preflight=true） ──
    let preflightDepWarnings = null;
    let _spmServiceCached = null;
    let _currentTargetCached = null;
    if (headersToInsert.length > 0) {
      const preflight = await _preflightDeps(fullPath, headersToInsert, selected, NU);
      if (preflight.blocked) {
        console.log(`  ⏹️  依赖检查被阻止，跳过代码插入`);
        return;
      }
      if (preflight.depWarnings && preflight.depWarnings.size > 0) {
        preflightDepWarnings = preflight.depWarnings;
      }
      // 缓存 spmService/currentTarget 供 insertHeaders 复用（避免重复 load）
      _spmServiceCached = preflight._spmService || null;
      _currentTargetCached = preflight._currentTarget || null;
    }

    // ── Step 3: 剪切触发行内容（V1 _tryAutoCutXcode） ──
    const cutOk = XA.cutLineInXcode(triggerLineNumber);
    if (!cutOk) {
      console.warn(`  ⚠️ 自动剪切失败，降级为文件写入`);
      // Preflight 已通过，skipDepCheck 避免重复弹窗
      return _fileInsertFallback(fullPath, selected, triggerLine, headersToInsert, watcher, { skipDepCheck: true });
    }
    await _sleep(300);

    // ── Step 4: 构建带缩进的代码块（V1 SearchHandler 缩进处理） ──
    const codeLines = code.split(/\r?\n/);
    // V1: 移除末尾空行
    while (codeLines.length > 0 && !codeLines[codeLines.length - 1].trim()) {
      codeLines.pop();
    }
    const indentedLines = codeLines.map(line => line ? indent + line : line);
    // V1: 注释标记
    const commentMarker = _generateInsertMarker(fullPath, selected);
    const markedLines = commentMarker
      ? [indent + commentMarker, ...indentedLines]
      : indentedLines;
    const indentedCode = markedLines.join('\n');

    // ── Step 5: 插入 Headers（V1 handleHeadersBatch decisions 模式） ──
    let headerInsertCount = 0;
    if (headersToInsert.length > 0) {
      const headerResult = await insertHeaders(watcher, fullPath, headersToInsert, {
        moduleName: selected.moduleName || null,
        isSwift,
        skipDepCheck: true, // Preflight 已检查过
        depWarnings: preflightDepWarnings,
        _spmService: _spmServiceCached,
        _currentTarget: _currentTargetCached,
      });
      if (headerResult.cancelled) {
        console.log(`  ⏹️  Headers 插入被取消`);
        return;
      }
      headerInsertCount = headerResult.inserted.length;
    }

    // ── Step 6: 计算偏移后的粘贴行号（V1 computePasteLineNumber） ──
    // 使用实际插入的 header 数量计算偏移，而非期望数量
    // 当 headers 全部重复被跳过时，headerInsertCount = 0，不应偏移
    const pasteLineNumber = _computePasteLineNumber(
      triggerLineNumber,
      headerInsertCount,
      fullPath,
      { forceOffset: headerInsertCount > 0, expectedHeaderCount: headerInsertCount },
    );

    // 如果 headers 通过文件写入，等待 Xcode reload
    if (headerInsertCount > 0) {
      await _sleep(600);
    }

    // ── Step 7: Jump + 选中行内容 + 粘贴替换 ──
    await CM.withClipboardSave(async () => {
      const wrote = CM.write(indentedCode);
      if (!wrote) {
        console.warn(`  ⚠️ 剪贴板写入失败`);
        return;
      }
      await _sleep(100);
      XA.jumpToLineInXcode(pasteLineNumber);
      await _sleep(500);
      XA.selectAndPasteInXcode();
      await _sleep(300);
    });

    console.log(`  ✅ 代码已粘贴到 Xcode（可 Cmd+Z 撤销）`);
    NU.notify(`已插入「${selected.title || '代码片段'}」`, 'AutoSnippet');
    return;
  }

  // ═══════════════════════════════════════════════════════
  // 降级路径：纯文件写入
  // ═══════════════════════════════════════════════════════
  return _fileInsertFallback(fullPath, selected, triggerLine, headersToInsert, watcher);
}

// ═══════════════════════════════════════════════════════════════
// V1 Preflight 依赖预检
// ═══════════════════════════════════════════════════════════════

/**
 * 预检所有 headers 的 SPM 依赖状态（V1 handleHeadersBatch preflight=true）
 *
 * 不实际写入文件，只检查并弹窗确认。
 * 返回 { blocked: true } 表示有依赖被阻止或用户取消。
 */
async function _preflightDeps(fullPath, headers, selected, NU) {
  const result = { blocked: false };

  // V1: 始终从所有 headers 推断模块（不仅仅依赖 selected.moduleName）
  const inferredModules = _inferModulesFromHeaders(headers);
  if (selected.moduleName && !inferredModules.includes(selected.moduleName)) {
    inferredModules.push(selected.moduleName);
  }
  const thirdPartyModules = inferredModules.filter(m => !_SYSTEM_FRAMEWORKS.has(m));
  if (thirdPartyModules.length === 0) return result;

  try {
    const { ServiceContainer } = await import('../../injection/ServiceContainer.js');
    const container = ServiceContainer.getInstance();
    const spmService = container.get('spmService');
    if (!spmService) return result;

    // Fix Mode 检查：off 模式完全跳过
    if (spmService.getFixMode() === 'off') return result;

    try { await spmService.load(); } catch { return result; }

    const currentTarget = spmService.resolveCurrentTarget(fullPath);
    if (!currentTarget) return result;

    for (const mod of thirdPartyModules) {
      if (mod === currentTarget) continue;

      const ensureResult = spmService.ensureDependency(currentTarget, mod);
      const decision = _evaluateDepResult(ensureResult, currentTarget, mod);

      if (decision.action === 'block') {
        console.warn(`  ⛔ [Preflight] 依赖被阻止: ${currentTarget} -> ${mod} (${decision.reason})`);
        NU.notify(
          `已阻止依赖注入\n${currentTarget} -> ${mod}\n${decision.reason}`,
          'AutoSnippet SPM 依赖策略',
        );
        result.blocked = true;
        return result;
      }

      if (decision.action === 'review') {
        if (!result.depWarnings) result.depWarnings = new Map();
        const reviewResult = _handleDepReview({
          spmService, currentTarget, mod, ensureResult, NU,
          depWarnings: result.depWarnings, label: 'Preflight',
        });
        if (reviewResult.blocked) {
          result.blocked = true;
          return result;
        }
      }
    }

    // 缓存 spmService/currentTarget 供下游 insertHeaders 复用
    result._spmService = spmService;
    result._currentTarget = currentTarget;
  } catch (err) {
    console.warn(`  ⚠️ Preflight 依赖检查异常: ${err.message}`);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// 文件写入降级（V1 _runFileInsertFlow + _performDirectInsert）
// ═══════════════════════════════════════════════════════════════

async function _fileInsertFallback(fullPath, selected, triggerLine, headersToInsert, watcher, opts = {}) {
  // V1: 先写 headers
  if (headersToInsert.length > 0) {
    const headerResult = await insertHeaders(watcher, fullPath, headersToInsert, {
      moduleName: selected.moduleName || null,
      skipDepCheck: opts.skipDepCheck || false, // Preflight 已通过时跳过重复检查
    });
    if (headerResult.cancelled) return;
  }

  // V1: 再替换触发行为代码
  const code = selected.code || '';
  try {
    const content = readFileSync(fullPath, 'utf8');
    const lines = content.split(/\r?\n/);
    const triggerTrimmed = triggerLine.trim();

    // V1: 从后往前查找触发行
    let found = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() === triggerTrimmed) {
        found = i;
        break;
      }
    }

    if (found >= 0) {
      // V1: 计算缩进 → 对齐 → 替换
      const triggerContent = lines[found];
      const indentMatch = triggerContent.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : '';

      const codeLines = code.split(/\r?\n/);
      while (codeLines.length > 0 && !codeLines[codeLines.length - 1].trim()) {
        codeLines.pop();
      }
      const indentedLines = codeLines.map(line => line ? indent + line : line);

      const commentMarker = _generateInsertMarker(fullPath, selected);
      const markedLines = commentMarker
        ? [indent + commentMarker, ...indentedLines]
        : indentedLines;

      while (markedLines.length > 0 && !markedLines[markedLines.length - 1].trim()) {
        markedLines.pop();
      }

      const newLines = [...lines.slice(0, found), ...markedLines, ...lines.slice(found + 1)];
      const newContent = newLines.join('\n');
      saveEventFilter.markWrite(fullPath, newContent);
      writeFileSync(fullPath, newContent, 'utf8');
      console.log(`  ✅ 代码已写入文件（替换触发行）`);
    } else {
      const appendContent = content + '\n' + code + '\n';
      saveEventFilter.markWrite(fullPath, appendContent);
      writeFileSync(fullPath, appendContent, 'utf8');
      console.log(`  ✅ 代码已追加到文件末尾`);
    }
  } catch (err) {
    console.warn(`  ⚠️ 文件写入失败: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// V1 注释标记生成（SearchHandler._generateInsertMarker）
// ═══════════════════════════════════════════════════════════════

function _generateInsertMarker(filePath, selected) {
  try {
    const ext = (filePath.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    const trigger = selected.trigger ? `[${selected.trigger}]` : '';
    const recipeName = selected.name ? ` from ${selected.name}` : '';
    const timestamp = new Date().toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });

    const marker = `🤖 AutoSnippet${trigger}${recipeName} @ ${timestamp}`;

    if (['.py', '.rb'].includes(ext)) return `# ${marker}`;
    if (['.lua', '.sql'].includes(ext)) return `-- ${marker}`;
    if (['.html', '.xml', '.svg'].includes(ext)) return `<!-- ${marker} -->`;
    if (['.css', '.scss', '.less'].includes(ext)) return `/* ${marker} */`;
    return `// ${marker}`;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

/**
 * 查找触发行的行号（1-based，-1 表示未找到）
 */
export function findTriggerLineNumber(content, triggerLine) {
  if (!content || !triggerLine) return -1;
  const needle = triggerLine.trim();
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === needle) return i + 1;
  }
  return -1;
}

/**
 * 查找 import 语句的插入位置（0-based 行索引，在最后一个 import 之后）
 */
export function findImportInsertLine(content, isSwift) {
  const lines = content.split('\n');
  let lastImportLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (isSwift) {
      if (t.startsWith('import ') && !t.startsWith('import (')) lastImportLine = i;
    } else {
      if (t.startsWith('#import') || t.startsWith('@import')) lastImportLine = i;
    }
  }
  return lastImportLine >= 0 ? lastImportLine + 1 : 0;
}
