#!/usr/bin/env node

/**
 * 职责：
 * - SPM 依赖关系：存储 / 查询 / 自动补齐（修改 Package.swift）
 * - Phase 4：下沉实现（完整逻辑）
 *
 * 对外导出（保持兼容）：
 * - getFixMode(specFile)
 * - getOrBuildDepGraph(packageSwiftPath)
 * - isReachable(depGraph, fromTarget, toTarget)
 * - ensureDependency(specFile, packageSwiftPath, fromTarget, toTarget)
 */

const fs = require('fs');
const path = require('path');
const paths = require('../infra/paths.js');
const packageParser = require('./packageParser.js');
const spmDepMapUpdater = require('./spmDepMapUpdater.js');

const DEP_GRAPH_CACHE_PREFIX = 'DepGraphCache_';
const SPM_DEP_MAP_FILE = 'AutoSnippet.spmmap.json';
const SPM_DEP_MAP_FILE_OLD = 'AutoSnippet.spmdmap.json';

function getFixMode(specFile) {
	const envMode = process.env.ASD_FIX_SPM_DEPS_MODE;
	if (envMode === 'off' || envMode === 'suggest' || envMode === 'fix') return envMode;
	if (process.env.ASD_FIX_SPM_DEPS === '1' || process.env.ASD_FIX_SPM_DEPS === 'true') return 'fix';

	if (specFile) {
		try {
			const raw = fs.readFileSync(specFile, 'utf8');
			if (raw) {
				const obj = JSON.parse(raw);
				const mode = obj && obj.spmFixDepsMode;
				if (mode === 'off' || mode === 'suggest' || mode === 'fix') return mode;
			}
		} catch {
			// ignore
		}
	}

	return 'off';
}

function getDepGraphCacheFile(packageSwiftPath) {
	const cachePath = paths.getCachePath();
	const pathBuff = Buffer.from(path.resolve(packageSwiftPath), 'utf-8');
	const fileName = DEP_GRAPH_CACHE_PREFIX + pathBuff.toString('base64') + '.json';
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
		fs.writeFileSync(filePath, JSON.stringify(obj, null, 4), 'utf8');
		return true;
	} catch {
		return false;
	}
}

async function buildDepGraph(packageSwiftPath) {
	try {
		const stat = fs.statSync(packageSwiftPath);
		const pkgInfo = await packageParser.parsePackageSwift(packageSwiftPath);
		if (!pkgInfo) return null;

		return {
			schemaVersion: 1,
			packagePath: path.resolve(packageSwiftPath),
			packageDir: path.dirname(path.resolve(packageSwiftPath)),
			mtimeMs: stat.mtimeMs,
			packageName: pkgInfo.name || null,
			targets: pkgInfo.targetsInfo || {},
			targetsList: pkgInfo.targets || [],
		};
	} catch {
		return null;
	}
}

async function getOrBuildDepGraph(packageSwiftPath) {
	const cacheFile = getDepGraphCacheFile(packageSwiftPath);
	const cached = readJsonSafe(cacheFile);

	try {
		const stat = fs.statSync(packageSwiftPath);
		if (cached && cached.mtimeMs === stat.mtimeMs && cached.packagePath === path.resolve(packageSwiftPath)) {
			return cached;
		}
	} catch {
		// ignore
	}

	const fresh = await buildDepGraph(packageSwiftPath);
	if (fresh) {
		writeJsonSafe(cacheFile, fresh);
	}
	return fresh;
}

function normalizeDepToTarget(dep, targetsSet) {
	if (!dep) return null;
	if (dep.kind === 'target') return dep.name;
	if (dep.kind === 'byName' && targetsSet.has(dep.name)) return dep.name;
	return null;
}

