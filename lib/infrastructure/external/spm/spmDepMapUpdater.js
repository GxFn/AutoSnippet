#!/usr/bin/env node

/**
 * 职责：
 * - 自动更新工程根目录下的 AutoSnippet.spmmap.json
 * - 数据来源：扫描工程内的 Package.swift（.package(...) 与 .product(name:package:)）
 *
 * 设计原则：
 * - 只做“补全/合并”，尽量不覆盖用户已有配置（避免错误判断）
 * - 默认对无法确定 packageName 的 .package(url/path) 不写入 packages（避免误判）
 * - 可通过 options.aggressive 启用“激进模式”：用 repo/path 的最后一段推断 packageName 并写入（同名冲突时不覆盖）
 */

const fs = require('fs');
const path = require('path');
const swiftParserClient = require('./swiftParserClient.js');
const Paths = require('../../config/Paths');

const MAP_FILE = 'AutoSnippet.spmmap.json';
const PACKAGE_SWIFT = 'Package.swift';

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
		fs.writeFileSync(filePath, JSON.stringify(obj, null, 4), 'utf8');
		return true;
	} catch {
		return false;
	}
}

function ensureMapShape(map) {
	if (!map || typeof map !== 'object') map = {};

	// 兼容旧格式（早期：文件内容直接是 { [productName]: {kind:'product',...} }）
	const hasSchema = !!map.schemaVersion;
	const hasPackagesField = Object.prototype.hasOwnProperty.call(map, 'packages');
	const hasProductsField = Object.prototype.hasOwnProperty.call(map, 'products');
	if (!hasSchema && !hasPackagesField && !hasProductsField) {
		const legacyProducts = {};
		for (const [k, v] of Object.entries(map)) {
			if (v && typeof v === 'object' && v.kind === 'product') legacyProducts[k] = v;
		}
		map = {
			schemaVersion: 1,
			packages: {},
			products: legacyProducts,
		};
		return map;
	}

	if (!map.schemaVersion) map.schemaVersion = 1;
	if (!map.packages || typeof map.packages !== 'object') map.packages = {};
	if (!map.products || typeof map.products !== 'object') map.products = {};

	// 兼容“混入旧字段”：将根对象里形如 { ExtLib: {kind:'product',...} } 的条目迁移进 products
	for (const [k, v] of Object.entries(map)) {
		if (k === 'schemaVersion' || k === 'packages' || k === 'products') continue;
		if (!v || typeof v !== 'object') continue;
		if (v.kind === 'product' && v.name && v.package) {
			if (!map.products[k]) map.products[k] = v;
		}
		if (v.kind === 'url' && v.url) {
			if (!map.packages[k]) map.packages[k] = v;
		}
		if (v.kind === 'path' && v.path) {
			if (!map.packages[k]) map.packages[k] = v;
		}
	}

	return map;
}

function normalizeUrlRepoName(url) {
	try {
		const s = String(url || '').trim();
		if (!s) return '';
		const last = s.split('/').filter(Boolean).pop() || '';
		return last.endsWith('.git') ? last.slice(0, -4) : last;
	} catch {
		return '';
	}
}

function scanPackageSwiftFiles(projectRoot, options = {}) {
	const maxFiles = typeof options.maxFiles === 'number' ? options.maxFiles : 2000;
	const ignoreDirs = new Set([
		'node_modules', '.git', '.build', '.swiftpm', 'xcuserdata', 'DerivedData'
	]);

	const result = [];
	const stack = [projectRoot];

	while (stack.length && result.length < maxFiles) {
		const dir = stack.pop();
		let entries = null;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const e of entries) {
			const full = path.join(dir, e.name);
			if (e.isDirectory()) {
				if (e.name.startsWith('.')) continue;
				if (ignoreDirs.has(e.name)) continue;
				stack.push(full);
				continue;
			}
			if (e.isFile() && e.name === 'Package.swift') {
				result.push(full);
				if (result.length >= maxFiles) break;
			}
		}
	}

	return result;
}

function extractProductUsages(src) {
	const products = [];
	if (!src) return products;
	const re = /\.product\(\s*name:\s*"([^"]+)"\s*,\s*package:\s*"([^"]+)"\s*\)/g;
	let m = null;
	while ((m = re.exec(src)) !== null) {
		products.push({ productName: m[1], packageName: m[2] });
	}
	return products;
}

