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
const spmDepMapUpdater = require('./spmDepMapUpdater.js');
const DepPolicyEngine = require('./DepPolicyEngine');
const DepGraphService = require('./DepGraphService');
const DepFixer = require('./DepFixer');
const DepReport = require('./DepReport');


const SPM_DEP_MAP_FILE = 'AutoSnippet.spmmap.json';

class SpmDepsServiceV2 {
  constructor(projectRoot, config = {}) {
  this.projectRoot = projectRoot;
  this.config = this._parseConfig(config);
  this.logger = this._createLogger();
  this.policyEngine = new DepPolicyEngine();
  this.graphService = new DepGraphService(projectRoot, this.config);
  this.fixer = new DepFixer();
  this.reporter = new DepReport();
  this._spmmapLastUpdateMs = 0;
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

    return 'suggest';
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
  return this.graphService.getOrBuildDepGraph(packageSwiftPath);
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
  async ensureDependency(specFile, packageSwiftPath, fromTarget, toTarget, options = {}) {
  try {
    if (!toTarget) {
    return { ok: false, error: 'toTarget is required' };
    }

    await this._ensureSpmmapUpdated();
    const spmmap = this._loadSpmmap();

    // 跨包循环检测（基于 Package.swift 依赖图）
    const toPackagePath = await this._findPackageByTarget(toTarget, spmmap);
    if (toPackagePath && path.resolve(toPackagePath) !== path.resolve(packageSwiftPath)) {
    const packageGraph = await this._getPackageDepGraph();
    const hasCycle = this._canReachPackage(packageGraph, toPackagePath, packageSwiftPath);
    if (hasCycle) {
      return {
      ok: false,
      changed: false,
      reason: 'cycleBlocked',
      allowActions: ['cancel'],
      message: `跨包循环依赖：${path.basename(packageSwiftPath)} -> ${path.basename(toPackagePath)} -> ... -> ${path.basename(packageSwiftPath)}`
      };
    }
    }

    const depGraph = await this.getOrBuildDepGraph(packageSwiftPath);
    if (!depGraph) {
    return { ok: false, error: 'Failed to build dependency graph' };
    }

    const fromPackageName = depGraph.packageName || null;
    const toPackageName = this._resolvePackageNameByTarget(spmmap, toTarget) || null;

    // 层级分析
    const analysis = this.graphService.getAnalyzer().analyze(depGraph);

    // 已存在依赖
    if (this._hasDirectDependency(depGraph, fromTarget, toTarget)) {
    return { ok: true, changed: false, reason: 'alreadyExists', allowActions: ['insertAnyway'] };
    }

    // 检查可达性
    if (this.isReachable(depGraph, fromTarget, toTarget)) {
    return { ok: true, changed: false, reason: 'alreadyReachable', allowActions: ['insertAnyway'] };
    }

    // 依赖策略决策（循环/反向）
    const policy = this.policyEngine.checkPolicy({
    fromTarget,
    toTarget,
    depGraph,
    analysis,
    isReachable: (graph, from, to) => this.isReachable(graph, from, to)
    });

    if (policy && policy.blocked) {
    return {
      ok: false,
      changed: false,
      reason: policy.reason,
      allowActions: ['cancel'],
      message: policy.message
    };
    }

    // 向上依赖/同层依赖缺失
    const mode = this.getFixMode(specFile);
    const allowActions = ['insertAnyway'];
    if (mode !== 'off') {
    allowActions.push('suggestPatch');
    allowActions.push('cancel');
    }
    if (mode === 'fix') allowActions.push('autoFix');

    // 建议/修复模式（未确认时）
    if (mode === 'off' || mode === 'suggest' || (mode === 'fix' && !options.forceFix)) {
    return {
      ok: false,
      changed: false,
      mode,
      reason: 'missingDependency',
      file: packageSwiftPath,
      suggestion: this.reporter.buildMissingDependencyReport(packageSwiftPath, fromTarget, toTarget),
      allowActions
    };
    }

    // 修复模式：修改 Package.swift
    const result = this.fixer.patchPackageSwiftAddTargetDependency(packageSwiftPath, fromTarget, toTarget, {
    spmmap,
    fromPackageName,
    toPackageName,
    projectRoot: this.projectRoot
    });
    if (!result.ok) {
    return {
      ok: false,
      changed: false,
      mode,
      reason: 'fixFailed',
      file: packageSwiftPath,
      error: result.error,
      suggestion: this.reporter.buildMissingDependencyReport(packageSwiftPath, fromTarget, toTarget),
      allowActions
    };
    }

    // 刷新缓存
    if (result.changed) {
    this.graphService.clearCache();
    await this.graphService.rebuildAndCache(packageSwiftPath);
    await this._ensureSpmmapUpdated(true);
    }

    this.logger.log('Dependency ensured', { fromTarget, toTarget, changed: result.changed });
    return {
    ok: true,
    changed: !!result.changed,
    mode,
    file: packageSwiftPath,
    changes: result.changes || [],
    allowActions
    };
  } catch (e) {
    this.logger.error('Ensure dependency failed', { error: e.message });
    return { ok: false, error: e.message };
  }
  }

  // ===== package-level helpers =====

  async _findPackageByTarget(targetName) {
  if (!targetName) return null;
  const packages = await this._getAllPackageSwiftPaths();
  for (const pkgPath of packages) {
    const graph = await this.graphService.getOrBuildDepGraph(pkgPath);
    if (graph && Array.isArray(graph.targetsList) && graph.targetsList.includes(targetName)) {
    return pkgPath;
    }
  }
  return null;
  }

  async _ensureSpmmapUpdated(force = false) {
  const now = Date.now();
  if (!force && now - this._spmmapLastUpdateMs < 5000) return;
  this._spmmapLastUpdateMs = now;
  try {
    await spmDepMapUpdater.updateSpmDepMap(this.projectRoot, { aggressive: true });
  } catch (e) {
    this.logger.warn('Auto update spmmap failed', { error: e.message });
  }
  }

  _loadSpmmap() {
  try {
    const knowledgeDir = require('../../config/Paths').getProjectKnowledgePath(this.projectRoot);
    const mapPath = path.join(knowledgeDir, SPM_DEP_MAP_FILE);
    if (!fs.existsSync(mapPath)) return null;
    const raw = fs.readFileSync(mapPath, 'utf8');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
  }

  _resolvePackageNameByTarget(spmmap, targetName) {
  try {
    if (!spmmap || !targetName) return null;
    const byProduct = spmmap.products && spmmap.products[targetName];
    if (byProduct && byProduct.package) return byProduct.package;
    const packages = spmmap.graph && spmmap.graph.packages ? spmmap.graph.packages : {};
    for (const [pkgName, info] of Object.entries(packages)) {
    const targets = info && info.targets ? info.targets : [];
    if (Array.isArray(targets) && targets.includes(targetName)) return pkgName;
    }
    return null;
  } catch {
    return null;
  }
  }

  async _getPackageDepGraph() {
  const packages = await this._getAllPackageSwiftPaths();
  const graph = new Map();
  for (const pkgPath of packages) {
    graph.set(pkgPath, this._parseLocalPackageDeps(pkgPath));
  }
  return graph;
  }

  _parseLocalPackageDeps(packageSwiftPath) {
  try {
    const content = fs.readFileSync(packageSwiftPath, 'utf8');
    if (!content) return [];
    const deps = [];
    const regex = /\.package\s*\(\s*path\s*:\s*"([^"]+)"\s*\)/g;
    let match;
    const baseDir = path.dirname(packageSwiftPath);
    while ((match = regex.exec(content)) !== null) {
    const rel = match[1];
    const depPackageSwift = path.resolve(baseDir, rel, 'Package.swift');
    if (fs.existsSync(depPackageSwift)) deps.push(depPackageSwift);
    }
    return deps;
  } catch {
    return [];
  }
  }

  _canReachPackage(graph, fromPkg, toPkg) {
  try {
    if (!graph || !fromPkg || !toPkg) return false;
    const start = path.resolve(fromPkg);
    const target = path.resolve(toPkg);
    if (start === target) return true;
    const visited = new Set([start]);
    const queue = [start];
    while (queue.length) {
    const current = queue.shift();
    const deps = graph.get(current) || [];
    for (const dep of deps) {
      const resolved = path.resolve(dep);
      if (resolved === target) return true;
      if (!visited.has(resolved)) {
      visited.add(resolved);
      queue.push(resolved);
      }
    }
    }
    return false;
  } catch {
    return false;
  }
  }

  async _getAllPackageSwiftPaths() {
  if (this._packagePathsCache) return this._packagePathsCache;
  const ignore = new Set([
    '.git', '.build', '.swiftpm', '.autosnippet', 'node_modules', 'Pods',
    'Carthage', 'DerivedData', 'build', 'AutoSnippet'
  ]);
  const results = [];
  const stack = [this.projectRoot];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
    continue;
    }
    for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignore.has(entry.name)) continue;
      stack.push(path.join(dir, entry.name));
      continue;
    }
    if (entry.isFile() && entry.name === 'Package.swift') {
      results.push(path.join(dir, entry.name));
    }
    }
  }
  this._packagePathsCache = results;
  return results;
  }

  /**
   * 清空缓存
   */
  clearCache() {
  this.graphService.clearCache();
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
}

module.exports = SpmDepsServiceV2;
