/**
 * SpmDepsServiceV2 - SPM 依赖管理服务
 * 
 * 职责：
 * - SPM 依赖图构建与查询
 * - 依赖可达性检查（BFS）
 * - Package.swift 自动补齐与修复
 * - 依赖映射管理
 * 
 * @class SpmDepsServiceV2
 */

const fs = require('fs');
const path = require('path');
const paths = require('../../config/Paths.js');
const PackageParserV2 = require('./PackageParserV2');
const spmDepMapUpdater = require('./spmDepMapUpdater.js');
const swiftParserClient = require('./swiftParserClient.js');

const DEP_GRAPH_CACHE_PREFIX = 'DepGraphCache_';
const SPM_DEP_MAP_FILE = 'AutoSnippet.spmmap.json';

class SpmDepsServiceV2 {
  constructor(projectRoot, config = {}) {
    this.projectRoot = projectRoot;
    this.config = this._parseConfig(config);
    this.logger = this._createLogger();
    this.depGraphCache = new Map();
  }

  // ============ Public API ============

  /**
   * 获取修复模式
   * @param {string} specFile - spec 文件路径
   * @returns {string} 'off' | 'suggest' | 'fix'
   */
  getFixMode(specFile) {
    try {
      // 环境变量优先
      const envMode = process.env.ASD_FIX_SPM_DEPS_MODE;
      if (envMode === 'off' || envMode === 'suggest' || envMode === 'fix') {
        return envMode;
      }

      if (process.env.ASD_FIX_SPM_DEPS === '1' || process.env.ASD_FIX_SPM_DEPS === 'true') {
        return 'fix';
      }

      // spec 文件配置
      if (specFile) {
        const raw = fs.readFileSync(specFile, 'utf8');
        if (raw) {
          const obj = JSON.parse(raw);
          const mode = obj && obj.spmFixDepsMode;
          if (mode === 'off' || mode === 'suggest' || mode === 'fix') {
            return mode;
          }
        }
      }

      return 'off';
    } catch (e) {
      this.logger.warn('Get fix mode failed', { error: e.message });
      return 'off';
    }
  }

  /**
   * 获取或构建依赖图
   * @param {string} packageSwiftPath - Package.swift 文件路径
   * @returns {Promise<Object|null>}
   */
  async getOrBuildDepGraph(packageSwiftPath) {
    try {
      if (!packageSwiftPath || !fs.existsSync(packageSwiftPath)) {
        return null;
      }

      // 内存缓存
      if (this.depGraphCache.has(packageSwiftPath)) {
        return this.depGraphCache.get(packageSwiftPath);
      }

      // 磁盘缓存检查
      const cacheFile = this._getDepGraphCacheFile(packageSwiftPath);
      const cached = this._readJsonSafe(cacheFile);
      
      if (cached) {
        const stat = fs.statSync(packageSwiftPath);
        if (cached.mtimeMs === stat.mtimeMs) {
          this.depGraphCache.set(packageSwiftPath, cached);
          return cached;
        }
      }

      // 构建新的依赖图
      const graph = await this._buildDepGraph(packageSwiftPath);
      if (graph) {
        this._writeJsonSafe(cacheFile, graph);
        this.depGraphCache.set(packageSwiftPath, graph);
      }

      return graph;
    } catch (e) {
      this.logger.error('Get or build dep graph failed', { error: e.message });
      return null;
    }
  }

  /**
   * 检查目标可达性（BFS）
   * @param {Object} depGraph - 依赖图
   * @param {string} fromTarget - 源目标
   * @param {string} toTarget - 目标
   * @returns {boolean}
   */
  isReachable(depGraph, fromTarget, toTarget) {
    try {
      if (!depGraph || !depGraph.targets) {
        return false;
      }

      if (fromTarget === toTarget) {
        return true;
      }

      const visited = new Set();
      const queue = [fromTarget];
      visited.add(fromTarget);

      while (queue.length > 0) {
        const current = queue.shift();
        const node = depGraph.targets[current];
        
        if (!node || !Array.isArray(node.dependencies)) {
          continue;
        }

        for (const dep of node.dependencies) {
          const next = this._normalizeDepToTarget(dep, depGraph.targetsList);
          if (!next) continue;

          if (next === toTarget) {
            return true;
          }

          if (!visited.has(next)) {
            visited.add(next);
            queue.push(next);
          }
        }
      }

      return false;
    } catch (e) {
      this.logger.error('Check reachability failed', { error: e.message });
      return false;
    }
  }

