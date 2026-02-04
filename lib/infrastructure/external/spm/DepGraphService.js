/**
 * DepGraphService - 依赖图构建与缓存
 */

const fs = require('fs');
const path = require('path');
const paths = require('../../config/Paths.js');
const PackageParserV2 = require('./PackageParserV2');
const DepGraphAnalyzer = require('./DepGraphAnalyzer');
const swiftParserClient = require('./swiftParserClient.js');

const DEP_GRAPH_CACHE_PREFIX = 'DepGraphCache_';

class DepGraphService {
  constructor(projectRoot, config = {}) {
    this.projectRoot = projectRoot;
    this.config = this._parseConfig(config);
    this.logger = this._createLogger();
    this.depGraphCache = new Map();
    this.analyzer = new DepGraphAnalyzer();
  }

  getAnalyzer() {
    return this.analyzer;
  }

  async getOrBuildDepGraph(packageSwiftPath) {
    try {
      if (!packageSwiftPath || !fs.existsSync(packageSwiftPath)) {
        return null;
      }

      if (this.depGraphCache.has(packageSwiftPath)) {
        return this.depGraphCache.get(packageSwiftPath);
      }

      const cacheFile = this._getDepGraphCacheFile(packageSwiftPath);
      const cached = this._readJsonSafe(cacheFile);
      if (cached) {
        const stat = fs.statSync(packageSwiftPath);
        if (cached.mtimeMs === stat.mtimeMs) {
          this.depGraphCache.set(packageSwiftPath, cached);
          return cached;
        }
      }

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

  clearCache() {
    this.depGraphCache.clear();
  }

  async rebuildAndCache(packageSwiftPath) {
    const fresh = await this._buildDepGraph(packageSwiftPath);
    if (fresh) {
      const cacheFile = this._getDepGraphCacheFile(packageSwiftPath);
      this._writeJsonSafe(cacheFile, fresh);
      this.depGraphCache.set(packageSwiftPath, fresh);
    }
    return fresh;
  }

  // ===== private =====

  _parseConfig(config) {
    return {
      enableCache: config.enableCache !== false,
      cacheDir: config.cacheDir,
      ...config
    };
  }

  _createLogger() {
    const debug = process.env.DEBUG && process.env.DEBUG.includes('DepGraphService');
    return {
      log: (msg, data) => debug && console.log(`[DepGraphService] ✓ ${msg}`, data || ''),
      warn: (msg, data) => console.warn(`[DepGraphService] ⚠️ ${msg}`, data || ''),
      error: (msg, data) => console.error(`[DepGraphService] ❌ ${msg}`, data || '')
    };
  }

  _getDepGraphCacheFile(packageSwiftPath) {
    const cachePath = paths.getCachePath();
    const pathBuff = Buffer.from(path.resolve(packageSwiftPath), 'utf-8');
    const fileName = DEP_GRAPH_CACHE_PREFIX + pathBuff.toString('base64') + '.json';
    return path.join(cachePath, fileName);
  }

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

  async _buildDepGraph(packageSwiftPath) {
    try {
      if (!fs.existsSync(packageSwiftPath)) {
        return null;
      }

      const stat = fs.statSync(packageSwiftPath);
      const projectRoot = path.dirname(packageSwiftPath);
      const spmmapGraph = this._buildDepGraphFromSpmmap(packageSwiftPath, stat);
      if (spmmapGraph) {
        return spmmapGraph;
      }

      let pkgInfo = await swiftParserClient.parsePackage(packageSwiftPath, {
        projectRoot,
        resolveLocalPaths: true,
        timeoutMs: Number(process.env.ASD_SWIFT_PARSER_TIMEOUT_MS) || 5000,
      });

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

  _buildDepGraphFromSpmmap(packageSwiftPath, stat) {
    try {
      const knowledgeDir = paths.getProjectKnowledgePath(this.projectRoot);
      const mapPath = path.join(knowledgeDir, 'AutoSnippet.spmmap.json');
      if (!fs.existsSync(mapPath)) return null;
      const raw = fs.readFileSync(mapPath, 'utf8');
      if (!raw) return null;
      const map = JSON.parse(raw);
      const graph = map && map.graph ? map.graph : null;
      if (!graph || !graph.packages) return null;

      const relSwift = path.relative(this.projectRoot, packageSwiftPath).replace(/\\/g, '/');
      const relDir = path.relative(this.projectRoot, path.dirname(packageSwiftPath)).replace(/\\/g, '/');
      let pkgName = null;
      let pkgInfo = null;
      for (const [name, info] of Object.entries(graph.packages)) {
        if (!info) continue;
        if (info.packageSwift === relSwift || info.packageDir === relDir) {
          pkgName = name;
          pkgInfo = info;
          break;
        }
      }
      if (!pkgInfo || !pkgInfo.targetsInfo) return null;

      return {
        schemaVersion: 1,
        packagePath: path.resolve(packageSwiftPath),
        packageDir: path.dirname(path.resolve(packageSwiftPath)),
        mtimeMs: stat.mtimeMs,
        packageName: pkgName || null,
        targets: pkgInfo.targetsInfo || {},
        targetsList: pkgInfo.targets || Object.keys(pkgInfo.targetsInfo || {}),
        fromSpmmap: true,
      };
    } catch {
      return null;
    }
  }
}

module.exports = DepGraphService;
