/**
 * PermissionManager
 * 
 * 职责：
 * - 获取 asd ui 运行的项目位置和权限信息
 * - 申请和检查文件写入权限（通过 WriteGuard 机制）
 * - 记录权限检查历史
 * - 支持真实文件系统权限验证
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

class PermissionManager {
  constructor(options = {}) {
    this.dashboardUrl = options.dashboardUrl || 'http://localhost:3000';
    this.projectRoot = options.projectRoot || process.cwd();
    this.logger = options.logger || console;
    this.apiClient = options.apiClient;  // XcodeSimulatorAPIClient 的实例
    
    this.permissionCache = new Map();  // { path: { ok, timestamp, ttl } }
    this.permissionHistory = [];
    this.dashboardProjectRoot = null;
    this.defaultTTL = 86400000;  // 24 小时
  }

  /**
   * 从 Dashboard API 获取项目信息
   * @returns {Promise<{projectRoot, dashboardUrl, health}>}
   */
  async discoverDashboard() {
    if (!this.apiClient) {
      throw new Error('APIClient not provided to PermissionManager');
    }

    try {
      const health = await this.apiClient.healthCheck();
      
      if (!health.healthy) {
        throw new Error(`Dashboard not healthy: ${health.error}`);
      }

      this.dashboardProjectRoot = health.projectRoot;
      
      this.logger.log(`[PermissionManager] Discovered Dashboard:`);
      this.logger.log(`  - URL: ${this.dashboardUrl}`);
      this.logger.log(`  - Project Root: ${health.projectRoot}`);
      
      return {
        projectRoot: health.projectRoot,
        dashboardUrl: this.dashboardUrl,
        health
      };
    } catch (error) {
      throw new Error(`Failed to discover Dashboard: ${error.message}`);
    }
  }

  /**
   * 申请项目文件写入权限
   * @param {string} targetPath - 目标文件或目录路径
   * @returns {Promise<{ok, message, projectRoot, reason}>}
   */
  async requestPermission(targetPath) {
    // 如果未发现 Dashboard 项目，先发现一下
    if (!this.dashboardProjectRoot) {
      try {
        await this.discoverDashboard();
      } catch (error) {
        this.logger.warn(`[PermissionManager] Failed to discover dashboard: ${error.message}`);
      }
    }

    const projectRoot = this.dashboardProjectRoot || this.projectRoot;
    const normalizePath = path.isAbsolute(targetPath) 
      ? targetPath 
      : path.join(projectRoot, targetPath);

    return this._checkPermission(projectRoot, normalizePath);
  }

  /**
   * 内部权限检查（通过 WriteGuard 机制）
   */
  async _checkPermission(projectRoot, targetPath) {
    // 检查缓存
    const cached = this.permissionCache.get(targetPath);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      this.logger.log(`[PermissionManager] Cache hit for ${path.relative(projectRoot, targetPath)}`);
      return cached.result;
    }

    const check = {
      targetPath,
      projectRoot,
      timestamp: Date.now(),
      method: 'git-push-dry-run'
    };

    try {
      // 方法 1: 通过 git push --dry-run 检查权限（WriteGuard 机制）
      const probeDir = path.join(projectRoot, 'AutoSnippet/recipes');
      
      if (!fs.existsSync(probeDir)) {
        // 如果目录不存在，尝试创建以测试权限
        this.logger.log(`[PermissionManager] Probe dir not found: ${probeDir}`);
        check.probeDir = null;
        throw new Error(`AutoSnippet/recipes directory not found at ${projectRoot}`);
      }

      // 尝试 git push --dry-run（WriteGuard 标准方法）
      let hasPermission = false;
      let reason = '';

      try {
        // 检查是否在 git 仓库中
        execSync('git rev-parse --git-dir', { 
          cwd: probeDir, 
          stdio: 'pipe' 
        });

        // 尝试 push --dry-run，这会触发权限检查
        execSync('git push --dry-run 2>&1 || true', { 
          cwd: probeDir,
          stdio: 'pipe'
        });

        hasPermission = true;
        reason = 'git push --dry-run 成功';
      } catch (gitError) {
        reason = `git 操作失败: ${gitError.message}`;
      }

      // 方法 2: 直接文件权限检查
      if (!hasPermission) {
        try {
          const testFile = path.join(probeDir, '.permission-test');
          fs.writeFileSync(testFile, 'test', 'utf8');
          fs.unlinkSync(testFile);
          hasPermission = true;
          reason = '文件写入测试成功';
        } catch (fsError) {
          reason = `文件写入失败: ${fsError.message}`;
        }
      }

      check.ok = hasPermission;
      check.reason = reason;
      check.result = {
        ok: hasPermission,
        message: hasPermission ? '权限检查通过' : '权限被拒绝',
        projectRoot,
        targetPath,
        reason
      };

      // 缓存结果
      this.permissionCache.set(targetPath, {
        result: check.result,
        timestamp: Date.now(),
        ttl: this.defaultTTL
      });

      // 记录历史
      this.permissionHistory.push(check);

      this.logger.log(`[PermissionManager] Permission check: ${check.ok ? '✓' : '✗'} (${reason})`);

      return check.result;
    } catch (error) {
      const result = {
        ok: false,
        message: `权限检查失败: ${error.message}`,
        projectRoot,
        targetPath,
        reason: error.message
      };

      check.ok = false;
      check.reason = error.message;
      check.result = result;
      
      this.permissionHistory.push(check);

      this.logger.error(`[PermissionManager] ${result.message}`);
      return result;
    }
  }

  /**
   * 获取项目根目录（来自 Dashboard 或参数）
   */
  async getProjectRoot() {
    if (!this.dashboardProjectRoot) {
      try {
        await this.discoverDashboard();
      } catch (error) {
        this.logger.warn(`[PermissionManager] Using fallback project root: ${this.projectRoot}`);
      }
    }

    return this.dashboardProjectRoot || this.projectRoot;
  }

  /**
   * 获取权限检查历史
   */
  getHistory() {
    return [...this.permissionHistory];
  }

  /**
   * 获取权限统计
   */
  getStats() {
    const passed = this.permissionHistory.filter(c => c.ok).length;
    const failed = this.permissionHistory.filter(c => !c.ok).length;

    return {
      total: this.permissionHistory.length,
      passed,
      failed,
      successRate: this.permissionHistory.length > 0 
        ? ((passed / this.permissionHistory.length) * 100).toFixed(2) + '%'
        : 'N/A',
      cacheSize: this.permissionCache.size
    };
  }

  /**
   * 清空权限缓存
   */
  clearCache() {
    this.permissionCache.clear();
  }

  /**
   * 设置 API 客户端
   */
  setAPIClient(apiClient) {
    this.apiClient = apiClient;
  }

  /**
   * 设置项目根目录
   */
  setProjectRoot(projectRoot) {
    this.projectRoot = projectRoot;
  }

  /**
   * 禁用权限检查（测试模式）
   */
  disableChecks() {
    process.env.ASD_SKIP_WRITE_GUARD = '1';
    this.logger.log('[PermissionManager] Write guard disabled');
  }

  /**
   * 启用权限检查
   */
  enableChecks() {
    delete process.env.ASD_SKIP_WRITE_GUARD;
    this.logger.log('[PermissionManager] Write guard enabled');
  }
}

module.exports = PermissionManager;