function extractPackageDecls(src) {
	const decls = [];
	if (!src) return decls;

	// 支持：
	// - .package(name: "X", url: "...", from: "1.0.0")
	// - .package(url: "...", from: "1.0.0")  （无 name:）
	// - .package(path: "../X")               （无 name:）
	const re = /\.package\(\s*([^)]*?)\)/g;
	let m = null;
	while ((m = re.exec(src)) !== null) {
		const inner = m[1] || '';
		const nameMatch = inner.match(/name:\s*"([^"]+)"/);
		const urlMatch = inner.match(/url:\s*"([^"]+)"/);
		const pathMatch = inner.match(/path:\s*"([^"]+)"/);
		const fromMatch = inner.match(/from:\s*"([^"]+)"/);

		decls.push({
			name: nameMatch ? nameMatch[1] : null,
			kind: urlMatch ? 'url' : (pathMatch ? 'path' : null),
			url: urlMatch ? urlMatch[1] : null,
			path: pathMatch ? pathMatch[1] : null,
			from: fromMatch ? fromMatch[1] : null,
		});
	}
	return decls;
}

function parsePackageNameFromPackageSwiftSrc(src) {
	try {
		const m = String(src || '').match(/name:\s*"([^"]+)"/);
		return m ? m[1] : null;
	} catch {
		return null;
	}
}

function normalizeRelativePathForSwiftPM(rel) {
	const s = String(rel || '').replace(/\\/g, '/');
	if (!s) return s;
	if (s.startsWith('.')) return s;
	return './' + s;
}

function buildSpmProjectGraph(projectRoot, packageSwiftFiles) {
	const rootAbs = path.resolve(projectRoot);
	const rootName = path.basename(rootAbs);
	const files = Array.isArray(packageSwiftFiles) ? packageSwiftFiles : scanPackageSwiftFiles(rootAbs, {});

	// 1) packageDir -> packageName
	const byDir = new Map();
	const packages = {};

	for (const p of files) {
		let src = '';
		try { src = fs.readFileSync(p, 'utf8'); } catch { continue; }
		const pkgName = parsePackageNameFromPackageSwiftSrc(src);
		if (!pkgName) continue;
		const pkgDir = path.dirname(p);
		byDir.set(path.resolve(pkgDir), pkgName);
		packages[pkgName] = {
			packageName: pkgName,
			packageDir: path.relative(rootAbs, pkgDir).replace(/\\/g, '/'),
			packageSwift: path.relative(rootAbs, p).replace(/\\/g, '/'),
		};
	}

	// 2) edges（只统计工程内的 path 依赖）
	const edges = {};
	const pathDecls = {}; // fromPkg -> { toPkg: "../X" }

	for (const p of files) {
		let src = '';
		try { src = fs.readFileSync(p, 'utf8'); } catch { continue; }
		const fromPkg = parsePackageNameFromPackageSwiftSrc(src);
		if (!fromPkg) continue;
		const fromDir = path.dirname(p);

		const decls = extractPackageDecls(src);
		for (const d of decls) {
			if (!d || d.kind !== 'path' || !d.path) continue;
			const depAbsDir = path.resolve(fromDir, d.path);
			const depName = byDir.get(depAbsDir);
			if (!depName) continue;

			if (!edges[fromPkg]) edges[fromPkg] = [];
			if (!edges[fromPkg].includes(depName)) edges[fromPkg].push(depName);

			if (!pathDecls[fromPkg]) pathDecls[fromPkg] = {};
			// 保留原始写法（相对 fromPkg 的 Package.swift），便于后续直接插入同风格 path
			pathDecls[fromPkg][depName] = d.path;
		}
	}

	return {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		projectRoot: rootName,
		packages,
		edges,
		pathDecls,
	};
}

/**
 * 使用全解析（ParsePackage / dump-package）构建项目依赖图，写入 packages（含 targets）、edges、pathDecls
 * 成功时返回 graph；任一文件解析失败则返回 null，由调用方回退 buildSpmProjectGraph
 */
