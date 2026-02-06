/**
 * WindowContextManager - 窗口上下文管理器
 * 
 * 职责：
 * - 记录文件保存时发生的窗口信息（应用名称、窗口标题等）
 * - 在代码片段执行时验证窗口一致性
 * - 支持跨平台窗口检测（macOS/Windows/Linux）
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class WindowContextManager {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.platform = process.platform;
    this.savedWindowContexts = new Map(); // filePath -> windowContext
    this.consistencyCheckEnabled = options.consistencyCheck !== false;
  }

  /**
   * 获取当前活跃窗口的信息
   * @returns {Promise<{appName: string, windowTitle: string, timestamp: number, pid?: number}>}
   */
  async getCurrentWindowContext() {
    try {
      if (this.platform === 'darwin') {
        return this._getWindowContextMacOS();
      } else if (this.platform === 'win32') {
        return this._getWindowContextWindows();
      } else if (this.platform === 'linux') {
        return this._getWindowContextLinux();
      }
    } catch (err) {
      this.logger.warn(`[WindowContext] 获取窗口信息失败: ${err.message}`);
    }
    
    return {
      appName: 'unknown',
      windowTitle: 'unknown',
      timestamp: Date.now(),
      error: 'unsupported'
    };
  }

  /**
   * 记录文件保存时的窗口上下文
   * @param {string} filePath - 绝对文件路径
   * @param {object} options - 可选参数（保留以兼容现有调用）
   * @returns {Promise<{filePath: string, windowContext: object}>}
   */
  async recordWindowContext(filePath, options = {}) {
    // 检测真实的窗口应用
    const windowContext = await this.getCurrentWindowContext();
    
    // 添加记录时间戳
    windowContext.recordedAt = Date.now();
    
    this.savedWindowContexts.set(filePath, windowContext);

    if (process.env.ASD_DEBUG === '1') {
      this.logger.log(`[WindowContext] 记录窗口上下文: ${filePath}`);
      this.logger.log(`  应用: ${windowContext.appName}`);
      this.logger.log(`  窗口标题: ${windowContext.windowTitle}`);
      this.logger.log(`  时间戳: ${new Date(windowContext.timestamp).toISOString()}`);
    }

    return { filePath, windowContext };
  }

  /**
   * 验证当前窗口与保存时的窗口是否一致
   * @param {string} filePath - 绝对文件路径
   * @param {object} options - {strict: boolean} - 严格模式（默认 true，即严格模式）
   * @returns {Promise<{consistent: boolean, savedContext: object, currentContext: object, reason?: string}>}
   */
  async verifyWindowConsistency(filePath, options = {}) {
    const { strict = true } = options;
    
    if (!this.consistencyCheckEnabled) {
      return { consistent: true, reason: 'window_check_disabled' };
    }

    const savedContext = this.savedWindowContexts.get(filePath);
    
    // 如果没有之前的记录，视为通过
    if (!savedContext) {
      return { 
        consistent: true, 
        savedContext: null, 
        currentContext: null,
        reason: 'no_previous_record' 
      };
    }

    // 如果保存记录超过 1 小时，认为有效期已过，跳过验证
    const timeDiff = Date.now() - savedContext.recordedAt;
    const CONTEXT_VALIDITY_MS = 60 * 60 * 1000; // 1 小时
    if (timeDiff > CONTEXT_VALIDITY_MS) {
      this.savedWindowContexts.delete(filePath);
      return { 
        consistent: true, 
        savedContext,
        currentContext: null,
        reason: 'context_expired' 
      };
    }

    const currentContext = await this.getCurrentWindowContext();

    // 严格模式：应用名称和窗口标题都要一致
    if (strict) {
      const consistent = currentContext.appName === savedContext.appName &&
                        currentContext.windowTitle === savedContext.windowTitle;
      return {
        consistent,
        savedContext,
        currentContext,
        reason: consistent ? 'strict_match' : 'strict_mismatch'
      };
    }

    // 宽松模式：只验证应用名称（默认）
    const appMatch = currentContext.appName === savedContext.appName;
    
    if (!appMatch) {
      this.logger.warn(`[WindowContext] 窗口不一致警告`);
      this.logger.warn(`  保存时应用: ${savedContext.appName}`);
      this.logger.warn(`  当前应用: ${currentContext.appName}`);
    }

    return {
      consistent: appMatch,
      savedContext,
      currentContext,
      reason: appMatch ? 'app_match' : 'app_mismatch'
    };
  }

  /**
   * 清除文件的窗口记录
   * @param {string} filePath - 绝对文件路径
   */
  clearWindowContext(filePath) {
    this.savedWindowContexts.delete(filePath);
  }

  /**
   * 清除所有窗口记录
   */
  clearAllWindowContexts() {
    this.savedWindowContexts.clear();
  }

  // ==================== macOS 实现 ====================

  /**
   * macOS: 获取窗口信息 (使用简单的 pgrep)
   */
  _getWindowContextMacOS() {
    try {
      // 使用 pgrep 快速获取前台应用（避免 AppleScript 超时）
      // 首先尝试 AppleScript，失败则降级为 pgrep
      let appName = 'unknown';
      
      try {
        // 快速版本：只获取应用名
        const result = execSync(
          `osascript -e 'tell application "System Events" to name of first process where frontmost is true'`,
          { 
            encoding: 'utf8',
            timeout: 500,
            stdio: ['pipe', 'pipe', 'ignore']
          }
        ).trim();
        if (result) appName = result;
      } catch (_) {
        // AppleScript 失败或超时，使用备选方案
        // 检查进程列表（备选但较慢）
        try {
          const output = execSync('ps aux | grep -i "^[^/]*\\(Xcode\\|Finder\\|Code\\|Terminal\\)" | grep -v grep | awk "{print $1}" | head -1', {
            encoding: 'utf8',
            timeout: 300,
            shell: '/bin/bash',
            stdio: ['pipe', 'pipe', 'ignore']
          }).trim();
          if (output) appName = output;
        } catch (_) {}
      }

      return {
        appName,
        windowTitle: appName,
        timestamp: Date.now(),
        platform: 'macOS'
      };
    } catch (err) {
      return {
        appName: 'unknown',
        windowTitle: 'unknown',
        timestamp: Date.now(),
        platform: 'macOS',
        error: 'detection_failed'
      };
    }
  }

  // ==================== Windows 实现 ====================

  /**
   * Windows: 获取窗口信息 (使用 PowerShell)
   */
  _getWindowContextWindows() {
    try {
      // 使用 PowerShell 获取活跃窗口
      const psScript = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;

          public class WindowMethods {
            [DllImport("user32.dll")]
            public static extern IntPtr GetForegroundWindow();
            [DllImport("user32.dll")]
            public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
            [DllImport("user32.dll")]
            public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
          }
        "@

        $hwnd = [WindowMethods]::GetForegroundWindow()
        $sb = New-Object System.Text.StringBuilder 256
        [WindowMethods]::GetWindowText($hwnd, $sb, 256) | Out-Null
        $windowTitle = $sb.ToString()
        
        $pid = 0
        [WindowMethods]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
        $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
        $appName = if ($process) { $process.ProcessName } else { "unknown" }
        
        Write-Output "$appName|$windowTitle"
      `;

      const result = spawnSync('powershell.exe', ['-Command', psScript], {
        encoding: 'utf8',
        timeout: 2000
      });

      if (result.status === 0) {
        const output = result.stdout.trim();
        const [appName, windowTitle] = output.split('|').map(s => s.trim() || 'unknown');
        return {
          appName,
          windowTitle,
          timestamp: Date.now(),
          platform: 'Windows'
        };
      }
    } catch (err) {
      this.logger.debug(`[WindowContext] Windows 窗口检测失败: ${err.message}`);
    }

    return {
      appName: 'unknown',
      windowTitle: 'unknown',
      timestamp: Date.now(),
      platform: 'Windows',
      error: 'detection_failed'
    };
  }

  // ==================== Linux 实现 ====================

  /**
   * Linux: 获取窗口信息 (使用 xdotool/wmctrl)
   */
  _getWindowContextLinux() {
    try {
      // 尝试使用 xdotool
      try {
        const activeWindow = execSync('xdotool getactivewindow', {
          encoding: 'utf8',
          timeout: 2000
        }).trim();

        const windowTitle = execSync(`xdotool getwindowname ${activeWindow}`, {
          encoding: 'utf8',
          timeout: 2000
        }).trim();

        // 获取窗口对应的应用名称
        const wmctrlOutput = execSync('wmctrl -l', {
          encoding: 'utf8',
          timeout: 2000
        });

        const lines = wmctrlOutput.split('\n');
        let appName = 'unknown';
        for (const line of lines) {
          if (line.includes(activeWindow) || line.endsWith(windowTitle)) {
            const parts = line.split(/\s+/);
            if (parts.length > 2) {
              appName = parts[parts.length - 1];
            }
            break;
          }
        }

        return {
          appName,
          windowTitle,
          timestamp: Date.now(),
          platform: 'Linux'
        };
      } catch (_) {
        // 如果 xdotool 不可用，尝试 wmctrl
        const wmctrlOutput = execSync('wmctrl -l', {
          encoding: 'utf8',
          timeout: 2000
        });

        const lines = wmctrlOutput.split('\n');
        if (lines.length > 0) {
          const lastLine = lines[0];
          const parts = lastLine.split(/\s+/);
          return {
            appName: parts[parts.length - 1] || 'unknown',
            windowTitle: parts.slice(4).join(' ') || 'unknown',
            timestamp: Date.now(),
            platform: 'Linux'
          };
        }
      }
    } catch (err) {
      this.logger.debug(`[WindowContext] Linux 窗口检测失败: ${err.message}`);
    }

    return {
      appName: 'unknown',
      windowTitle: 'unknown',
      timestamp: Date.now(),
      platform: 'Linux',
      error: 'tools_unavailable'
    };
  }

  /**
   * 获取保存的窗口信息统计
   * @returns {object}
   */
  getStatistics() {
    const stats = {
      totalRecords: this.savedWindowContexts.size,
      byApp: {},
      records: []
    };

    for (const [filePath, context] of this.savedWindowContexts) {
      const appName = context.appName || 'unknown';
      stats.byApp[appName] = (stats.byApp[appName] || 0) + 1;
      stats.records.push({
        filePath,
        appName,
        windowTitle: context.windowTitle,
        recordedAt: new Date(context.recordedAt).toISOString()
      });
    }

    return stats;
  }
}

module.exports = new WindowContextManager();
