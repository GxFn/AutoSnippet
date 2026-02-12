/**
 * XcodeIntegration — Xcode IDE 自动化工具方法
 * 头文件插入、代码插入、行号查找等
 */

import { readFileSync, writeFileSync } from 'node:fs';

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 从 import 语句中推断模块名
 * #import <Module/Header.h>  → Module
 * @import Module;            → Module
 * import Module              → Module
 * #import "Local.h"          → null（本地头文件不检查）
 */
function _inferModulesFromHeaders(headers) {
  const modules = new Set();
  for (const h of headers) {
    const t = h.trim();
    let m;
    // #import <Module/xxx.h> or #import <Module.h>
    m = t.match(/^#import\s+<([^/> ]+)/);
    if (m) { modules.add(m[1]); continue; }
    // @import Module;
    m = t.match(/^@import\s+(\w+)/);
    if (m) { modules.add(m[1]); continue; }
    // import Module (Swift)
    m = t.match(/^import\s+(\w+)/);
    if (m && m[1] !== 'class' && m[1] !== 'struct' && m[1] !== 'enum' && m[1] !== 'protocol') {
      modules.add(m[1]);
    }
  }
  return [...modules];
}

// 常见 Apple 系统框架，不需要依赖检查
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

/**
 * 统一的头文件插入方法（所有场景共用）
 *
 * 流程：
 *   1. 去重（跳过已存在的 import）
 *   2. 依赖检查 — SPM 模块可达性检查 + NativeUI 弹窗确认
 *   3. Xcode 自动化优先 — 跳转到 import 区域 + 剪贴板写入 + 自动粘贴
 *   4. 文件级回退 — Xcode 不可用或 AppleScript 失败时直接写文件
 *
 * @param {import('./FileWatcher.js').FileWatcher} watcher
 * @param {string} fullPath  目标文件绝对路径
 * @param {string[]} headers  待插入的 import 行数组
 * @param {object} [opts]
 * @returns {Promise<{inserted: string[], skipped: string[], cancelled: boolean}>}
 */
export async function insertHeaders(watcher, fullPath, headers, opts = {}) {
  const XA = await import('../../infrastructure/external/XcodeAutomation.js');
  const CM = await import('../../infrastructure/external/ClipboardManager.js');
  const NU = await import('../../infrastructure/external/NativeUi.js');

  const result = { inserted: [], skipped: [], cancelled: false };
  if (!headers || headers.length === 0) return result;

  const isSwift = opts.isSwift ?? fullPath.endsWith('.swift');

  // ── 1. 去重 ──
  let content;
  try {
    content = readFileSync(fullPath, 'utf8');
  } catch {
    return result;
  }

  const existingImports = new Set();
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#import') || t.startsWith('@import') || t.startsWith('import ')) {
      existingImports.add(t);
    }
  }
  const newHeaders = headers.filter(h => !existingImports.has(h.trim()));
  if (newHeaders.length === 0) {
    result.skipped = [...headers];
    return result;
  }

  // ── 2. 依赖检查（自动推断模块名，过滤系统框架） ──
  if (!opts.skipDepCheck) {
    const inferredModules = opts.moduleName
      ? [opts.moduleName]
      : _inferModulesFromHeaders(newHeaders);

    // 过滤掉系统框架
    const thirdPartyModules = inferredModules.filter(m => !_SYSTEM_FRAMEWORKS.has(m));

    if (thirdPartyModules.length > 0) {
      const missingModules = [];
      let spmAvailable = false;

      try {
        const { ServiceContainer } = await import('../../injection/ServiceContainer.js');
        const container = ServiceContainer.getInstance();
        const spmService = container.get('spmService');
        if (spmService) {
          const targets = await spmService.getTargets();
          if (targets && targets.length > 0) {
            spmAvailable = true;
            const targetNames = new Set(targets.map(t => t.name));
            for (const mod of thirdPartyModules) {
              if (!targetNames.has(mod)) {
                missingModules.push(mod);
              }
            }
          }
        }
      } catch {
        // SPM 检查失败，静默跳过
      }

      // 仅当 SPM 确认模块缺失时才弹窗提示
      if (spmAvailable && missingModules.length > 0) {
        const depWarning = missingModules.length === 1
          ? `模块 "${missingModules[0]}" 不在当前 SPM 依赖中`
          : `以下模块不在当前 SPM 依赖中：${missingModules.join('、')}`;
        console.log(`  ⚠️  ${depWarning}`);
        const decision = NU.promptWithButtons(
          `${depWarning}\n\n仍要添加 import 吗？`,
          ['继续添加', '取消'],
          'AutoSnippet 依赖检查'
        );
        if (decision !== '继续添加') {
          console.log(`  ⏹️  用户取消`);
          result.cancelled = true;
          return result;
        }
      }
    }
  }

  // ── 3. 写入文件（V1 策略：文件写入优先，Xcode 会自动 reload） ──
  try {
    content = readFileSync(fullPath, 'utf8');
    const insertPoint = findImportInsertLine(content, isSwift);
    const lines = content.split('\n');

    // 检查 import 区后面是否已有空行，没有则补一行
    const lineAfterInsert = lines[insertPoint] ?? '';
    const needsBlankLine = lineAfterInsert.trim().length > 0;
    const toInsert = needsBlankLine ? [...newHeaders, ''] : [...newHeaders];

    lines.splice(insertPoint, 0, ...toInsert);
    writeFileSync(fullPath, lines.join('\n'), 'utf8');
    result.inserted = [...newHeaders];
    console.log(`  📦 已添加 ${newHeaders.length} 个依赖（文件写入）`);
  } catch (err) {
    console.warn(`  ⚠️ Header 写入失败: ${err.message}`);
  }

  for (const h of result.inserted) {
    console.log(`     + ${h}`);
  }
  return result;
}