function isReachable(depGraph, fromTarget, toTarget) {
	if (!depGraph || !fromTarget || !toTarget) return false;
	if (fromTarget === toTarget) return true;

	const targetsInfo = depGraph.targets || {};
	const targetsList = depGraph.targetsList || Object.keys(targetsInfo);
	const targetsSet = new Set(targetsList);

	const visited = new Set();
	const queue = [fromTarget];
	visited.add(fromTarget);

	while (queue.length) {
		const cur = queue.shift();
		const node = targetsInfo[cur];
		const deps = (node && node.dependencies) ? node.dependencies : [];

		for (const dep of deps) {
			const next = normalizeDepToTarget(dep, targetsSet);
			if (!next) continue;
			if (next === toTarget) return true;
			if (!visited.has(next)) {
				visited.add(next);
				queue.push(next);
			}
		}
	}

	return false;
}

function hasDirectDependency(depGraph, fromTarget, toTarget) {
	const node = depGraph && depGraph.targets && depGraph.targets[fromTarget];
	if (!node || !Array.isArray(node.dependencies)) return false;
	return node.dependencies.some((d) => (d && (d.name === toTarget)));
}

function suggestPatch(packageSwiftPath, fromTarget, toTarget) {
	return `Package.swift: ${packageSwiftPath}\n在 .target(name: "${fromTarget}", ...) 的 dependencies 中添加：\n  - "${toTarget}"`;
}

function suggestProductPatch(packageSwiftPath, fromTarget, productName, packageName) {
	return `Package.swift: ${packageSwiftPath}\n在 .target(name: "${fromTarget}", ...) 的 dependencies 中添加：\n  - .product(name: "${productName}", package: "${packageName}")`;
}

