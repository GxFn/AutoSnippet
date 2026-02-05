#!/usr/bin/env node

/**
 * Node 监工侧：Package.swift 解析客户端
 *
 * 1. swift-syntax 不在 Node 环境：ParsePackage 是独立 Swift 可执行文件，其依赖 swift-syntax 由
 *    Swift Package Manager 在「swift build」时拉取并编译；Node 只 spawn 该二进制、通过 STDIO JSON 通信。
 *
 * 2. npm install 时会执行 postinstall 尝试构建 ParsePackage（scripts/ensure-parse-package.js）；
 *    构建成功则运行时优先使用 ParsePackage，失败不阻塞 npm install。
 *
 * 3. 解析优先级：ParsePackage（若已安装）→ dump-package（系统）→ 回退 AST-lite。
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const paths = require('../../config/Paths');

const SWIFT_PARSE_CACHE_PREFIX = 'SwiftParseCache_';
const DEFAULT_TIMEOUT_MS = 5000;

/** 是否优先使用系统 swift package dump-package（轻量，无需 ParsePackage）；0 则跳过，仅用 ParsePackage 或 AST-lite */
function useDumpPackage() {
  return process.env.ASD_USE_DUMP_PACKAGE !== '0';
}

function getParserBin(projectRoot) {
  if (process.env.ASD_SWIFT_PARSER_BIN) {
  const bin = process.env.ASD_SWIFT_PARSER_BIN;
  if (path.isAbsolute(bin) && fs.existsSync(bin)) return bin;
  const resolved = path.resolve(projectRoot || process.cwd(), bin);
  if (fs.existsSync(resolved)) return resolved;
  return bin;
  }
  // 从 lib/infrastructure/external/spm 到仓库根：../../../../ (spm -> external -> infrastructure -> lib -> root)
  const pkgRoot = path.resolve(__dirname, '../../../../');
  const candidates = [
  path.join(pkgRoot, 'bin/darwin/parsePackage'),
  path.join(pkgRoot, 'tools/parse-package/.build/release/ParsePackage'),
  ];
  for (const candidate of candidates) {
  if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function getSwiftParseCacheFile(packageSwiftPath) {
  const cachePath = paths.getCachePath();
  const resolved = path.resolve(packageSwiftPath);
  const buf = Buffer.from(resolved, 'utf8');
  const fileName = SWIFT_PARSE_CACHE_PREFIX + buf.toString('base64').replace(/[/+=]/g, '_') + '.json';
  return path.join(cachePath, fileName);
}

function readJsonSafe(filePath) {
  try {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw) return null;
  return JSON.parse(raw);
  } catch {
  return null;
  }
}

function writeJsonSafe(filePath, obj) {
  try {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
  return true;
  } catch {
  return false;
  }
}

/**
 * 将系统 `swift package dump-package` 的 JSON 转为与 swiftPackageToPkgInfo 一致的 package 形结构
 * dump-package 的 targets[].dependencies 为 { product: [name, package, null, null] } 或 { byName: [name, null] }
 */
function dumpPackageOutputToPackageShape(packageSwiftPath, dump) {
  if (!dump || !Array.isArray(dump.targets)) return null;
  const baseDir = path.dirname(packageSwiftPath);
  const packageDir = (dump.packageKind && dump.packageKind.root && dump.packageKind.root[0])
  ? dump.packageKind.root[0]
  : baseDir;
  const targets = dump.targets.map((t) => {
  const deps = (t.dependencies || []).map((d) => {
    if (d.product && Array.isArray(d.product)) {
    return { kind: 'product', name: d.product[0], package: d.product[1] };
    }
    if (d.byName && Array.isArray(d.byName)) {
    return { kind: 'byName', name: d.byName[0] };
    }
    return null;
  }).filter(Boolean);
  return {
    name: t.name,
    path: t.path || null,
    sources: t.sources || null,
    dependencies: deps.length ? deps : undefined,
  };
  });
  return {
  name: dump.name || null,
  packageDir,
  targets,
  };
}

/**
 * 使用系统 `swift package dump-package` 解析 Package.swift（轻量，无需 ParsePackage/swift-syntax）
 * @param {string} packageSwiftPath - Package.swift 绝对路径
 * @param {{ projectRoot?: string, timeoutMs?: number }} options
 * @returns {Promise<{ name, targets, targetsInfo, path } | null>} 与 packageParser 同构，失败返回 null
 */
function parsePackageViaDumpPackage(packageSwiftPath, options = {}) {
  const packageDir = path.dirname(path.resolve(packageSwiftPath));
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
  const child = spawn('swift', ['package', '--package-path', packageDir, 'dump-package'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const timer = setTimeout(() => {
    child.kill('SIGTERM');
    resolve(null);
  }, timeoutMs);

  child.on('close', (code) => {
    clearTimeout(timer);
    if (code !== 0) resolve(null);
    else {
    try {
      const dump = JSON.parse(stdout);
      const shape = dumpPackageOutputToPackageShape(packageSwiftPath, dump);
      resolve(shape ? swiftPackageToPkgInfo(packageSwiftPath, shape) : null);
    } catch {
      resolve(null);
    }
    }
  });
  });
}

/**
 * 将 Swift 解析器输出的 package 结构转为与 packageParser.parsePackageSwift 一致的 targetsInfo/targetsList
 * 供 buildDepGraph 复用
 */
function swiftPackageToPkgInfo(packageSwiftPath, pkg) {
  if (!pkg || !Array.isArray(pkg.targets)) return null;
  const baseDir = path.dirname(packageSwiftPath);
  const packageDir = pkg.packageDir
  ? (path.isAbsolute(pkg.packageDir) ? pkg.packageDir : path.resolve(baseDir, pkg.packageDir))
  : baseDir;
  const targetsInfo = {};
  const targetsList = [];
  for (const t of pkg.targets) {
  if (!t || !t.name) continue;
  const deps = (t.dependencies || []).map((d) => {
    if (d.kind === 'target') return { kind: 'target', name: d.name };
    if (d.kind === 'product') return { kind: 'product', name: d.name, package: d.package };
    return { kind: 'byName', name: d.name };
  });
  targetsInfo[t.name] = {
    name: t.name,
    path: t.path || null,
    sources: t.sources || null,
    dependencies: deps,
  };
  targetsList.push(t.name);
  }
  return {
  name: pkg.name || null,
  targets: targetsList,
  targetsInfo,
  path: packageDir,
  };
}

/**
 * 调用 Swift 解析器解析单个 Package.swift
 * 优先使用系统 `swift package dump-package`（轻量，无需 ParsePackage/swift-syntax），失败再试 ParsePackage，最后回退由调用方 AST-lite
 * @param {string} packageSwiftPath - Package.swift 绝对路径
 * @param {{ projectRoot?: string, resolveLocalPaths?: boolean, timeoutMs?: number }} options
 * @returns {Promise<{ name, targets, targetsInfo, path } | null>} 与 packageParser.parsePackageSwift 同构，失败返回 null
 */
async function parsePackage(packageSwiftPath, options = {}) {
  const projectRoot = options.projectRoot || path.dirname(packageSwiftPath);
  const resolveLocalPaths = options.resolveLocalPaths !== false;
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS;

  const resolvedPath = path.resolve(packageSwiftPath);
  let mtimeMs = null;
  try {
  mtimeMs = fs.statSync(resolvedPath).mtimeMs;
  } catch {
  return null;
  }

  const cacheFile = getSwiftParseCacheFile(resolvedPath);
  const cached = readJsonSafe(cacheFile);
  if (cached && cached.mtimeMs === mtimeMs && cached.packagePath === resolvedPath && cached.pkgInfo) {
  return cached.pkgInfo;
  }

  // 1. 若 npm install 时已构建成功：优先 ParsePackage（swift-syntax）；ASD_SWIFT_PARSER_DISABLE=1 时跳过
  const bin = process.env.ASD_SWIFT_PARSER_DISABLE !== '1' ? getParserBin(projectRoot) : null;
  if (bin) {
  const pkgInfo = await parsePackageViaBinary(bin, resolvedPath, projectRoot, {
    resolveLocalPaths,
    timeoutMs,
    cacheFile,
    mtimeMs,
  });
  if (pkgInfo) return pkgInfo;
  }

  // 2. 轻量路径：系统 swift package dump-package（无需 ParsePackage/swift-syntax）
  if (useDumpPackage()) {
  const pkgInfo = await parsePackageViaDumpPackage(resolvedPath, { timeoutMs });
  if (pkgInfo) {
    writeJsonSafe(cacheFile, {
    mtimeMs,
    packagePath: resolvedPath,
    pkgInfo,
    });
    return pkgInfo;
  }
  }

  // 3. 回退由调用方使用 AST-lite
  return null;
}

function parsePackageViaBinary(bin, resolvedPath, projectRoot, options) {
  const { resolveLocalPaths, timeoutMs, cacheFile, mtimeMs } = options;

  const input = {
  schemaVersion: 1,
  command: 'parsePackage',
  packageSwiftPath: resolvedPath,
  options: {
    resolveLocalPaths,
    projectRoot: path.resolve(projectRoot),
    includeEdits: false,
  },
  };

  return new Promise((resolve) => {
  const child = spawn(bin, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: projectRoot,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.write(JSON.stringify(input), (err) => {
    if (err) {
    child.kill();
    resolve(null);
    return;
    }
    child.stdin.end();
  });

  const timer = setTimeout(() => {
    child.kill('SIGTERM');
    resolve(null);
  }, timeoutMs);

  child.on('close', (code) => {
    clearTimeout(timer);
    if (code !== 0) {
    resolve(null);
    return;
    }
    let out = null;
    try {
    out = JSON.parse(stdout);
    } catch {
    resolve(null);
    return;
    }
    if (!out || !out.ok || !out.package) {
    resolve(null);
    return;
    }
    const pkgInfo = swiftPackageToPkgInfo(resolvedPath, out.package);
    if (pkgInfo) {
    writeJsonSafe(cacheFile, {
      mtimeMs,
      packagePath: resolvedPath,
      pkgInfo,
    });
    }
    resolve(pkgInfo);
  });
  });
}

module.exports = {
  getParserBin,
  parsePackage,
  swiftPackageToPkgInfo,
};
