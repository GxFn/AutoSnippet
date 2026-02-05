/**
 * 剪贴板处理工具
 * 职责：
 * - 读取/写入操作系统剪贴板内容
 * - 跨平台支持 (macOS, Linux, Windows)
 */

const { execSync } = require('child_process');
const os = require('os');

/**
 * 读取操作系统剪贴板内容
 * @returns {string} - 剪贴板文本，读取失败返回空字符串
 */
function readClipboardText() {
  try {
  const platform = os.platform();
  
  let cmd;
  if (platform === 'darwin') {
    // macOS
    cmd = 'pbpaste';
  } else if (platform === 'linux') {
    // Linux (需要 xclip 或 xsel)
    try {
    execSync('which xclip', { stdio: 'ignore' });
    cmd = 'xclip -selection clipboard -o';
    } catch {
    try {
      execSync('which xsel', { stdio: 'ignore' });
      cmd = 'xsel --clipboard --output';
    } catch {
      return '';
    }
    }
  } else if (platform === 'win32') {
    // Windows
    cmd = 'powershell -Command "Get-Clipboard"';
  } else {
    return '';
  }
  
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch (error) {
  return '';
  }
}

/**
 * 写入文本到操作系统剪贴板
 * @param {string} text - 要写入的文本
 * @returns {boolean} - 成功返回 true，失败返回 false
 */
function writeClipboardText(text) {
  try {
  const platform = os.platform();
  
  let cmd;
  if (platform === 'darwin') {
    // macOS
    cmd = 'pbcopy';
  } else if (platform === 'linux') {
    // Linux
    try {
    execSync('which xclip', { stdio: 'ignore' });
    cmd = 'xclip -selection clipboard -i';
    } catch {
    try {
      execSync('which xsel', { stdio: 'ignore' });
      cmd = 'xsel --clipboard --input';
    } catch {
      return false;
    }
    }
  } else if (platform === 'win32') {
    // Windows
    cmd = 'powershell -Command "Set-Clipboard"';
  } else {
    return false;
  }
  
  execSync(cmd, { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
  return true;
  } catch (error) {
  return false;
  }
}

module.exports = {
  readClipboardText,
  writeClipboardText
};