function readSpmDepMap(specFile) {
	if (!specFile) return null;
	try {
		const rootDir = path.dirname(specFile);
		// 统一从 Knowledge/ 目录读取
		const knowledgeDir = path.join(rootDir, 'Knowledge');
		const mapPath = path.join(knowledgeDir, SPM_DEP_MAP_FILE);
		let raw = null;
		try {
			raw = fs.readFileSync(mapPath, 'utf8');
		} catch {
			// 如果不存在，不做兼容旧路径，直接返回 null
			return null;
		}
		if (!raw) return null;
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function normalizeSpmDepMap(map) {
	if (!map) return { packages: {}, products: {} };
	if (map.packages || map.products) {
		return { packages: map.packages || {}, products: map.products || {} };
	}

	const products = {};
	for (const k of Object.keys(map)) {
		const item = map[k];
		if (item && item.kind === 'product' && item.name && item.package) {
			products[k] = item;
		}
	}
	return { packages: {}, products };
}

function normalizeRelativePathForSwiftPM(rel) {
	const s = String(rel || '').replace(/\\/g, '/');
	if (!s) return s;
	if (s.startsWith('.')) return s;
	return './' + s;
}

function getProjectGraph(specFile) {
	const map = readSpmDepMap(specFile);
	if (map && map.graph && map.graph.edges && map.graph.packages) return map.graph;
	// fallback：没有 graph 时尽量现场构建（避免放过循环）
	try {
		const projectRoot = specFile ? path.dirname(specFile) : null;
		if (!projectRoot) return null;
		return spmDepMapUpdater.buildSpmProjectGraph(projectRoot);
	} catch {
		return null;
	}
}

function wouldCreatePackageCycle(graph, fromPackage, toPackage) {
	if (!graph || !graph.edges || !fromPackage || !toPackage) return false;
	if (fromPackage === toPackage) return true;

	const edges = graph.edges || {};
	const visited = new Set();
	const queue = [toPackage];
	visited.add(toPackage);
	while (queue.length) {
		const cur = queue.shift();
		if (cur === fromPackage) return true;
		const nexts = edges[cur] || [];
		for (const n of nexts) {
			if (!n || visited.has(n)) continue;
			visited.add(n);
			queue.push(n);
		}
	}
	return false;
}

function resolvePackageRefFromGraph(graph, specFile, fromPackageSwiftPath, toPackageName) {
	try {
		if (!graph || !graph.packages || !toPackageName) return null;
		const toInfo = graph.packages[toPackageName];
		if (!toInfo || !toInfo.packageDir) return null;

		// graph.projectRoot 现在是项目名（非绝对路径）；真实根目录以 specFile 所在目录为准
		const projectRootAbs = specFile ? path.dirname(specFile) : null;
		if (!projectRootAbs) return null;

		const fromDir = path.dirname(path.resolve(fromPackageSwiftPath));
		const toDir = path.resolve(projectRootAbs, toInfo.packageDir);

		let rel = path.relative(fromDir, toDir).replace(/\\/g, '/');
		rel = normalizeRelativePathForSwiftPM(rel);
		return { kind: 'path', path: rel };
	} catch {
		return null;
	}
}

function inferProductMappingFromGraph(depGraph, moduleName) {
	if (!depGraph || !depGraph.targets) return null;
	for (const t of Object.keys(depGraph.targets)) {
		const node = depGraph.targets[t];
		const deps = (node && node.dependencies) ? node.dependencies : [];
		for (const d of deps) {
			if (d && d.kind === 'product' && d.name === moduleName && d.package) {
				return { productName: d.name, packageName: d.package };
			}
		}
	}
	return null;
}

function inferProductMappingFromManifest(packageSwiftPath, moduleName) {
	try {
		const src = fs.readFileSync(packageSwiftPath, 'utf8');
		if (!src) return null;
		const re = new RegExp(String.raw`\.product\s*\(\s*name:\s*"${moduleName}"\s*,\s*package:\s*"([^"]+)"\s*\)`, 'g');
		const m = re.exec(src);
		if (m && m[1]) return { productName: moduleName, packageName: m[1] };
		return null;
	} catch {
		return null;
	}
}

function resolveProductMapping(specFile, packageSwiftPath, depGraph, moduleName) {
	const map = readSpmDepMap(specFile);
	const normalized = normalizeSpmDepMap(map);
	if (normalized.products && normalized.products[moduleName]) {
		const item = normalized.products[moduleName];
		if (item && item.kind === 'product' && item.name && item.package) {
			const pkgRef = normalized.packages ? normalized.packages[item.package] : null;
			return { productName: item.name, packageName: item.package, packageRef: pkgRef || null, mapItem: item };
		}
	}

	const inferred = inferProductMappingFromGraph(depGraph, moduleName);
	if (inferred) return inferred;

	const inferred2 = inferProductMappingFromManifest(packageSwiftPath, moduleName);
	if (inferred2) return inferred2;

	return null;
}

/**
 * 在形如 `dependencies: [ ... ]` 的数组里插入一条新元素。
 *
 * 关键点：
 * - 不能简单拼接 `",\n"`，否则当数组末尾本来就有 trailing comma（推荐写法）时，
 *   会产生单独一行的 `,`（你贴出来的就是这个问题）。
 * - 正确做法是：先 trim 掉 `]` 前面的空白，再确保最后一个元素末尾有逗号，然后插入新行。
 */
function insertItemIntoBracketArray(before, after, itemIndent, itemText, closingIndent) {
	const trimmed = String(before || '').replace(/\s*$/, '');
	const needComma = !(trimmed.endsWith('[') || trimmed.endsWith(','));
	const base = needComma ? (trimmed + ',') : trimmed;
	// 统一按 multiline 风格写入，并保持 trailing comma（SwiftPM 推荐）
	return base + `\n${itemIndent}${itemText},\n${closingIndent}` + after;
}

function patchPackageSwiftAddTargetDependency(packageSwiftPath, fromTarget, toTarget) {
	const src = fs.readFileSync(packageSwiftPath, 'utf8');
	if (!src) return { ok: false, changed: false, error: 'empty Package.swift' };

	const { blocks } = packageParser.extractTargetBlocksFromPackageSwift(src);
	const targetBlock = blocks.find((b) => b.name === fromTarget);
	if (!targetBlock) return { ok: false, changed: false, error: `target "${fromTarget}" not found` };

	const blockText = src.slice(targetBlock.start, targetBlock.end);
	if (
		blockText.includes(`"${toTarget}"`)
		|| blockText.includes(`.target(name: "${toTarget}")`)
		|| blockText.includes(`.byName(name: "${toTarget}")`)
	) {
		return { ok: true, changed: false };
	}

	let newBlockText = blockText;
	const depIdx = blockText.indexOf('dependencies:');
	if (depIdx >= 0) {
		const bracketStart = blockText.indexOf('[', depIdx);
		if (bracketStart < 0) return { ok: false, changed: false, error: 'dependencies: found but [ not found' };

		let i = bracketStart;
		let depth = 0;
		let inString = false;
		let escape = false;
		let inLineComment = false;
		let inBlockComment = false;
		for (; i < blockText.length; i++) {
			const ch = blockText[i];
			const nextCh = i + 1 < blockText.length ? blockText[i + 1] : '';

			if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
			if (inBlockComment) { if (ch === '*' && nextCh === '/') { inBlockComment = false; i++; } continue; }
			if (!inString) {
				if (ch === '/' && nextCh === '/') { inLineComment = true; i++; continue; }
				if (ch === '/' && nextCh === '*') { inBlockComment = true; i++; continue; }
			}
			if (inString) {
				if (escape) { escape = false; continue; }
				if (ch === '\\') { escape = true; continue; }
				if (ch === '"') { inString = false; continue; }
				continue;
			} else {
				if (ch === '"') { inString = true; continue; }
			}

			if (ch === '[') depth++;
			if (ch === ']') { depth--; if (depth === 0) break; }
		}
		if (depth !== 0) return { ok: false, changed: false, error: 'dependencies bracket not balanced' };

		const bracketEnd = i;
		const before = blockText.slice(0, bracketEnd);
		const after = blockText.slice(bracketEnd);

		const depLineStart = blockText.lastIndexOf('\n', depIdx);
		const depLine = blockText.slice(depLineStart + 1, blockText.indexOf('\n', depIdx) >= 0 ? blockText.indexOf('\n', depIdx) : blockText.length);
		const indent = depLine.match(/^\s*/)?.[0] || '        ';
		const itemIndent = indent + '  ';

		newBlockText = insertItemIntoBracketArray(before, after, itemIndent, `"${toTarget}"`, indent);
	} else {
		const nameMatch = blockText.match(/name:\s*"([^"]+)"/);
		if (!nameMatch) return { ok: false, changed: false, error: 'name: "..." not found in target block' };

		const firstLine = blockText.split('\n')[0];
		const baseIndent = firstLine.match(/^\s*/)?.[0] || '    ';
		const paramIndent = baseIndent + '    ';

		const insertLine = `${paramIndent}dependencies: ["${toTarget}"],\n`;
		const nameIdx = blockText.indexOf(nameMatch[0]);
		const lineEndIdx = blockText.indexOf('\n', nameIdx);
		const insertPos = lineEndIdx >= 0 ? lineEndIdx + 1 : blockText.length;
		newBlockText = blockText.slice(0, insertPos) + insertLine + blockText.slice(insertPos);
	}

	const out = src.slice(0, targetBlock.start) + newBlockText + src.slice(targetBlock.end);
	fs.writeFileSync(packageSwiftPath, out, 'utf8');
	return { ok: true, changed: true };
}

function patchPackageSwiftAddProductDependency(packageSwiftPath, fromTarget, productName, packageName) {
	const src = fs.readFileSync(packageSwiftPath, 'utf8');
	if (!src) return { ok: false, changed: false, error: 'empty Package.swift' };

	const { blocks } = packageParser.extractTargetBlocksFromPackageSwift(src);
	const targetBlock = blocks.find((b) => b.name === fromTarget);
	if (!targetBlock) return { ok: false, changed: false, error: `target "${fromTarget}" not found` };

	const blockText = src.slice(targetBlock.start, targetBlock.end);
	const prodNeedle = `.product(name: "${productName}", package: "${packageName}")`;
	if (blockText.includes(prodNeedle) || blockText.includes(`.product(name: "${productName}"`) || blockText.includes(`"${productName}"`)) {
		return { ok: true, changed: false };
	}

	let newBlockText = blockText;
	const depIdx = blockText.indexOf('dependencies:');
	if (depIdx >= 0) {
		const bracketStart = blockText.indexOf('[', depIdx);
		if (bracketStart < 0) return { ok: false, changed: false, error: 'dependencies: found but [ not found' };

		let i = bracketStart;
		let depth = 0;
		let inString = false;
		let escape = false;
		let inLineComment = false;
		let inBlockComment = false;
		for (; i < blockText.length; i++) {
			const ch = blockText[i];
			const nextCh = i + 1 < blockText.length ? blockText[i + 1] : '';
			if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
			if (inBlockComment) { if (ch === '*' && nextCh === '/') { inBlockComment = false; i++; } continue; }
			if (!inString) {
				if (ch === '/' && nextCh === '/') { inLineComment = true; i++; continue; }
				if (ch === '/' && nextCh === '*') { inBlockComment = true; i++; continue; }
			}
			if (inString) {
				if (escape) { escape = false; continue; }
				if (ch === '\\') { escape = true; continue; }
				if (ch === '"') { inString = false; continue; }
				continue;
			} else {
				if (ch === '"') { inString = true; continue; }
			}
			if (ch === '[') depth++;
			if (ch === ']') { depth--; if (depth === 0) break; }
		}
		if (depth !== 0) return { ok: false, changed: false, error: 'dependencies bracket not balanced' };

		const bracketEnd = i;
		const before = blockText.slice(0, bracketEnd);
		const after = blockText.slice(bracketEnd);

		const depLineStart = blockText.lastIndexOf('\n', depIdx);
		const depLine = blockText.slice(depLineStart + 1, blockText.indexOf('\n', depIdx) >= 0 ? blockText.indexOf('\n', depIdx) : blockText.length);
		const indent = depLine.match(/^\s*/)?.[0] || '        ';
		const itemIndent = indent + '  ';

		newBlockText = insertItemIntoBracketArray(before, after, itemIndent, prodNeedle, indent);
	} else {
		const nameMatch = blockText.match(/name:\s*"([^"]+)"/);
		if (!nameMatch) return { ok: false, changed: false, error: 'name: "..." not found in target block' };

		const firstLine = blockText.split('\n')[0];
		const baseIndent = firstLine.match(/^\s*/)?.[0] || '    ';
		const paramIndent = baseIndent + '    ';
		const insertLine = `${paramIndent}dependencies: [${prodNeedle}],\n`;

		const nameIdx = blockText.indexOf(nameMatch[0]);
		const lineEndIdx = blockText.indexOf('\n', nameIdx);
		const insertPos = lineEndIdx >= 0 ? lineEndIdx + 1 : blockText.length;
		newBlockText = blockText.slice(0, insertPos) + insertLine + blockText.slice(insertPos);
	}

	const out = src.slice(0, targetBlock.start) + newBlockText + src.slice(targetBlock.end);
	fs.writeFileSync(packageSwiftPath, out, 'utf8');
	return { ok: true, changed: true };
}

