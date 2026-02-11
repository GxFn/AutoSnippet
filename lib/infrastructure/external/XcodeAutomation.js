/**
 * XcodeAutomation - Xcode AppleScript 自动化
 *
 * 提供 Xcode 行操作：跳转行、选中行、剪切行、粘贴等。
 * 所有操作都带超时保护，Xcode 未运行时默认跳过。
 *
 * V2 ESM 版本，对应 V1 SearchHandler/CreateHandler 中的散落 AppleScript 逻辑。
 */

import { execSync, spawnSync } from 'node:child_process';

const OSASCRIPT_TIMEOUT = 5000;

/**
 * 检查 Xcode 是否正在运行（不启动 Xcode）
 */
export function isXcodeRunning() {
  if (process.platform !== 'darwin') return false;
  try {
    const result = execSync('pgrep -x Xcode', {
      encoding: 'utf8',
      timeout: 2000,
      stdio: 'pipe',
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * 检查 Xcode 是否是当前焦点应用
 */
export function isXcodeFrontmost() {
  if (!isXcodeRunning()) return false;
  try {
    const result = execSync(
      'osascript -e \'tell application "System Events" to get name of first process whose frontmost is true\'',
      { encoding: 'utf8', timeout: OSASCRIPT_TIMEOUT, stdio: 'pipe' }
    );
    return result.trim() === 'Xcode';
  } catch {
    return false;
  }
}

/**
 * 在 Xcode 中剪切指定行内容（不含换行符，与 V1 一致）
 * Cmd+L 跳转 → Cmd+← 行首 → Cmd+Shift+→ 选中行内容 → Cmd+X 剪切
 * @param {number} lineNumber 1-based 行号
 * @returns {boolean} 是否成功
 */
export function cutLineInXcode(lineNumber) {
  if (!isXcodeRunning()) return false;
  const safeLineNumber = Number.isFinite(lineNumber) && lineNumber > 0 ? lineNumber : 1;
  try {
    const args = [
      '-e', 'tell application "Xcode" to activate',
      '-e', 'delay 0.5',
      '-e', 'tell application "System Events"',
      '-e', '  keystroke "l" using command down',       // Cmd+L: Go to Line
      '-e', '  delay 0.5',
      '-e', `  keystroke "${String(safeLineNumber)}"`,  // 输入行号
      '-e', '  delay 0.5',
      '-e', '  key code 36',                            // Return
      '-e', '  delay 0.5',
      '-e', '  key code 123 using command down',        // Cmd+← 行首
      '-e', '  delay 0.5',
      '-e', '  key code 124 using {command down, shift down}', // Cmd+Shift+→ 选到行尾（不含换行）
      '-e', '  delay 0.5',
      '-e', '  keystroke "x" using command down',       // Cmd+X
      '-e', 'end tell',
    ];
    const res = spawnSync('osascript', args, { stdio: 'ignore', timeout: OSASCRIPT_TIMEOUT });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * 在 Xcode 中跳转到指定行
 * @param {number} lineNumber 1-based 行号
 * @returns {boolean}
 */
export function jumpToLineInXcode(lineNumber) {
  if (!isXcodeRunning()) return false;
  const safeLine = Number.isFinite(lineNumber) && lineNumber > 0 ? lineNumber : 1;
  try {
    const args = [
      '-e', 'tell application "Xcode" to activate',
      '-e', 'delay 0.2',
      '-e', 'tell application "System Events"',
      '-e', '  keystroke "l" using command down',
      '-e', '  delay 0.2',
      '-e', `  keystroke "${String(safeLine)}"`,
      '-e', '  delay 0.2',
      '-e', '  key code 36',
      '-e', 'end tell',
    ];
    const res = spawnSync('osascript', args, { stdio: 'ignore', timeout: OSASCRIPT_TIMEOUT });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * 在 Xcode 中执行粘贴（Cmd+V）
 * @returns {boolean}
 */
export function pasteInXcode() {
  if (!isXcodeRunning()) return false;
  try {
    const args = [
      '-e', 'tell application "Xcode" to activate',
      '-e', 'delay 0.2',
      '-e', 'tell application "System Events"',
      '-e', '  keystroke "v" using command down',
      '-e', 'end tell',
    ];
    const res = spawnSync('osascript', args, { stdio: 'ignore', timeout: OSASCRIPT_TIMEOUT });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * 在 Xcode 中选中当前行内容后粘贴替换（V1 _tryAutoPasteXcode 逻辑）
 * 光标已在目标行（由 jumpToLineInXcode 定位）
 * Cmd+← 行首 → Cmd+Shift+→ 选到行尾 → Cmd+V 粘贴替换
 * @returns {boolean}
 */
export function selectAndPasteInXcode() {
  if (!isXcodeRunning()) return false;
  try {
    const args = [
      '-e', 'tell application "Xcode" to activate',
      '-e', 'delay 0.5',
      '-e', 'tell application "System Events"',
      '-e', '  key code 123 using command down',        // Cmd+← 行首
      '-e', '  delay 0.1',
      '-e', '  key code 124 using {command down, shift down}', // Cmd+Shift+→ 选到行尾
      '-e', '  delay 0.2',
      '-e', '  keystroke "v" using command down',       // Cmd+V 粘贴替换选中内容
      '-e', 'end tell',
    ];
    const res = spawnSync('osascript', args, { stdio: 'ignore', timeout: OSASCRIPT_TIMEOUT });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * 在 Xcode 指定行的行首插入剪贴板内容（V1 ImportWriterV2._writeImportLineXcode Step 2）
 *
 * 操作序列：Cmd+L → 输入行号 → Return → Cmd+← → Cmd+V
 * 剪贴板内容应以 \n 结尾，这样插入后成为独立一行。
 *
 * @param {number} lineNumber 1-based 行号
 * @returns {boolean}
 */
export function insertAtLineStartInXcode(lineNumber) {
  if (!isXcodeRunning()) return false;
  const safeLine = Number.isFinite(lineNumber) && lineNumber > 0 ? lineNumber : 1;
  try {
    const args = [
      '-e', 'tell application "Xcode" to activate',
      '-e', 'delay 0.3',
      '-e', 'tell application "System Events"',
      '-e', '  keystroke "l" using command down',                    // Cmd+L: Go to Line
      '-e', '  delay 0.3',
      '-e', `  keystroke "${String(safeLine)}"`,                     // 输入行号
      '-e', '  delay 0.3',
      '-e', '  key code 36',                                        // Return
      '-e', '  delay 0.3',
      '-e', '  key code 123 using command down',                    // Cmd+← 行首
      '-e', '  delay 0.2',
      '-e', '  keystroke "v" using command down',                    // Cmd+V 粘贴
      '-e', '  delay 0.3',
      '-e', 'end tell',
    ];
    const res = spawnSync('osascript', args, { stdio: 'ignore', timeout: OSASCRIPT_TIMEOUT });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * 在 Xcode 指定行执行：跳转 → 选中内容 → 删除（V1 directive 删除逻辑）
 *
 * @param {number} lineNumber 1-based 行号
 * @returns {boolean}
 */
export function deleteLineContentInXcode(lineNumber) {
  if (!isXcodeRunning()) return false;
  const safeLine = Number.isFinite(lineNumber) && lineNumber > 0 ? lineNumber : 1;
  try {
    const args = [
      '-e', 'tell application "Xcode" to activate',
      '-e', 'delay 0.3',
      '-e', 'tell application "System Events"',
      '-e', '  keystroke "l" using command down',
      '-e', '  delay 0.3',
      '-e', `  keystroke "${String(safeLine)}"`,
      '-e', '  delay 0.3',
      '-e', '  key code 36',
      '-e', '  delay 0.3',
      '-e', '  key code 123 using command down',                    // Cmd+← 行首
      '-e', '  delay 0.2',
      '-e', '  key code 124 using {command down, shift down}',      // Cmd+Shift+→ 选到行尾
      '-e', '  delay 0.2',
      '-e', '  key code 51',                                        // Delete 键
      '-e', '  delay 0.3',
      '-e', 'end tell',
    ];
    const res = spawnSync('osascript', args, { stdio: 'ignore', timeout: OSASCRIPT_TIMEOUT });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * 保存 Xcode 当前活动文档（Cmd+S）
 * @returns {boolean}
 */
export function saveActiveDocumentInXcode() {
  if (!isXcodeRunning()) return false;
  try {
    const args = [
      '-e', 'tell application "Xcode" to activate',
      '-e', 'delay 0.1',
      '-e', 'tell application "System Events"',
      '-e', '  keystroke "s" using command down',
      '-e', 'end tell',
    ];
    const res = spawnSync('osascript', args, { stdio: 'ignore', timeout: OSASCRIPT_TIMEOUT });
    return res.status === 0;
  } catch {
    return false;
  }
}
