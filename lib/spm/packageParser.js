#!/usr/bin/env node

/**
 * 职责：
 * - 与 SPM/Package.swift 相关的“解析与定位”能力（AST-lite）
 * - 让 lib 层不再依赖 bin/findPath.js
 *
 * 对外导出：
 * - findPackageSwiftPath(filePath)
 * - parsePackageSwift(packagePath)
 * - extractTargetBlocksFromPackageSwift(content)
 */

const fs = require('fs');
const path = require('path');

const PACKAGE_SWIFT = 'Package.swift';

// 目录缓存（减少重复 readdir）
const directoryCache = new Map();
const CACHE_TTL = 60000;

async function getDirectoryEntries(dirPath) {
	const cacheKey = path.resolve(dirPath);
	try {
		const stats = await fs.promises.stat(dirPath);
		if (stats.isFile()) {
			directoryCache.delete(cacheKey);
			return null;
		}
	} catch {
		// ignore
	}

	const cached = directoryCache.get(cacheKey);
	if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.entries;

	try {
		const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
		if (directoryCache.size > 1000) {
			const now = Date.now();
			for (const [key, value] of directoryCache.entries()) {
				if (now - value.timestamp >= CACHE_TTL) directoryCache.delete(key);
			}
		}
		directoryCache.set(cacheKey, { entries, timestamp: Date.now() });
		return entries;
	} catch (err) {
		if (err.code === 'ENOENT' || err.code === 'EACCES' || err.code === 'ENOTDIR') return null;
		throw err;
	}
}

async function findPackageSwiftPath(filePath) {
	let currentPath = path.resolve(filePath);

	while (currentPath) {
		try {
			const entries = await getDirectoryEntries(currentPath);
			if (!entries) {
				const parentPath = path.dirname(currentPath);
				if (parentPath === currentPath) break;
				currentPath = parentPath;
				continue;
			}

			for (const entry of entries) {
				if (entry.isFile() && entry.name === PACKAGE_SWIFT) {
					return path.join(currentPath, entry.name);
				}
			}

			const parentPath = path.dirname(currentPath);
			if (parentPath === currentPath) break;
			currentPath = parentPath;
		} catch (err) {
			if (err.code === 'ENOENT' || err.code === 'EACCES') {
				const parentPath = path.dirname(currentPath);
				if (parentPath === currentPath) break;
				currentPath = parentPath;
				continue;
			}
			throw err;
		}
	}

	return null;
}

async function parsePackageSwift(packagePath) {
	try {
		const content = await fs.promises.readFile(packagePath, 'utf8');
		const packageNameMatch = content.match(/name:\s*"([^"]+)"/);
		const packageName = packageNameMatch ? packageNameMatch[1] : null;

		const { blocks, targets, targetsInfo } = extractTargetBlocksFromPackageSwift(content);

		return {
			name: packageName,
			targets: targets,
			targetsInfo: targetsInfo,
			path: path.dirname(packagePath)
		};
	} catch {
		return null;
	}
}

/**
 * 从 Package.swift 内容中提取所有 `.target(...)` block，并做轻量解析：
 * - target name
 * - dependencies（字符串 / .target(name:) / .product / .byName）
 *
 * 说明：这是一个 AST-lite 解析器（括号配对 + 跳过字符串/注释），用于支持依赖图能力。
 */
function extractTargetBlocksFromPackageSwift(content) {
	const blocks = [];
	const targets = [];
	const targetsInfo = {};

	if (!content) return { blocks, targets, targetsInfo };

	let idx = 0;
	while (idx < content.length) {
		const hit = content.indexOf('.target', idx);
		if (hit < 0) break;

		const parenStart = content.indexOf('(', hit);
		if (parenStart < 0) { idx = hit + 6; continue; }

		let i = parenStart;
		let depth = 0;
		let inString = false;
		let escape = false;
		let inLineComment = false;
		let inBlockComment = false;

		for (; i < content.length; i++) {
			const ch = content[i];
			const nextCh = i + 1 < content.length ? content[i + 1] : '';

			if (inLineComment) {
				if (ch === '\n') inLineComment = false;
				continue;
			}
			if (inBlockComment) {
				if (ch === '*' && nextCh === '/') {
					inBlockComment = false;
					i++;
				}
				continue;
			}

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

			if (ch === '(') depth++;
			if (ch === ')') {
				depth--;
				if (depth === 0) break;
			}
		}

		if (depth !== 0) {
			idx = parenStart + 1;
			continue;
		}

		const blockStart = hit;
		const blockEnd = i + 1;
		const blockText = content.slice(blockStart, blockEnd);

		const nameMatch = blockText.match(/name:\s*"([^"]+)"/);
		const name = nameMatch ? nameMatch[1] : null;

		const pathMatch = blockText.match(/path:\s*"([^"]+)"/);
		const targetPath = pathMatch ? pathMatch[1] : null;

		let sources = null;
		const sourcesMatch = blockText.match(/sources:\s*\[([\s\S]*?)\]/);
		if (sourcesMatch) {
			const inner = sourcesMatch[1];
			const srcList = [];
			const re = /"([^"]+)"/g;
			let m = null;
			while ((m = re.exec(inner)) !== null) {
				srcList.push(m[1]);
			}
			if (srcList.length) sources = srcList;
		}

		const dependencies = [];
		const depMatch = blockText.match(/dependencies:\s*\[([\s\S]*?)\]/);
		if (depMatch) {
			const inner = depMatch[1];

			// 1) "TargetName"
			const reStr = /"([^"]+)"/g;
			let m1 = null;
			while ((m1 = reStr.exec(inner)) !== null) {
				dependencies.push({ kind: 'string', name: m1[1] });
			}

			// 2) .target(name: "X") / .byName(name: "X")
			const reTarget = /\.(?:target|byName)\(\s*name:\s*"([^"]+)"/g;
			let m2 = null;
			while ((m2 = reTarget.exec(inner)) !== null) {
				dependencies.push({ kind: 'target', name: m2[1] });
			}

			// 3) .product(name: "P", package: "Pkg")
			const reProd = /\.product\(\s*name:\s*"([^"]+)"\s*,\s*package:\s*"([^"]+)"/g;
			let m3 = null;
			while ((m3 = reProd.exec(inner)) !== null) {
				dependencies.push({ kind: 'product', name: m3[1], package: m3[2] });
			}
		}

		blocks.push({ name, start: blockStart, end: blockEnd });
		if (name) {
			targets.push(name);
			targetsInfo[name] = { name, path: targetPath, sources, dependencies };
		}

		idx = blockEnd;
	}

	return { blocks, targets, targetsInfo };
}

module.exports = {
	findPackageSwiftPath,
	parsePackageSwift,
	extractTargetBlocksFromPackageSwift,
};