function isPackageDeclaredInManifest(packageSwiftPath, packageName, packageRef) {
	try {
		const src = fs.readFileSync(packageSwiftPath, 'utf8');
		if (!src) return false;

		if (packageRef && packageRef.kind === 'path' && packageRef.path) {
			return src.includes(`.package(path: "${packageRef.path}")`) || src.includes(`.package(path:"${packageRef.path}")`);
		}
		if (packageRef && packageRef.kind === 'url' && packageRef.url) {
			return src.includes(`.package(url: "${packageRef.url}"`) || src.includes(`.package(url:"${packageRef.url}"`);
		}

		if (packageName) {
			return src.includes(`package: "${packageName}"`) || src.includes(`package:"${packageName}"`);
		}
		return false;
	} catch {
		return false;
	}
}

function patchPackageSwiftAddPackageDependency(packageSwiftPath, packageName, packageRef) {
	const src = fs.readFileSync(packageSwiftPath, 'utf8');
	if (!src) return { ok: false, changed: false, error: 'empty Package.swift' };

	if (!packageRef || (!packageRef.path && !packageRef.url)) {
		return { ok: false, changed: false, error: 'packageRef missing (need path/url)' };
	}
	if (isPackageDeclaredInManifest(packageSwiftPath, packageName, packageRef)) {
		return { ok: true, changed: false };
	}

	const packageLine = packageRef.kind === 'url'
		? `.package(url: "${packageRef.url}", from: "${packageRef.from || "0.0.0"}")`
		: `.package(path: "${packageRef.path}")`;

	const pkgCall = src.indexOf('Package(');
	if (pkgCall < 0) return { ok: false, changed: false, error: 'Package( not found' };

	let i = pkgCall;
	while (i < src.length && src[i] !== '(') i++;
	if (i >= src.length) return { ok: false, changed: false, error: 'Package( has no (' };

	const pkgParenStart = i;
	let parenDepth = 0;
	let inString = false;
	let escape = false;
	let inLineComment = false;
	let inBlockComment = false;
	let pkgParenEnd = -1;
	for (let j = pkgParenStart; j < src.length; j++) {
		const ch = src[j];
		const nextCh = j + 1 < src.length ? src[j + 1] : '';
		if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
		if (inBlockComment) { if (ch === '*' && nextCh === '/') { inBlockComment = false; j++; } continue; }
		if (!inString) {
			if (ch === '/' && nextCh === '/') { inLineComment = true; j++; continue; }
			if (ch === '/' && nextCh === '*') { inBlockComment = true; j++; continue; }
		}
		if (inString) {
			if (escape) { escape = false; continue; }
			if (ch === '\\') { escape = true; continue; }
			if (ch === '"') { inString = false; continue; }
			continue;
		} else {
			if (ch === '"') { inString = true; continue; }
		}
		if (ch === '(') parenDepth++;
		if (ch === ')') {
			parenDepth--;
			if (parenDepth === 0) { pkgParenEnd = j; break; }
		}
	}
	if (pkgParenEnd < 0) return { ok: false, changed: false, error: 'Package(...) not balanced' };

	const pkgBody = src.slice(pkgParenStart + 1, pkgParenEnd);
	const depKey = 'dependencies:';
	const targetsKey = 'targets:';

	const depIdx = pkgBody.indexOf(depKey);
	if (depIdx >= 0) {
		const absDepIdx = (pkgParenStart + 1) + depIdx;
		const bracketStart = src.indexOf('[', absDepIdx);
		if (bracketStart < 0 || bracketStart > pkgParenEnd) {
			return { ok: false, changed: false, error: 'package dependencies: found but [ not found' };
		}

		let k = bracketStart;
		let depth = 0;
		inString = false; escape = false; inLineComment = false; inBlockComment = false;
		for (; k < pkgParenEnd; k++) {
			const ch = src[k];
			const nextCh = k + 1 < src.length ? src[k + 1] : '';
			if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
			if (inBlockComment) { if (ch === '*' && nextCh === '/') { inBlockComment = false; k++; } continue; }
			if (!inString) {
				if (ch === '/' && nextCh === '/') { inLineComment = true; k++; continue; }
				if (ch === '/' && nextCh === '*') { inBlockComment = true; k++; continue; }
			}
			if (inString) {
				if (escape) { escape = false; continue; }
				if (ch === '\\') { escape = true; continue; }
				if (ch === '"') { inString = false; continue; }
				continue;
			} else {
				if (ch === '"') { inString = true; continue; }
			}
			if (ch === '[') depth++;
			if (ch === ']') { depth--; if (depth === 0) break; }
		}
		if (depth !== 0) return { ok: false, changed: false, error: 'package dependencies bracket not balanced' };

		const bracketEnd = k;
		const before = src.slice(0, bracketEnd);
		const after = src.slice(bracketEnd);

		const depLineStart = src.lastIndexOf('\n', absDepIdx);
		const depLine = src.slice(depLineStart + 1, src.indexOf('\n', absDepIdx) >= 0 ? src.indexOf('\n', absDepIdx) : src.length);
		const indent = depLine.match(/^\s*/)?.[0] || '    ';
		const itemIndent = indent + '    ';

		const nextSrc = insertItemIntoBracketArray(before, after, itemIndent, packageLine, indent);
		fs.writeFileSync(packageSwiftPath, nextSrc, 'utf8');
		return { ok: true, changed: true };
	}

	const targetsIdx = pkgBody.indexOf(targetsKey);
	const insertNeedle = `dependencies: [\n        ${packageLine}\n    ],\n    `;
	if (targetsIdx >= 0) {
		const absTargetsIdx = (pkgParenStart + 1) + targetsIdx;
		fs.writeFileSync(packageSwiftPath, src.slice(0, absTargetsIdx) + insertNeedle + src.slice(absTargetsIdx), 'utf8');
		return { ok: true, changed: true };
	}

	const nameMatch = src.match(/name:\s*"[^"]+"\s*,\s*\n/);
	if (!nameMatch || nameMatch.index == null) {
		return { ok: false, changed: false, error: 'package name line not found for insertion' };
	}
	const pos = nameMatch.index + nameMatch[0].length;
	const fallbackNeedle = `dependencies: [\n        ${packageLine}\n    ],\n`;
	fs.writeFileSync(packageSwiftPath, src.slice(0, pos) + fallbackNeedle + src.slice(pos), 'utf8');
	return { ok: true, changed: true };
}

