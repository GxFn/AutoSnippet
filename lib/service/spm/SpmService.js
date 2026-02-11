/**
 * SpmService — SPM 依赖管理门面服务
 * 整合 PackageSwiftParser + DependencyGraph + PolicyEngine
 */

import Logger from '../../infrastructure/logging/Logger.js';
import { PackageSwiftParser } from './PackageSwiftParser.js';
import { DependencyGraph } from './DependencyGraph.js';
import { PolicyEngine } from './PolicyEngine.js';
import { dirname, relative, sep, resolve as pathResolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

export class SpmService {
  #parser;
  #graph;
  #policy;
  #logger;
  #projectRoot;
  #aiFactory;
  #chatAgent;
  #qualityScorer;
  #recipeExtractor;
  #guardCheckEngine;
  #violationsStore;

  /**
   * target → { packageName, packagePath } 映射（V1 spmmap 等价）
   * @type {Map<string, {packageName: string, packagePath: string}>}
   */
  #targetPackageMap;

  /**
   * 包级依赖图：packagePath → Set<packagePath>（用于跨包循环检测）
   * @type {Map<string, Set<string>>}
   */
  #packageDepGraph;

  constructor(projectRoot, options = {}) {
    this.#projectRoot = projectRoot;
    this.#aiFactory = options.aiFactory || null;
    this.#chatAgent = options.chatAgent || null;
    this.#qualityScorer = options.qualityScorer || null;
    this.#recipeExtractor = options.recipeExtractor || null;
    this.#guardCheckEngine = options.guardCheckEngine || null;
    this.#violationsStore = options.violationsStore || null;
    this.#parser = options.parser || new PackageSwiftParser(projectRoot);
    this.#graph = options.graph || new DependencyGraph();
    this.#policy = options.policy || new PolicyEngine();
    this.#logger = Logger.getInstance();
    this.#targetPackageMap = new Map();
    this.#packageDepGraph = new Map();
  }

  /**
   * 加载并解析 Package.swift，构建依赖图
   * 支持多 Package 项目（如 BiliDemo 有多个子 Package）
   */
  async load() {
    this.#targetPackageMap.clear();
    this.#packageDepGraph.clear();

    // 优先尝试根目录的 Package.swift
    const packagePath = this.#parser.findPackageSwift(this.#projectRoot);
    if (packagePath) {
      const parsed = this.#parser.parse(packagePath);
      this.#graph.buildFromParsed(parsed);
      // 构建 target→package 映射
      for (const t of parsed.targets || []) {
        this.#targetPackageMap.set(t.name, { packageName: parsed.name, packagePath });
      }
      // 构建包级依赖图（解析 .package(path: "...") 引用）
      this.#buildPackageDepGraph([{ path: packagePath, parsed }]);
      this.#logger.info(`[SpmService] 加载完成: ${parsed.name} (${parsed.targets.length} targets)`);
      return parsed;
    }

    // 没有根 Package.swift，扫描子目录中的所有 Package.swift
    const allPaths = this.#parser.findAllPackageSwifts(this.#projectRoot);
    if (allPaths.length === 0) {
      this.#logger.warn('[SpmService] Package.swift 未找到');
      return null;
    }

    this.#logger.info(`[SpmService] 发现 ${allPaths.length} 个 Package.swift，逐一解析...`);
    let mergedTargets = [];
    let lastName = 'multi-package';
    const allParsed = [];

    // 先清空图，然后逐个添加节点和边（不用 buildFromParsed 避免重复 clear）
    this.#graph.clear();
    for (const pkgPath of allPaths) {
      try {
        const parsed = this.#parser.parse(pkgPath);
        if (parsed) {
          allParsed.push({ path: pkgPath, parsed });
          // 逐个添加 target 到图中
          for (const t of parsed.targets || []) {
            this.#graph.addNode(t.name);
            for (const dep of t.dependencies || []) {
              this.#graph.addEdge(t.name, dep);
            }
            // 构建 target→package 映射
            this.#targetPackageMap.set(t.name, { packageName: parsed.name, packagePath: pkgPath });
          }
          // 合并 target 列表（带 packageName 标记）
          for (const t of parsed.targets) {
            mergedTargets.push({
              ...t,
              packageName: parsed.name,
              packagePath: pkgPath,
            });
          }
          lastName = parsed.name;
        }
      } catch (e) {
        this.#logger.warn(`[SpmService] 解析失败: ${pkgPath} - ${e.message}`);
      }
    }

    // 构建包级依赖图
    this.#buildPackageDepGraph(allParsed);

    this.#logger.info(`[SpmService] 多包加载完成: ${mergedTargets.length} targets from ${allPaths.length} packages`);
    return {
      name: lastName,
      targets: mergedTargets,
      path: this.#projectRoot,
    };
  }

  // ─────────────── 包级依赖图构建 ───────────────

  /**
   * 解析所有 Package.swift 中的 .package(path: "...") 声明，构建包级依赖图
   * @param {{ path: string, parsed: object }[]} allParsed
   */
  #buildPackageDepGraph(allParsed) {
    this.#packageDepGraph.clear();

    // 初始化所有包节点
    for (const { path: pkgPath } of allParsed) {
      if (!this.#packageDepGraph.has(pkgPath)) {
        this.#packageDepGraph.set(pkgPath, new Set());
      }
    }

    // 建立 dirname → pkgPath 索引（避免 O(n²) 线性扫描）
    const dirToPkgPath = new Map();
    for (const { path: pkgPath } of allParsed) {
      dirToPkgPath.set(dirname(pkgPath), pkgPath);
    }

    // 解析 .package(path: "...") 引用，建立包级边
    for (const { path: pkgPath, parsed } of allParsed) {
      const pkgDir = dirname(pkgPath);
      const packageDeps = parsed.packageDependencies || parsed.dependencies || [];
      for (const dep of packageDeps) {
        if (dep.path) {
          const depAbsDir = pathResolve(pkgDir, dep.path);
          const otherPkgPath = dirToPkgPath.get(depAbsDir);
          if (otherPkgPath) {
            this.#packageDepGraph.get(pkgPath)?.add(otherPkgPath);
          }
        }
      }
    }

    this.#logger.debug(`[SpmService] 包级依赖图: ${this.#packageDepGraph.size} packages`);
  }

  /**
   * BFS 检查包级可达性（V1 _canReachPackage 等价）
   * @param {string} fromPkgPath - 起始包的 Package.swift 路径
   * @param {string} toPkgPath - 目标包的 Package.swift 路径
   * @returns {boolean}
   */
  _canReachPackage(fromPkgPath, toPkgPath) {
    if (fromPkgPath === toPkgPath) return true;
    const visited = new Set();
    const queue = [fromPkgPath];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === toPkgPath) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      const neighbors = this.#packageDepGraph.get(current);
      if (neighbors) {
        for (const n of neighbors) queue.push(n);
      }
    }
    return false;
  }

  // ─────────────── 公共查询 API ───────────────

  /**
   * 获取 target 所属包信息（V1 spmmap 等价）
   * @param {string} targetName
   * @returns {{ packageName: string, packagePath: string } | null}
   */
  getPackageForTarget(targetName) {
    return this.#targetPackageMap.get(targetName) || null;
  }

  /**
   * 获取 Fix Mode 配置 (V1 allowActions 等价)
   * 环境变量: ASD_FIX_SPM_DEPS_MODE = off | suggest | fix
   * - off:     不检查、不提示
   * - suggest: 仅提示（直接插入、提示操作插入按钮，无自动修复）
   * - fix:     完整4按钮（直接插入、提示操作插入、自动修复依赖、取消操作）
   * @returns {'off'|'suggest'|'fix'}
   */
  getFixMode() {
    const env = (process.env.ASD_FIX_SPM_DEPS_MODE || '').toLowerCase().trim();
    if (env === 'off' || env === 'suggest' || env === 'fix') return env;
    return 'suggest'; // 默认仅提示模式
  }

  /**
   * 获取依赖图
   */
  getGraph() {
    return this.#graph;
  }

  /**
   * 检查 from 是否可达 to
   */
  isReachable(from, to) {
    return this.#graph.isReachable(from, to);
  }

  /**
   * 运行策略检查
   * @param {{ layerOrder?: string[] }} config
   */
  checkPolicies(config = {}) {
    return this.#policy.check(this.#graph, config);
  }

  /**
   * 检查能否添加依赖
   */
  canAddDependency(from, to) {
    return this.#policy.canAddDependency(this.#graph, from, to);
  }

  /**
   * 确保依赖存在: 如果不存在则评估是否可以添加
   * 支持跨包循环检测：如果 from 和 to 在不同包内，额外检查包级依赖图
   * @param {string} from - 源 target
   * @param {string} to - 目标 target
   * @returns {{ exists: boolean, canAdd: boolean, reason?: string, crossPackage?: boolean }}
   */
  ensureDependency(from, to) {
    if (this.#graph.isReachable(from, to)) {
      return { exists: true, canAdd: true };
    }

    // target 级策略检查
    const check = this.#policy.canAddDependency(this.#graph, from, to);
    if (!check.allowed) {
      return { exists: false, canAdd: false, reason: check.reason };
    }

    // 跨包循环检测
    const fromPkg = this.#targetPackageMap.get(from);
    const toPkg = this.#targetPackageMap.get(to);
    if (fromPkg && toPkg && fromPkg.packagePath !== toPkg.packagePath) {
      // 检查反向：如果 toPkg 已经能到达 fromPkg，添加 from→to 会形成包级循环
      if (this._canReachPackage(toPkg.packagePath, fromPkg.packagePath)) {
        return {
          exists: false,
          canAdd: false,
          crossPackage: true,
          reason: `跨包循环依赖: ${fromPkg.packageName} ↔ ${toPkg.packageName}`,
        };
      }
      return { exists: false, canAdd: true, crossPackage: true };
    }

    return {
      exists: false,
      canAdd: check.allowed,
      reason: check.reason,
    };
  }

  /**
   * 自动修复依赖：向 Package.swift 中添加 target 级依赖（V1 DepFixer 逻辑）
   *
   * 同包 target → 添加 "TargetName" 到 dependencies
   * 跨包 target → 添加 .product(name: "X", package: "Y") + 确保 .package(path: "...") 声明
   *
   * @param {string} from - 源 target
   * @param {string} to - 目标 target
   * @returns {{ ok: boolean, changed: boolean, file?: string, error?: string, crossPackage?: boolean }}
   */
  addDependency(from, to) {
    // 安全检查
    const check = this.#policy.canAddDependency(this.#graph, from, to);
    if (!check.allowed) {
      return { ok: false, changed: false, error: check.reason || 'policy-blocked' };
    }

    // 判断同包 vs 跨包
    const fromPkg = this.#targetPackageMap.get(from);
    const toPkg = this.#targetPackageMap.get(to);
    const isCrossPackage = fromPkg && toPkg && fromPkg.packagePath !== toPkg.packagePath;

    try {
      // 确定要修改的 Package.swift（from 所在的包）
      const packagePath = fromPkg?.packagePath || this.#parser.findPackageSwift(this.#projectRoot);
      if (!packagePath) {
        return { ok: false, changed: false, error: 'Package.swift not found' };
      }

      let content = readFileSync(packagePath, 'utf8');

      // ── 1. 构建依赖 token ──
      let depToken;
      if (isCrossPackage) {
        // 跨包: .product(name: "TargetName", package: "PackageName")
        depToken = `.product(name: "${to}", package: "${toPkg.packageName}")`;
      } else {
        // 同包: "TargetName"
        depToken = `"${to}"`;
      }

      // ── 2. 向 from target 的 dependencies 添加 token ──
      const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const targetRe = new RegExp(
        `(\\.(?:target|testTarget|executableTarget)\\s*\\(\\s*name\\s*:\\s*"${escaped}"[\\s\\S]*?)\\)`,
        'm'
      );
      const targetMatch = content.match(targetRe);
      if (!targetMatch) {
        return { ok: false, changed: false, error: `Target "${from}" not found in Package.swift` };
      }

      const targetBlock = targetMatch[1];
      let patched;

      const depsRe = /dependencies\s*:\s*\[([^\]]*)\]/s;
      const depsMatch = targetBlock.match(depsRe);

      if (depsMatch) {
        const existingDeps = depsMatch[1].trim();
        const separator = existingDeps.length > 0 ? ',\n            ' : '\n            ';
        const newDeps = `dependencies: [${existingDeps}${separator}${depToken}\n        ]`;
        const newBlock = targetBlock.replace(depsRe, newDeps);
        patched = content.replace(targetBlock, newBlock);
      } else {
        const nameRe = /name\s*:\s*"[^"]+"/;
        const nameMatch = targetBlock.match(nameRe);
        if (!nameMatch) {
          return { ok: false, changed: false, error: `Cannot parse target "${from}" structure` };
        }
        const newBlock = targetBlock.replace(
          nameMatch[0],
          `${nameMatch[0]},\n            dependencies: [${depToken}]`
        );
        patched = content.replace(targetBlock, newBlock);
      }

      if (patched === content) {
        return { ok: false, changed: false, error: 'Patch produced no changes' };
      }

      // ── 3. 跨包: 确保 .package(path: "...") 声明存在 ──
      if (isCrossPackage) {
        const ensureResult = this.#ensurePackageDependency(patched, packagePath, toPkg);
        if (ensureResult.changed) {
          patched = ensureResult.content;
        }
      }

      writeFileSync(packagePath, patched, 'utf8');

      // 更新内存中的图
      this.#graph.addEdge(from, to);
      this.#parser.clearCache();

      this.#logger.info(`[SpmService] 已自动补齐依赖: ${from} -> ${to}${isCrossPackage ? ' (跨包)' : ''} (${packagePath})`);
      return { ok: true, changed: true, file: packagePath, crossPackage: isCrossPackage };
    } catch (err) {
      this.#logger.error(`[SpmService] addDependency failed: ${err.message}`);
      return { ok: false, changed: false, error: err.message };
    }
  }

  /**
   * 确保 Package.swift 中有对目标包的 .package(path: "...") 声明
   * @param {string} content - Package.swift 内容
   * @param {string} fromPkgPath - 当前包的 Package.swift 路径
   * @param {{ packageName: string, packagePath: string }} toPkg - 目标包信息
   * @returns {{ changed: boolean, content: string }}
   */
  #ensurePackageDependency(content, fromPkgPath, toPkg) {
    const fromDir = dirname(fromPkgPath);
    const toDir = dirname(toPkg.packagePath);
    const relPath = relative(fromDir, toDir).split(sep).join('/');

    // 检查是否已有对该路径的 .package 声明
    const escapedPath = relPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existsRe = new RegExp(`\\.package\\s*\\(\\s*(?:name\\s*:[^,]*,\\s*)?path\\s*:\\s*"${escapedPath}"`, 'm');
    if (existsRe.test(content)) {
      return { changed: false, content };
    }

    // 也检查包名
    const escapedName = toPkg.packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameExistsRe = new RegExp(`\\.package\\s*\\(\\s*name\\s*:\\s*"${escapedName}"`, 'm');
    if (nameExistsRe.test(content)) {
      return { changed: false, content };
    }

    // 在 dependencies: [...] （包级）中追加
    const pkgDepsRe = /(dependencies\s*:\s*\[)([\s\S]*?)(\][\s\S]*?targets\s*:)/m;
    const pkgDepsMatch = content.match(pkgDepsRe);
    if (pkgDepsMatch) {
      const existing = pkgDepsMatch[2].trimEnd();
      const separator = existing.length > 0 ? ',\n        ' : '\n        ';
      const newDep = `.package(path: "${relPath}")`;
      const patched = content.replace(
        pkgDepsRe,
        `${pkgDepsMatch[1]}${existing}${separator}${newDep}\n    ${pkgDepsMatch[3]}`
      );
      this.#logger.info(`[SpmService] 已添加包级依赖: .package(path: "${relPath}")`);
      return { changed: true, content: patched };
    }

    this.#logger.warn(`[SpmService] 未能找到包级 dependencies 数组，跳过 .package(path:) 插入`);
    return { changed: false, content };
  }

  /**
   * 推断文件所属 target（源自 V1 ModuleResolverV2.determineCurrentModule）
   *
   * 从文件到 Package.swift 所在目录的相对路径中，反向匹配已知 target 名。
   * @param {string} filePath - 源文件绝对路径
   * @returns {string|null} target 名称，未匹配返回 null
   */
  resolveCurrentTarget(filePath) {
    try {
      const packagePath = this.#parser.findPackageSwift(dirname(filePath));
      if (!packagePath) return null;

      const nodes = this.#graph.getNodes();
      if (nodes.length === 0) return null;

      const packageDir = dirname(packagePath);
      const rel = relative(packageDir, filePath);
      const segments = rel.split(sep);

      // 从路径段反向查找第一个匹配的 target（V1 原始逻辑）
      const nodeSet = new Set(nodes);
      for (let i = segments.length - 1; i >= 0; i--) {
        if (nodeSet.has(segments[i])) return segments[i];
      }

      // 兜底：第一个 target
      return nodes[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * 获取 target 的分层信息
   */
  getLevels() {
    return Object.fromEntries(this.#graph.computeLevels());
  }

  /**
   * 拓扑排序
   */
  getTopologicalOrder() {
    return this.#graph.topologicalSort();
  }

  /**
   * 获取摘要报告
   */
  getSummary() {
    const nodes = this.#graph.getNodes();
    const levels = this.#graph.computeLevels();
    const cycles = this.#graph.detectCycles();

    return {
      nodeCount: nodes.length,
      edgeCount: this.#graph.edgeCount(),
      levels: Object.fromEntries(levels),
      cycleCount: cycles.length,
      cycles: cycles.map(c => c.join(' → ')),
    };
  }

  // ─────────────── Dashboard API 适配方法 ───────────────

  /**
   * 列出所有 SPM Target（路由: GET /spm/targets）
   * 支持多 Package 项目，返回所有包的所有 targets
   */
  async listTargets() {
    await this.#ensureLoaded();

    // 如果图中有节点，先用图数据
    const nodes = this.#graph.getNodes();
    if (nodes.length > 0) {
      return [...nodes].map(name => ({
        name,
        type: 'target',
      }));
    }

    // 图为空时，直接扫描所有 Package.swift（兼容多包项目）
    const allPaths = this.#parser.findAllPackageSwifts(this.#projectRoot);
    if (allPaths.length === 0) return [];

    const { dirname } = await import('path');
    const targets = [];
    for (const pkgPath of allPaths) {
      try {
        const parsed = this.#parser.parse(pkgPath);
        if (parsed && parsed.targets) {
          const pkgDir = dirname(pkgPath);
          for (const t of parsed.targets) {
            targets.push({
              name: t.name,
              packageName: parsed.name,
              packagePath: pkgPath,
              targetDir: pkgDir,
              type: t.type || 'target',
              info: t,
            });
          }
        }
      } catch {
        // Skip unparseable packages
      }
    }
    return targets;
  }

  /**
   * 获取依赖关系图（路由: GET /spm/dep-graph）
   * @param {{ level?: 'package'|'target' }} options
   */
  async getDependencyGraph(options = {}) {
    await this.#ensureLoaded();
    const json = this.#graph.toJSON();

    return {
      nodes: json.nodes.map(name => ({
        id: name,
        label: name,
        type: options.level === 'package' ? 'package' : 'target',
      })),
      edges: json.edges.map(e => ({ from: e.from, to: e.to, source: 'spm' })),
      projectRoot: this.#projectRoot,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * 获取 Target 源文件列表（路由: POST /spm/target-files）
   * 支持多 Package 项目：先在 target 所属 package 目录查找
   */
  async getTargetFiles(target) {
    const { existsSync, readdirSync, statSync } = await import('fs');
    const { join, dirname, relative } = await import('path');

    const targetName = typeof target === 'string' ? target : target?.name;
    if (!targetName) return [];

    // 收集可能的搜索目录
    const searchDirs = [];

    // 1. 如果 target 对象包含 targetDir，使用它
    if (typeof target === 'object' && target?.targetDir) {
      searchDirs.push(join(target.targetDir, 'Sources', targetName));
      searchDirs.push(join(target.targetDir, targetName));
      // 如果有 info.path，也加入
      if (target.info?.path) {
        searchDirs.push(join(target.targetDir, target.info.path));
      }
    }

    // 2. 扫描所有 Package.swift，找到包含这个 target 的 package
    const allPaths = this.#parser.findAllPackageSwifts(this.#projectRoot);
    for (const pkgPath of allPaths) {
      try {
        const parsed = this.#parser.parse(pkgPath);
        if (parsed?.targets?.some(t => t.name === targetName)) {
          const pkgDir = dirname(pkgPath);
          const matchTarget = parsed.targets.find(t => t.name === targetName);
          if (matchTarget?.path) {
            searchDirs.push(join(pkgDir, matchTarget.path));
          }
          searchDirs.push(join(pkgDir, 'Sources', targetName));
          searchDirs.push(join(pkgDir, targetName));
        }
      } catch {
        // Skip
      }
    }

    // 3. Fallback: projectRoot/Sources/targetName
    searchDirs.push(join(this.#projectRoot, 'Sources', targetName));

    // 找到第一个存在的目录
    let sourcesDir = null;
    for (const dir of searchDirs) {
      if (existsSync(dir)) {
        sourcesDir = dir;
        break;
      }
    }
    if (!sourcesDir) return [];

    const files = [];
    const walk = (dir, rel = '') => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const relPath = rel ? `${rel}/${entry}` : entry;
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full, relPath);
        } else if (/\.(swift|m|h|c|cpp|mm)$/i.test(entry)) {
          files.push({ name: entry, path: full, relativePath: relPath, size: st.size });
        }
      }
    };
    walk(sourcesDir);
    return files;
  }

  /**
   * 共用增强管线：语义字段标准化 + RecipeExtractor 标签 + QualityScorer 评分
   */
  _enrichRecipes(recipes) {
    for (const recipe of recipes) {
      SpmService.normalizeSemanticFields(recipe);

      if (this.#recipeExtractor && recipe.code) {
        try {
          const extracted = this.#recipeExtractor.extractFromContent(
            recipe.code, `${recipe.title || 'unknown'}.${recipe.language || 'swift'}`, ''
          );
          if (extracted.semanticTags?.length > 0) {
            recipe.tags = [...new Set([...(recipe.tags || []), ...extracted.semanticTags])];
          }
          if ((!recipe.category || recipe.category === 'Utility') && extracted.category && extracted.category !== 'general') {
            recipe.category = extracted.category;
          }
        } catch (e) {
          this.#logger.debug(`[SpmService] RecipeExtractor enrichment failed: ${e.message}`);
        }
      }

      if (this.#qualityScorer) {
        try {
          const scoreResult = this.#qualityScorer.score(recipe);
          recipe.qualityScore = scoreResult.score;
          recipe.qualityGrade = scoreResult.grade;
        } catch (e) {
          this.#logger.debug(`[SpmService] QualityScorer failed: ${e.message}`);
        }
      }
    }
  }

  /**
   * AI 扫描 Target 发现候选项（路由: POST /spm/scan）
   * 完整管线: 读文件 → AI 提取 → Header 解析 → 工具增强(语义标签/质量评分)
   */
  async scanTarget(target, options = {}) {
    const targetName = typeof target === 'string' ? target : target?.name;

    // 1. 获取源文件列表
    const fileList = await this.getTargetFiles(target);
    if (!fileList || fileList.length === 0) {
      return { recipes: [], scannedFiles: [], message: `No source files found for target: ${targetName}` };
    }

    // 2. 读取文件内容
    const { readFileSync } = await import('fs');
    const { basename, resolve } = await import('path');
    const files = fileList.map(f => {
      const filePath = typeof f === 'string' ? f : f.path;
      try {
        return { name: basename(filePath), path: filePath, relativePath: f.relativePath || basename(filePath), content: readFileSync(filePath, 'utf8') };
      } catch (err) {
        this.#logger.warn(`[SpmService] 读取文件失败: ${filePath} — ${err.message}`);
        return null;
      }
    }).filter(Boolean);

    if (files.length === 0) {
      return { recipes: [], scannedFiles: [], message: 'All source files unreadable' };
    }

    const scannedFiles = files.map(f => ({ name: f.name, path: f.relativePath }));
    this.#logger.info(`[SpmService] scanTarget: ${targetName}, ${files.length} files`);

    // 3. AI 提取 Recipes（通过 ChatAgent 统一入口）
    if (!this.#chatAgent && !this.#aiFactory) {
      return { recipes: [], scannedFiles, message: 'AI provider not configured. Please set ASD_AI_PROVIDER.' };
    }

    let recipes;
    try {
      if (this.#chatAgent) {
        const result = await this.#chatAgent.executeTool('extract_recipes', { targetName, files });
        if (result?.error) {
          return { recipes: [], scannedFiles, message: result.error };
        }
        recipes = result?.recipes || [];
      } else {
        // 降级: 直接使用 aiFactory（兼容未注入 chatAgent 的场景）
        const { getProviderWithFallback, isGeoOrProviderError, getAvailableFallbacks, createProvider } = this.#aiFactory;
        let ai = await getProviderWithFallback();
        if (!ai) {
          return { recipes: [], scannedFiles, message: 'AI provider not available' };
        }
        try {
          recipes = await ai.extractRecipes(targetName, files);
        } catch (primaryErr) {
          if (isGeoOrProviderError(primaryErr)) {
            const currentProvider = (process.env.ASD_AI_PROVIDER || 'google').toLowerCase();
            const fallbacks = getAvailableFallbacks(currentProvider);
            let fallbackOk = false;
            for (const fbName of fallbacks) {
              try {
                ai = createProvider({ provider: fbName });
                recipes = await ai.extractRecipes(targetName, files);
                fallbackOk = true;
                break;
              } catch (fbErr) {
                this.#logger.warn(`[SpmService] fallback "${fbName}" failed: ${fbErr.message}`);
              }
            }
            if (!fallbackOk) throw primaryErr;
          } else {
            throw primaryErr;
          }
        }
      }
    } catch (err) {
      this.#logger.warn(`[SpmService] scanTarget AI extraction failed: ${err.message}`);
      return { recipes: [], scannedFiles, message: `AI extraction failed: ${err.message}` };
    }

    if (!Array.isArray(recipes)) recipes = [];

    // 3.5 Header 路径解析 + moduleName 注入
    try {
      const PathFinder = await import('../../infrastructure/paths/PathFinder.js');
      const HeaderResolver = await import('../../infrastructure/paths/HeaderResolver.js');
      const targetRootDir = await PathFinder.findTargetRootDir(files[0].path);
      for (const recipe of recipes) {
        const headerList = recipe.headers || [];
        recipe.headerPaths = await Promise.all(
          headerList.map(h => HeaderResolver.resolveHeaderRelativePath(h, targetRootDir))
        );
        recipe.moduleName = targetName;
      }
    } catch (err) {
      this.#logger.warn(`[SpmService] Header resolution failed: ${err.message}`);
    }

    // 4. 工具增强：语义标准化 + 标签 + 评分
    this._enrichRecipes(recipes);

    return { recipes, scannedFiles };
  }

  /**
   * 全项目扫描 — 遍历所有 Target，AI 提取候选 + Guard 审计
   * 返回: { targets: [...], recipes: [], guardAudit: { files, summary }, scannedFiles: [] }
   */
  async scanProject(options = {}) {
    this.#logger.info('[SpmService] scanProject: starting full-project scan');

    // 1. 列出所有 target
    const allTargets = await this.listTargets();
    if (!allTargets || allTargets.length === 0) {
      return { targets: [], recipes: [], guardAudit: null, scannedFiles: [], message: 'No SPM targets found' };
    }

    // 2. 收集所有源文件（去重）
    const seenPaths = new Set();
    const allFiles = [];  // { name, path, relativePath, content, targetName }
    const { readFileSync } = await import('fs');
    const { basename: bn } = await import('path');

    for (const t of allTargets) {
      try {
        const fileList = await this.getTargetFiles(t);
        for (const f of fileList) {
          const fp = typeof f === 'string' ? f : f.path;
          if (seenPaths.has(fp)) continue;
          seenPaths.add(fp);
          try {
            const content = readFileSync(fp, 'utf8');
            allFiles.push({
              name: bn(fp),
              path: fp,
              relativePath: f.relativePath || bn(fp),
              content,
              targetName: t.name,
            });
          } catch { /* unreadable */ }
        }
      } catch (e) {
        this.#logger.warn(`[SpmService] scanProject: skipping target ${t.name}: ${e.message}`);
      }
    }

    this.#logger.info(`[SpmService] scanProject: ${allFiles.length} unique files from ${allTargets.length} targets`);

    if (allFiles.length === 0) {
      return { targets: allTargets.map(t => t.name), recipes: [], guardAudit: null, scannedFiles: [], message: 'No readable source files' };
    }

    const scannedFiles = allFiles.map(f => ({ name: f.name, path: f.relativePath, targetName: f.targetName }));

    // 3. AI 提取 Recipes（全局批量，分批避免 token 超限）— 通过 ChatAgent 统一入口
    let allRecipes = [];
    if (this.#chatAgent || this.#aiFactory) {
      const BATCH_SIZE = options.batchSize || 20;

      if (this.#chatAgent) {
        // 通过 ChatAgent extract_recipes 工具（内置 fallback）
        for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
          const batch = allFiles.slice(i, i + BATCH_SIZE);
          const batchLabel = `project-batch-${Math.floor(i / BATCH_SIZE) + 1}`;
          try {
            const result = await this.#chatAgent.executeTool('extract_recipes', { targetName: batchLabel, files: batch });
            if (Array.isArray(result?.recipes)) allRecipes.push(...result.recipes);
          } catch (err) {
            this.#logger.warn(`[SpmService] scanProject ChatAgent batch ${batchLabel} failed: ${err.message}`);
          }
        }
      } else {
        // 降级: 直接使用 aiFactory（兼容未注入 chatAgent 的场景）
        const { getProviderWithFallback, isGeoOrProviderError, getAvailableFallbacks, createProvider } = this.#aiFactory;
        let ai = await getProviderWithFallback();

        if (ai) {
          for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
            const batch = allFiles.slice(i, i + BATCH_SIZE);
            const batchLabel = `project-batch-${Math.floor(i / BATCH_SIZE) + 1}`;
            try {
              let recipes = await ai.extractRecipes(batchLabel, batch);
              if (Array.isArray(recipes)) allRecipes.push(...recipes);
            } catch (err) {
              if (isGeoOrProviderError(err)) {
                const fallbacks = getAvailableFallbacks((process.env.ASD_AI_PROVIDER || 'google').toLowerCase());
                for (const fb of fallbacks) {
                  try {
                    ai = createProvider({ provider: fb });
                    let recipes = await ai.extractRecipes(batchLabel, batch);
                    if (Array.isArray(recipes)) allRecipes.push(...recipes);
                    break;
                  } catch { /* next fallback */ }
                }
              } else {
                this.#logger.warn(`[SpmService] scanProject AI batch ${batchLabel} failed: ${err.message}`);
              }
            }
          }
        }
      }

      // 工具增强：语义标准化 + 标签 + 评分
      this._enrichRecipes(allRecipes);
    }

    // 4. Guard 审计 — 对所有文件运行 GuardCheckEngine
    let guardAudit = null;
    if (this.#guardCheckEngine) {
      try {
        const guardFiles = allFiles.map(f => ({ path: f.path, content: f.content }));
        guardAudit = this.#guardCheckEngine.auditFiles(guardFiles, { scope: 'project' });

        // 将有违反的文件写入 ViolationsStore
        if (this.#violationsStore && guardAudit.files) {
          for (const fileResult of guardAudit.files) {
            if (fileResult.violations.length > 0) {
              this.#violationsStore.appendRun({
                filePath: fileResult.filePath,
                violations: fileResult.violations,
                summary: `Project scan: ${fileResult.summary.errors} errors, ${fileResult.summary.warnings} warnings`,
              });
            }
          }
        }
      } catch (e) {
        this.#logger.warn(`[SpmService] Guard audit failed: ${e.message}`);
      }
    }

    this.#logger.info(`[SpmService] scanProject complete: ${allRecipes.length} recipes, ${guardAudit?.summary?.totalViolations || 0} violations`);

    return {
      targets: allTargets.map(t => t.name),
      recipes: allRecipes,
      guardAudit,
      scannedFiles,
    };
  }

  /**
   * 标准化 AI 提取结果中的语义字段
   * - preconditions (flat array) → constraints.preconditions
   * - steps (string[]) → [{title, description}] 结构化格式
   * - 确保 rationale / knowledgeType / complexity / scope 就位
   */
  static normalizeSemanticFields(recipe) {
    // preconditions → constraints.preconditions
    if (Array.isArray(recipe.preconditions) && recipe.preconditions.length > 0) {
      if (!recipe.constraints) recipe.constraints = {};
      if (!recipe.constraints.preconditions) {
        recipe.constraints.preconditions = recipe.preconditions;
      }
      delete recipe.preconditions;
    }

    // steps: string[] → [{title, description}]
    if (Array.isArray(recipe.steps)) {
      recipe.steps = recipe.steps.map((s, i) => {
        if (typeof s === 'string') {
          return { title: `Step ${i + 1}`, description: s, code: '' };
        }
        return s; // already structured
      });
    }

    // knowledgeType 默认值
    if (!recipe.knowledgeType) recipe.knowledgeType = 'code-pattern';
    // complexity 默认值
    if (!recipe.complexity) recipe.complexity = 'intermediate';
    // scope 默认值
    if (!recipe.scope) recipe.scope = 'project-specific';

    return recipe;
  }

  /**
   * 确保已加载 Package.swift（惰性加载）
   */
  async #ensureLoaded() {
    if (this.#graph.getNodes().length === 0) {
      try {
        await this.load();
      } catch (e) {
        this.#logger.warn(`[SpmService] 自动加载失败: ${e.message}`);
      }
    }
  }

  /**
   * 刷新依赖映射（路由: POST /commands/spm-map）
   */
  async updateDependencyMap(options = {}) {
    this.#graph.clear();
    const parsed = await this.load();
    if (!parsed) {
      return { success: false, message: 'Package.swift not found', targets: 0, edges: 0 };
    }
    const json = this.#graph.toJSON();
    return {
      success: true,
      message: `Dependency map updated for ${parsed.name}`,
      targets: json.nodes.length,
      edges: json.edges.length,
      projectRoot: this.#projectRoot,
    };
  }
}