async function buildSpmProjectGraphFromFullParse(projectRoot, packageSwiftFiles) {
	const rootAbs = path.resolve(projectRoot);
	const rootName = path.basename(rootAbs);
	const files = Array.isArray(packageSwiftFiles) ? packageSwiftFiles : scanPackageSwiftFiles(rootAbs, {});
	const packages = {};
	const byDir = new Map();
	const edges = {};
	const pathDecls = {};
	const discoveredProducts = [];
	let hasAny = false;

	for (const p of files) {
		const pkgDir = path.dirname(p);
		const pkgInfo = await swiftParserClient.parsePackage(p, {
			projectRoot: pkgDir,
			timeoutMs: 8000,
		});
		if (!pkgInfo || !pkgInfo.name) continue;
		hasAny = true;
		const pkgName = pkgInfo.name;
		byDir.set(path.resolve(pkgDir), pkgName);
		packages[pkgName] = {
			packageName: pkgName,
			packageDir: path.relative(rootAbs, pkgDir).replace(/\\/g, '/'),
			packageSwift: path.relative(rootAbs, p).replace(/\\/g, '/'),
			targets: pkgInfo.targets && pkgInfo.targets.length ? pkgInfo.targets : undefined,
		};
		const targetsInfo = pkgInfo.targetsInfo || {};
		for (const t of Object.keys(targetsInfo)) {
			const deps = (targetsInfo[t] && targetsInfo[t].dependencies) ? targetsInfo[t].dependencies : [];
			for (const d of deps) {
				if (d && d.kind === 'product' && d.name && d.package) {
					discoveredProducts.push({ productName: d.name, packageName: d.package });
					if (!edges[pkgName]) edges[pkgName] = [];
					if (!edges[pkgName].includes(d.package)) edges[pkgName].push(d.package);
				}
			}
		}
	}

	if (!hasAny) return null;

	// pathDecls：从源码扫描 .package(path:) 得到
	for (const p of files) {
		let src = '';
		try { src = fs.readFileSync(p, 'utf8'); } catch { continue; }
		const fromPkg = byDir.get(path.resolve(path.dirname(p)));
		if (!fromPkg) continue;
		const fromDir = path.dirname(p);
		const decls = extractPackageDecls(src);
		for (const d of decls) {
			if (!d || d.kind !== 'path' || !d.path) continue;
			const depAbsDir = path.resolve(fromDir, d.path);
			const toPkg = byDir.get(depAbsDir);
			if (!toPkg) continue;
			if (!pathDecls[fromPkg]) pathDecls[fromPkg] = {};
			pathDecls[fromPkg][toPkg] = d.path;
			if (!edges[fromPkg]) edges[fromPkg] = [];
			if (!edges[fromPkg].includes(toPkg)) edges[fromPkg].push(toPkg);
		}
	}

	return {
		schemaVersion: 2,
		generatedAt: new Date().toISOString(),
		projectRoot: rootName,
		packages,
		edges,
		pathDecls,
		_discoveredProducts: discoveredProducts,
	};
}

function mergeDiscoveredIntoMap(map, discovered, options = {}) {
	const out = ensureMapShape(JSON.parse(JSON.stringify(map || {})));
	const allowOverwrite = !!options.allowOverwrite;
	const aggressive = !!options.aggressive;

	let changed = false;

	// 1) products（module/product -> packageName）
	for (const p of discovered.products) {
		if (!p || !p.productName || !p.packageName) continue;
		const key = p.productName;
		const next = { kind: 'product', name: p.productName, package: p.packageName };
		if (!out.products[key]) {
			out.products[key] = next;
			changed = true;
		} else if (allowOverwrite) {
			const cur = out.products[key];
			if (!cur || cur.name !== next.name || cur.package !== next.package || cur.kind !== 'product') {
				out.products[key] = next;
				changed = true;
			}
		}
	}

	// 2) packages（packageName -> {kind,url/path,from}）
	// 先收集“我们确实知道 packageName”的集合（来自 products.packageName + package decl 的 name:）
	const knownPackageNames = new Set();
	for (const p of discovered.products) {
		if (p && p.packageName) knownPackageNames.add(p.packageName);
	}
	for (const d of discovered.packages) {
		if (d && d.name) knownPackageNames.add(d.name);
	}

	for (const d of discovered.packages) {
		if (!d || !d.kind) continue;

		let pkgName = d.name;
		if (!pkgName) {
			// 无 name: 的 .package：默认尽量与 knownPackageNames 对齐（保守）
			// aggressive 模式：直接用 repo/path 的最后一段作为 packageName（更自动，但可能误判）
			const inferred = d.kind === 'url'
				? normalizeUrlRepoName(d.url)
				: path.basename(String(d.path || ''));
			if (inferred && (aggressive || knownPackageNames.has(inferred))) {
				pkgName = inferred;
			} else continue;
		}

		const nextRef = d.kind === 'url'
			? { kind: 'url', url: d.url, from: d.from || '0.0.0' }
			: { kind: 'path', path: d.path };

		if (!out.packages[pkgName]) {
			out.packages[pkgName] = nextRef;
			changed = true;
		} else if (allowOverwrite) {
			const cur = out.packages[pkgName];
			if (JSON.stringify(cur) !== JSON.stringify(nextRef)) {
				out.packages[pkgName] = nextRef;
				changed = true;
			}
		} else {
			// 不覆盖：若同名但指向不同 url/path，认为冲突，保持原值（避免误判破坏）
			const cur = out.packages[pkgName];
			if (cur && JSON.stringify(cur) !== JSON.stringify(nextRef)) {
				continue;
			}
			// 不覆盖，但可补 from
			if (cur && cur.kind === 'url' && nextRef.kind === 'url' && (!cur.from || cur.from === '0.0.0') && nextRef.from) {
				out.packages[pkgName] = { ...cur, from: nextRef.from };
				changed = true;
			}
		}
	}

	return { map: out, changed };
}