  /**
   * 确保依赖存在（自动补齐）
   * @param {string} specFile - spec 文件路径
   * @param {string} packageSwiftPath - Package.swift 路径
   * @param {string} fromTarget - 源目标
   * @param {string} toTarget - 目标
   * @returns {Promise<Object>} 结果对象
   */
  async ensureDependency(specFile, packageSwiftPath, fromTarget, toTarget) {
    try {
      if (!toTarget) {
        return { ok: false, error: 'toTarget is required' };
      }

      const depGraph = await this.getOrBuildDepGraph(packageSwiftPath);
      if (!depGraph) {
        return { ok: false, error: 'Failed to build dependency graph' };
      }

      // 已存在依赖
      if (this._hasDirectDependency(depGraph, fromTarget, toTarget)) {
        return { ok: true, changed: false, reason: 'alreadyExists' };
      }

      // 检查可达性
      if (this.isReachable(depGraph, fromTarget, toTarget)) {
        return { ok: true, changed: false, reason: 'alreadyReachable' };
      }

      const mode = this.getFixMode(specFile);

      // 建议模式
      if (mode === 'off' || mode === 'suggest') {
        return {
          ok: false,
          changed: false,
          mode,
          reason: 'missingDependency',
          file: packageSwiftPath,
          suggestion: this._suggestPatch(packageSwiftPath, fromTarget, toTarget)
        };
      }

      // 修复模式：修改 Package.swift
      const result = this._patchPackageSwiftAddTargetDependency(packageSwiftPath, fromTarget, toTarget);
      if (!result.ok) {
        return {
          ok: false,
          changed: false,
          mode,
          reason: 'fixFailed',
          file: packageSwiftPath,
          error: result.error,
          suggestion: this._suggestPatch(packageSwiftPath, fromTarget, toTarget)
        };
      }

      // 刷新缓存
      if (result.changed) {
        this.depGraphCache.delete(packageSwiftPath);
        const fresh = await this._buildDepGraph(packageSwiftPath);
        if (fresh) {
          const cacheFile = this._getDepGraphCacheFile(packageSwiftPath);
          this._writeJsonSafe(cacheFile, fresh);
          this.depGraphCache.set(packageSwiftPath, fresh);
        }
      }

      this.logger.log('Dependency ensured', { fromTarget, toTarget, changed: result.changed });
      return {
        ok: true,
        changed: !!result.changed,
        mode,
        file: packageSwiftPath,
        changes: result.changes || []
      };
    } catch (e) {
      this.logger.error('Ensure dependency failed', { error: e.message });
      return { ok: false, error: e.message };
    }
  }

  /**
   * 清空缓存
   */
  clearCache() {
    this.depGraphCache.clear();
  }

  // ============ Private Methods ============

  /**
   * 解析配置
   * @private
   */
  _parseConfig(config) {
    return {
      enableCache: config.enableCache !== false,
      cacheDir: config.cacheDir,
      ...config
    };
  }

  /**
   * 创建日志器
   * @private
   */
  _createLogger() {
    const debug = process.env.DEBUG && process.env.DEBUG.includes('SpmDepsServiceV2');
    return {
      log: (msg, data) => debug && console.log(`[SpmDepsServiceV2] ✓ ${msg}`, data || ''),
      warn: (msg, data) => console.warn(`[SpmDepsServiceV2] ⚠️ ${msg}`, data || ''),
      error: (msg, data) => console.error(`[SpmDepsServiceV2] ❌ ${msg}`, data || '')
    };
  }

  /**
   * 获取依赖图缓存文件路径
   * @private
   */
  _getDepGraphCacheFile(packageSwiftPath) {
    const cachePath = paths.getCachePath();
    const pathBuff = Buffer.from(path.resolve(packageSwiftPath), 'utf-8');
    const fileName = DEP_GRAPH_CACHE_PREFIX + pathBuff.toString('base64') + '.json';
    return path.join(cachePath, fileName);
  }

