#!/usr/bin/env node

/**
 * 跨平台剪贴板管理器
 * 支持: macOS (pbcopy), Linux (xclip/xsel), Windows (PowerShell)
 * 
 * 用途: 将代码复制到系统剪贴板，配合 UI 提示用户按 Cmd+V 粘贴
 * 这样可以保留 Xcode 的撤销历史
 */

const { execSync, spawnSync } = require('child_process');
const os = require('os');

class ClipboardManager {
  /**
   * 写入文本到系统剪贴板
   * @param {string} text 要复制的文本
   * @returns {boolean} 成功返回 true
   */
  static write(text) {
    try {
      const platform = os.platform();
      
      if (platform === 'darwin') {
        // macOS: pbcopy
        execSync('pbcopy', { 
          input: text, 
          encoding: 'utf8',
          stdio: ['pipe', 'ignore', 'ignore']
        });
        return true;
      } 
      
      if (platform === 'linux') {
        // Linux: 优先 xclip，次选 xsel
        try {
          execSync('which xclip', { stdio: 'ignore' });
          execSync('xclip -selection clipboard', { 
            input: text, 
            encoding: 'utf8',
            stdio: ['pipe', 'ignore', 'ignore']
          });
          return true;
        } catch (_) {
          try {
            execSync('which xsel', { stdio: 'ignore' });
            execSync('xsel --clipboard --input', { 
              input: text, 
              encoding: 'utf8',
              stdio: ['pipe', 'ignore', 'ignore']
            });
            return true;
          } catch (__) {
            console.warn('⚠️  Linux 上找不到 xclip 或 xsel，剪贴板功能不可用');
            return false;
          }
        }
      }
      
      if (platform === 'win32') {
        // Windows: PowerShell Set-Clipboard
        const escaped = text
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '`n');
        execSync(`powershell -NoProfile -Command "Set-Clipboard -Value \\"${escaped}\\""`, {
          stdio: ['ignore', 'ignore', 'ignore']
        });
        return true;
      }
      
      console.warn(`⚠️  不支持的平台: ${platform}`);
      return false;
      
    } catch (error) {
      console.error('❌ 剪贴板写入失败:', error.message);
      return false;
    }
  }
  
  /**
   * 读取系统剪贴板
   * @returns {string|null} 剪贴板内容，失败返回 null
   */
  static read() {
    try {
      const platform = os.platform();
      
      if (platform === 'darwin') {
        // macOS: pbpaste
        return execSync('pbpaste', { encoding: 'utf8' });
      }
      
      if (platform === 'linux') {
        // Linux: 优先 xclip
        try {
          return execSync('xclip -selection clipboard -o', { encoding: 'utf8' });
        } catch (_) {
          try {
            return execSync('xsel --clipboard --output', { encoding: 'utf8' });
          } catch (__) {
            return null;
          }
        }
      }
      
      if (platform === 'win32') {
        // Windows: PowerShell Get-Clipboard
        return execSync('powershell -NoProfile -Command "Get-Clipboard"', {
          encoding: 'utf8'
        }).trim();
      }
      
      return null;
      
    } catch (error) {
      console.warn('⚠️  读取剪贴板失败:', error.message);
      return null;
    }
  }
  
  /**
   * 检查剪贴板功能是否可用
   * @returns {boolean}
   */
  static isAvailable() {
    const testText = `__autosnippet_test_${Date.now()}`;
    const success = this.write(testText);
    if (!success) return false;
    
    // 验证是否真的写入成功
    const read = this.read();
    return read && read.includes('__autosnippet_test_');
  }
}

module.exports = ClipboardManager;