async function ensureDependency(specFile, packageSwiftPath, fromTarget, toTarget) {
	const mode = getFixMode(specFile);
	const changes = [];
	const depGraph = await getOrBuildDepGraph(packageSwiftPath);
	if (!depGraph) {
		return { ok: false, changed: false, mode, reason: 'depGraphUnavailable', file: packageSwiftPath };
	}

	const targetsSet = new Set(depGraph.targetsList || []);
	if (targetsSet.has(fromTarget) && targetsSet.has(toTarget)) {
		if (isReachable(depGraph, fromTarget, toTarget)) {
			return { ok: true, changed: false, mode, file: packageSwiftPath, changes };
		}

		if (mode === 'off' || mode === 'suggest') {
			return { ok: false, changed: false, mode, reason: 'missing', file: packageSwiftPath, suggestion: suggestPatch(packageSwiftPath, fromTarget, toTarget) };
		}

		const result = patchPackageSwiftAddTargetDependency(packageSwiftPath, fromTarget, toTarget);
		if (!result.ok) {
			return { ok: false, changed: false, mode, reason: 'fixFailed', file: packageSwiftPath, error: result.error, suggestion: suggestPatch(packageSwiftPath, fromTarget, toTarget) };
		}
		if (result.changed) {
			changes.push({ type: 'targetDependency', file: packageSwiftPath, fromTarget, toTarget });
		}

		const fresh = await buildDepGraph(packageSwiftPath);
		if (fresh) {
			writeJsonSafe(getDepGraphCacheFile(packageSwiftPath), fresh);
		}

		return { ok: true, changed: !!result.changed, mode, file: packageSwiftPath, changes };
	}

	if (!targetsSet.has(fromTarget)) {
		return { ok: false, changed: false, mode, reason: 'unknownFromTarget', file: packageSwiftPath };
	}

	const mapping = resolveProductMapping(specFile, packageSwiftPath, depGraph, toTarget);
	if (!mapping) {
		const hint = `未能推断跨包 product 映射（${toTarget}）。
Package.swift: ${packageSwiftPath}

当前工程依赖映射文件为：${SPM_DEP_MAP_FILE}（与 AutoSnippetRoot.boxspec.json 同级）
建议：
1) 先执行 \`asd spm-map\`（watch 启动也会自动更新），让工具扫描所有 Package.swift 生成/补全映射与依赖图。
2) 若仍缺失，说明工程内未出现过 \`.product(name: "${toTarget}", package: "...")\` 的用法，无法自动推断。此时请手动在 ${SPM_DEP_MAP_FILE} 中补一条 products 映射：
{
  "products": {
    "${toTarget}": { "kind": "product", "name": "${toTarget}", "package": "<PackageName>" }
  }
}
（如果 <PackageName> 是工程内 path 包，通常无需额外写 packages；外部 url 包则需要 packages 提供 url/from 才能自动补 .package(...)。）`;
		return { ok: false, changed: false, mode, reason: 'productMappingMissing', file: packageSwiftPath, suggestion: hint };
	}

	const productName = mapping.productName || toTarget;
	const packageName = mapping.packageName;

	// ===== 约束校验（基于 package DAG：禁止形成循环/反向引入）=====
	const fromPackageName = depGraph.packageName || null;
	const graph = getProjectGraph(specFile);
	if (fromPackageName && packageName && wouldCreatePackageCycle(graph, fromPackageName, packageName)) {
		const msg = `检测到跨包依赖将形成循环/反向引入：${fromPackageName} -> ${packageName}\n` +
			`已阻止写入 Package.swift（policy=enforcement:block）。\n` +
			`建议：调整 Package.swift 的依赖方向，或将上层能力下沉到被依赖包。`;
		return { ok: false, changed: false, mode, reason: 'cycleBlocked', file: packageSwiftPath, suggestion: msg };
	}

	// ===== 自动推断 packageRef（工程内 .package(path:)）=====
	if (!mapping.packageRef) {
		const inferredRef = resolvePackageRefFromGraph(graph, specFile, packageSwiftPath, packageName);
		if (inferredRef) mapping.packageRef = inferredRef;
	}

	if (mapping.packageRef && !isPackageDeclaredInManifest(packageSwiftPath, packageName, mapping.packageRef)) {
		if (mode === 'off' || mode === 'suggest') {
			const hint = `缺少外部 package 声明（${packageName}）。建议在 Package.swift 的 dependencies 中添加：\n  - ${mapping.packageRef.kind === 'url'
				? `.package(url: "${mapping.packageRef.url}", from: "${mapping.packageRef.from || "0.0.0"}")`
				: `.package(path: "${mapping.packageRef.path}")`}`;
			return { ok: false, changed: false, mode, reason: 'missingPackage', file: packageSwiftPath, suggestion: `Package.swift: ${packageSwiftPath}\n` + hint };
		}

		const pkgRes = patchPackageSwiftAddPackageDependency(packageSwiftPath, packageName, mapping.packageRef);
		if (!pkgRes.ok) {
			return { ok: false, changed: false, mode, reason: 'fixFailed', file: packageSwiftPath, error: pkgRes.error };
		}
		if (pkgRes.changed) {
			changes.push({ type: 'packageDependency', file: packageSwiftPath, packageName, packageRef: mapping.packageRef });
		}
	}

	if (hasDirectDependency(depGraph, fromTarget, productName) || (inferProductMappingFromGraph(depGraph, productName) && true)) {
		// 去重交给 patch 函数
	}

	if (mode === 'off' || mode === 'suggest') {
		return { ok: false, changed: false, mode, reason: 'missingProduct', file: packageSwiftPath, suggestion: suggestProductPatch(packageSwiftPath, fromTarget, productName, packageName) };
	}

	const result2 = patchPackageSwiftAddProductDependency(packageSwiftPath, fromTarget, productName, packageName);
	if (!result2.ok) {
		return { ok: false, changed: false, mode, reason: 'fixFailed', file: packageSwiftPath, error: result2.error, suggestion: suggestProductPatch(packageSwiftPath, fromTarget, productName, packageName) };
	}
	if (result2.changed) {
		changes.push({ type: 'productDependency', file: packageSwiftPath, fromTarget, productName, packageName });
	}

	const fresh2 = await buildDepGraph(packageSwiftPath);
	if (fresh2) {
		writeJsonSafe(getDepGraphCacheFile(packageSwiftPath), fresh2);
	}

	return { ok: true, changed: !!result2.changed, mode, file: packageSwiftPath, changes };
}

module.exports = {
	getFixMode,
	getOrBuildDepGraph,
	isReachable,
	ensureDependency,
};