  /**
   * 安全读取 JSON
   * @private
   */
  _readJsonSafe(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf8');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * 安全写入 JSON
   * @private
   */
  _writeJsonSafe(filePath, obj) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(obj, null, 4), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 构建依赖图
   * @private
   */
  async _buildDepGraph(packageSwiftPath) {
    try {
      if (!fs.existsSync(packageSwiftPath)) {
        return null;
      }

      const stat = fs.statSync(packageSwiftPath);
      const projectRoot = path.dirname(packageSwiftPath);
      
      // 尝试用 swiftParserClient
      let pkgInfo = await swiftParserClient.parsePackage(packageSwiftPath, {
        projectRoot,
        resolveLocalPaths: true,
        timeoutMs: Number(process.env.ASD_SWIFT_PARSER_TIMEOUT_MS) || 5000,
      });
      
      // 回退到 PackageParserV2
      if (!pkgInfo) {
        const parser = new PackageParserV2(projectRoot);
        pkgInfo = await parser.parsePackageSwift(packageSwiftPath);
      }
      
      if (!pkgInfo) {
        return null;
      }

      return {
        schemaVersion: 1,
        packagePath: path.resolve(packageSwiftPath),
        packageDir: path.dirname(path.resolve(packageSwiftPath)),
        mtimeMs: stat.mtimeMs,
        packageName: pkgInfo.name || null,
        targets: pkgInfo.targetsInfo || {},
        targetsList: pkgInfo.targets || [],
      };
    } catch (e) {
      this.logger.error('Build dep graph failed', { error: e.message });
      return null;
    }
  }

  /**
   * 规范化依赖到目标名
   * @private
   */
  _normalizeDepToTarget(dep, targetsList) {
    if (!dep) return null;
    if (typeof dep === 'string') return dep;
    if (dep.name) return dep.name;
    return null;
  }

  /**
   * 检查直接依赖
   * @private
   */
  _hasDirectDependency(depGraph, fromTarget, toTarget) {
    const node = depGraph && depGraph.targets && depGraph.targets[fromTarget];
    if (!node || !Array.isArray(node.dependencies)) return false;
    return node.dependencies.some(d => d && (d.name === toTarget || d === toTarget));
  }

  /**
   * 生成补丁建议
   * @private
   */
  _suggestPatch(packageSwiftPath, fromTarget, toTarget) {
    return `Package.swift: ${packageSwiftPath}\n在 .target(name: "${fromTarget}", ...) 的 dependencies 中添加：\n	 - "${toTarget}"`;
  }

  /**
   * 修补 Package.swift 添加目标依赖
   * @private
   */
  _patchPackageSwiftAddTargetDependency(packageSwiftPath, fromTarget, toTarget) {
    try {
      const src = fs.readFileSync(packageSwiftPath, 'utf8');
      if (!src) return { ok: false, error: 'File is empty' };

      const targetRegex = new RegExp(
        String.raw`\.target\s*\(\s*name:\s*"${fromTarget}"\s*,\s*(?:dependencies:\s*\[` +
        String.raw`([^\]]*)\]\s*)?`,
        's'
      );

      const match = src.match(targetRegex);
      if (!match) {
        return { ok: false, error: `Target "${fromTarget}" not found` };
      }

      const depsContent = match[1] || '';
      const alreadyExists = new RegExp(`"${toTarget}"\\s*(?:[,\\]])`).test(depsContent);
      
      if (alreadyExists) {
        return { ok: true, changed: false };
      }

      // 在 dependencies 数组中添加新依赖
      const newDeps = depsContent.trim()
        ? depsContent.trim() + `,\n\t\t\t"${toTarget}"`
        : `"${toTarget}"`;

      const patchedSrc = src.replace(targetRegex, (matched) => {
        return matched.replace(/dependencies:\s*\[\s*([^\]]*)\]/s, `dependencies: [${newDeps}]`);
      });

      fs.writeFileSync(packageSwiftPath, patchedSrc, 'utf8');
      
      return { ok: true, changed: true, changes: [{ type: 'targetDependency', fromTarget, toTarget }] };
    } catch (e) {
      this.logger.error('Patch Package.swift failed', { error: e.message });
      return { ok: false, error: e.message };
    }
  }
}

module.exports = SpmDepsServiceV2;