/**
 * 将选中的搜索结果代码插入 Xcode（或回退到文件写入）
 *
 * V1 兼容流程（Xcode 自动化模式）：
 *   1. 找到触发行号
 *   2. Cut 触发行内容（Xcode 剪切，不写文件）
 *   3. 依赖检查 + Headers 写入文件（Xcode 自动 reload）
 *   4. 计算偏移后的粘贴行号
 *   5. Jump 到粘贴行 → 选中行内容 → Cmd+V 粘贴替换
 *   6. 任一步失败 → 降级到纯文件写入
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

  // ═══════════════════════════════════════════════════════
  // 主路径：Xcode 自动化（cut + paste，headers 写文件）
  // ═══════════════════════════════════════════════════════
  if (XA.isXcodeRunning()) {
    // Step 1: 从磁盘找到触发行号
    let content = readFileSync(fullPath, 'utf8');
    const triggerLineNumber = findTriggerLineNumber(content, triggerLine);
    if (triggerLineNumber < 0) {
      console.warn(`  ⚠️ 未在文件中找到触发行，降级为文件写入`);
      return _fileInsertFallback(fullPath, selected, triggerLine, headersToInsert, watcher);
    }

    // Step 2: 剪切触发行内容（V1: _tryAutoCutXcode）
    const cutOk = XA.cutLineInXcode(triggerLineNumber);
    if (!cutOk) {
      console.warn(`  ⚠️ 自动剪切失败，降级为文件写入`);
      return _fileInsertFallback(fullPath, selected, triggerLine, headersToInsert, watcher);
    }
    await _sleep(300);

    // Step 3: 依赖检查 + Headers 写入文件（Xcode 自动 reload）
    let headerInsertCount = 0;
    if (headersToInsert.length > 0) {
      const headerResult = await insertHeaders(watcher, fullPath, headersToInsert, {
        moduleName: selected.moduleName || null,
      });
      if (headerResult.cancelled) {
        console.log(`  ⏹️  依赖检查被取消，跳过代码插入`);
        return;
      }
      headerInsertCount = headerResult.inserted.length;
    }

    // Step 4: 计算偏移后的粘贴行号（V1: computePasteLineNumber）
    // headers 写在 import 区（触发行之前），所以触发行向下偏移
    let pasteLineNumber = triggerLineNumber;
    if (headerInsertCount > 0) {
      // 检查 headers 插入位置是否在触发行之前
      content = readFileSync(fullPath, 'utf8');
      const importInsertLine = findImportInsertLine(content, fullPath.endsWith('.swift'));
      if (importInsertLine <= triggerLineNumber) {
        pasteLineNumber = triggerLineNumber + headerInsertCount;
        // 如果补了空行，再加 1
        const lines = content.split('\n');
        const lineAfterHeaders = lines[importInsertLine + headerInsertCount - 1];
        if (lineAfterHeaders !== undefined && lineAfterHeaders.trim() === '') {
          // insertHeaders 补了空行
          pasteLineNumber += 1;
        }
      }
    }

    // 等待 Xcode 检测到文件变化并 reload
    if (headerInsertCount > 0) {
      await _sleep(600);
    }

    // Step 5: Jump + 选中行内容 + 粘贴替换
    await CM.withClipboardSave(async () => {
      const wrote = CM.write(code);
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
    NU.notify(`已插入「${selected.title}」`, 'AutoSnippet');
    return;
  }

  // ═══════════════════════════════════════════════════════
  // 降级路径：纯文件写入
  // ═══════════════════════════════════════════════════════
  return _fileInsertFallback(fullPath, selected, triggerLine, headersToInsert, watcher);
}

/**
 * 纯文件写入降级方案
 */
async function _fileInsertFallback(fullPath, selected, triggerLine, headersToInsert, watcher) {
  // 先写 headers
  if (headersToInsert.length > 0) {
    const headerResult = await insertHeaders(watcher, fullPath, headersToInsert, {
      moduleName: selected.moduleName || null,
    });
    if (headerResult.cancelled) return;
  }

  // 再替换触发行为代码
  const code = selected.code || '';
  try {
    const content = readFileSync(fullPath, 'utf8');
    const newContent = content.replace(triggerLine.trim(), code);
    if (newContent !== content) {
      writeFileSync(fullPath, newContent, 'utf8');
      console.log(`  ✅ 代码已写入文件（替换触发行）`);
    } else {
      writeFileSync(fullPath, content + '\n' + code + '\n', 'utf8');
      console.log(`  ✅ 代码已追加到文件末尾`);
    }
  } catch (err) {
    console.warn(`  ⚠️ 文件写入失败: ${err.message}`);
  }
}

/**
 * 查找任意触发行的行号 (1-based)
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
 * 查找 import 语句的插入位置（行号，0-based）
 */
export function findImportInsertLine(content, isSwift) {
  const lines = content.split('\n');
  let lastImportLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (isSwift) {
      if (t.startsWith('import ') && !t.startsWith('import (')) {
        lastImportLine = i;
      }
    } else {
      if (t.startsWith('#import') || t.startsWith('@import')) {
        lastImportLine = i;
      }
    }
  }
  return lastImportLine >= 0 ? lastImportLine + 1 : 0;
}