async function updateSpmDepMap(projectRoot, options = {}) {
	const knowledgeDir = Paths.getProjectKnowledgePath(projectRoot);
	const mapPath = path.join(knowledgeDir, MAP_FILE);
	if (!fs.existsSync(knowledgeDir)) {
		try { fs.mkdirSync(knowledgeDir, { recursive: true }); } catch (e) {}
	}

	const existing = ensureMapShape(readJsonSafe(mapPath));

	const packageSwiftFiles = scanPackageSwiftFiles(projectRoot, { maxFiles: options.maxFiles });
	const discovered = { products: [], packages: [] };

	// 优先用全解析构建 graph；失败则回退 regex 构建
	let graph = null;
	const fullParseResult = await buildSpmProjectGraphFromFullParse(projectRoot, packageSwiftFiles);
	if (fullParseResult && fullParseResult.packages && Object.keys(fullParseResult.packages).length > 0) {
		graph = { ...fullParseResult };
		delete graph._discoveredProducts;
		discovered.products = fullParseResult._discoveredProducts || [];
	}
	for (const p of packageSwiftFiles) {
		let src = '';
		try { src = fs.readFileSync(p, 'utf8'); } catch { continue; }
		if (!graph) discovered.products.push(...extractProductUsages(src));
		discovered.packages.push(...extractPackageDecls(src));
	}
	if (!graph) {
		graph = buildSpmProjectGraph(projectRoot, packageSwiftFiles);
	}

	const merged = mergeDiscoveredIntoMap(existing, discovered, {
		allowOverwrite: !!options.allowOverwrite,
		aggressive: !!options.aggressive,
	});

	merged.map.schemaVersion = Math.max(Number(merged.map.schemaVersion || 1), 2);
	merged.map.policy = merged.map.policy && typeof merged.map.policy === 'object'
		? merged.map.policy
		: { enforcement: 'block', rule: 'no_package_cycle' };
	if (!merged.map.policy.enforcement) merged.map.policy.enforcement = 'block';
	if (!merged.map.policy.rule) merged.map.policy.rule = 'no_package_cycle';

	merged.map.graph = graph;
	merged.changed = true;

	if (options.dryRun) {
		return { ok: true, changed: merged.changed, path: mapPath, map: merged.map, scanned: packageSwiftFiles.length };
	}

	try { fs.mkdirSync(projectRoot, { recursive: true }); } catch {}
	if (!fs.existsSync(mapPath)) {
		writeJsonSafe(mapPath, ensureMapShape({}));
	}

	if (merged.changed) {
		const ok = writeJsonSafe(mapPath, merged.map);
		return { ok, changed: ok, path: mapPath, scanned: packageSwiftFiles.length };
	}

	return { ok: true, changed: false, path: mapPath, scanned: packageSwiftFiles.length };
}

module.exports = {
	updateSpmDepMap,
	buildSpmProjectGraph,
};
