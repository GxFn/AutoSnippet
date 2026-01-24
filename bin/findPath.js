#!/usr/bin/env node

/**
 * 职责：
 * - 路径/工程结构查找工具：定位 AutoSnippet.boxspec.json、AutoSnippetRoot.boxspec.json、Package.swift 等关键文件
 * - 解析 SPM Package.swift（AST-lite）：提取 targets、每个 target 的 dependencies/path/sources 等信息
 *
 * 核心流程：
 * - findASSpecPath / findASSpecPathAsync: 向上查找模块 spec
 * - findProjectRoot / getRootSpecFilePath: 定位项目根（root marker）与根 spec
 * - findPackageSwiftPath: 从目录向上查找最近的 Package.swift
 * - parsePackageSwift / extractTargetBlocksFromPackageSwift: 解析 Package.swift 并提取 target blocks（跳过字符串/注释）
 *
 * 核心方法（主要导出）：
 * - findASSpecPath, findASSpecPathAsync, findPackageSwiftPath
 * - parsePackageSwift, extractTargetBlocksFromPackageSwift
 * - findSubHeaderPath, findSubASSpecPath
 * - findProjectRoot, getRootSpecFilePath
 * - ROOT_MARKER_NAME
 */

const fs = require('fs');
const path = require('path');
// 全局常量
const HOLDER_NAME = 'AutoSnippet.boxspec.json';
const ROOT_MARKER_NAME = 'AutoSnippetRoot.boxspec.json'; // 项目根目录标记文件
const PACKAGE_SWIFT = 'Package.swift';
const README_NAME = 'readme.md';

// 目录缓存（优化：减少重复读取）
const directoryCache = new Map();
const CACHE_TTL = 60000; // 缓存 60 秒

async function getDirectoryEntries(dirPath) {
	const cacheKey = path.resolve(dirPath);
	
	// ✅ 首先检查路径是否是文件，如果是文件，立即返回 null（避免 ENOTDIR 错误）
	// 注意：这个检查要在缓存检查之前，因为缓存可能包含错误的条目
	try {
		const stats = await fs.promises.stat(dirPath);
		if (stats.isFile()) {
			directoryCache.delete(cacheKey);
			return null;
		}
	} catch (err) {
		// 继续
	}
	
	const cached = directoryCache.get(cacheKey);
	
	if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
		return cached.entries;
	}
	
	try {
		const entries = await fs.promises.readdir(dirPath, {
			withFileTypes: true
		});
		
		if (directoryCache.size > 1000) {
			const now = Date.now();
			for (const [key, value] of directoryCache.entries()) {
				if (now - value.timestamp >= CACHE_TTL) {
					directoryCache.delete(key);
				}
			}
		}
		
		directoryCache.set(cacheKey, {
			entries,
			timestamp: Date.now()
		});
		
		return entries;
	} catch (err) {
		if (err.code === 'ENOENT' || err.code === 'EACCES' || err.code === 'ENOTDIR') {
			return null;
		}
		throw err;
	}
}

function isProjectRoot(dirPath, entries) {
	if (!entries) {
		return false;
	}
	
	// 工程根目录标记（按优先级）
	const rootMarkers = [
		'.git',
		PACKAGE_SWIFT,
		'.xcodeproj',
		'.xcworkspace',
		'Podfile',
		'.swiftpm',
	];
	
	for (const entry of entries) {
		const name = entry.name;
		if (rootMarkers.includes(name) && (entry.isFile() || entry.isDirectory())) {
			return true;
		}
	}
	
	return false;
}

async function searchUpwardForFile(filePath, fileName) {
	let currentPath = path.resolve(filePath);
	const maxLevels = 20;
	let levelsChecked = 0;
	
	while (currentPath && levelsChecked < maxLevels) {
		try {
			const entries = await getDirectoryEntries(currentPath);
			if (entries) {
				for (const entry of entries) {
					if (entry.isFile() && entry.name === fileName) {
						return path.join(currentPath, entry.name);
					}
				}
			}
			
			const parentPath = path.dirname(currentPath);
			if (parentPath === currentPath) {
				break;
			}
			currentPath = parentPath;
			levelsChecked++;
		} catch (err) {
			if (err.code === 'ENOENT' || err.code === 'EACCES') {
				const parentPath = path.dirname(currentPath);
				if (parentPath === currentPath) {
					break;
				}
				currentPath = parentPath;
				levelsChecked++;
				continue;
			}
			throw err;
		}
	}
	
	return null;
}

async function findASSpecPathAsync(filePath) {
	const holderPath = await searchUpwardForFile(filePath, HOLDER_NAME);
	if (holderPath) {
		return holderPath;
	}
	
	return await searchUpwardForFile(filePath, ROOT_MARKER_NAME);
}

function isProjectRootSync(dirPath, files) {
	if (!files || files.length === 0) {
		return false;
	}
	
	// 工程根目录标记（按优先级）
	const rootMarkers = [
		'.git',
		PACKAGE_SWIFT,
		'.xcodeproj',
		'.xcworkspace',
		'Podfile',
	];
	
	for (const filename of files) {
		if (rootMarkers.includes(filename)) {
			try {
				const filePath = path.join(dirPath, filename);
				const stats = fs.lstatSync(filePath);
				if (stats.isFile() || stats.isDirectory()) {
					return true;
				}
			} catch (err) {
				// 继续检查
			}
		}
	}
	
	return false;
}

function findASSpecPath(filePath, callback, configPath, configDir) {
	if (configPath === undefined) configPath = null;
	if (configDir === undefined) configDir = null;
	
	const maxLevels = 20;
	let levelsChecked = 0;
	
	function search(currentPath, foundConfigPath, foundConfigDir, level) {
		if (level >= maxLevels) {
			if (foundConfigPath) {
				callback(foundConfigPath);
			}
			return;
		}

		fs.readdir(currentPath, function (err, files) {
			if (err) {
				if (err.code === 'ENOENT' || err.code === 'EACCES') {
					const parentPath = path.join(currentPath, '/..');
					const parentResolvedPath = path.resolve(parentPath);
					
					if (parentResolvedPath === path.resolve(currentPath)) {
						if (foundConfigPath) {
							callback(foundConfigPath);
						}
						return;
					}
					
					search(parentPath, foundConfigPath, foundConfigDir, level + 1);
				}
			return;
		}

			let isFound = false;
			let currentConfigPath = foundConfigPath;
			let currentConfigDir = foundConfigDir;
			
			files.forEach(function (filename) {
				if (filename === HOLDER_NAME) {
					isFound = true;
					if (!currentConfigPath) {
						currentConfigPath = path.join(currentPath, filename);
						currentConfigDir = path.resolve(currentPath);
					}
				}
			});

			if (currentConfigPath) {
				if (isProjectRootSync(currentPath, files)) {
					callback(currentConfigPath);
					return;
				}
			}

			const parentPath = path.join(currentPath, '/..');
			const parentResolvedPath = path.resolve(parentPath);
			
			if (parentResolvedPath === path.resolve(currentPath)) {
				if (currentConfigPath) {
					callback(currentConfigPath);
				}
				return;
			}

			search(parentPath, currentConfigPath, currentConfigDir, level + 1);
		});
	}
	
	search(filePath, configPath, configDir, 0);
}

async function findPackageSwiftPath(filePath) {
	let currentPath = path.resolve(filePath);
	
	while (currentPath) {
		try {
			const entries = await getDirectoryEntries(currentPath);
			if (!entries) {
				const parentPath = path.dirname(currentPath);
				if (parentPath === currentPath) {
					break;
				}
				currentPath = parentPath;
				continue;
			}
			
			for (const entry of entries) {
				if (entry.isFile() && entry.name === PACKAGE_SWIFT) {
					return path.join(currentPath, entry.name);
				}
			}
			
			const parentPath = path.dirname(currentPath);
			if (parentPath === currentPath) {
				break;
			}
			currentPath = parentPath;
			
		} catch (err) {
			if (err.code === 'ENOENT' || err.code === 'EACCES') {
				const parentPath = path.dirname(currentPath);
				if (parentPath === currentPath) {
					break;
				}
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
	} catch (err) {
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

	// 扫描所有 ".target(" 起点
	let idx = 0;
	while (idx < content.length) {
		const hit = content.indexOf('.target', idx);
		if (hit < 0) break;

		// 找到 '('
		const parenStart = content.indexOf('(', hit);
		if (parenStart < 0) { idx = hit + 6; continue; }

		// 括号配对（跳过字符串/注释）
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
			// 不平衡，跳过这个命中点
			idx = parenStart + 1;
			continue;
		}

		const blockStart = hit;
		const blockEnd = i + 1; // include ')'
		const blockText = content.slice(blockStart, blockEnd);

		const nameMatch = blockText.match(/name:\s*"([^"]+)"/);
		const name = nameMatch ? nameMatch[1] : null;

		// path: "xxx"
		const pathMatch = blockText.match(/path:\s*"([^"]+)"/);
		const targetPath = pathMatch ? pathMatch[1] : null;

		// sources: ["Code"] / ["Sources"] / [...]
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

		const deps = [];

		// 解析 dependencies: [...]
		const depIdx = blockText.indexOf('dependencies:');
		if (depIdx >= 0) {
			const bracketStart = blockText.indexOf('[', depIdx);
			if (bracketStart >= 0) {
				let j = bracketStart;
				let bDepth = 0;
				let sInString = false;
				let sEscape = false;
				let sLineComment = false;
				let sBlockComment = false;

				for (; j < blockText.length; j++) {
					const ch = blockText[j];
					const nextCh = j + 1 < blockText.length ? blockText[j + 1] : '';

					if (sLineComment) {
						if (ch === '\n') sLineComment = false;
						continue;
					}
					if (sBlockComment) {
						if (ch === '*' && nextCh === '/') { sBlockComment = false; j++; }
						continue;
					}
					if (!sInString) {
						if (ch === '/' && nextCh === '/') { sLineComment = true; j++; continue; }
						if (ch === '/' && nextCh === '*') { sBlockComment = true; j++; continue; }
					}
					if (sInString) {
						if (sEscape) { sEscape = false; continue; }
						if (ch === '\\') { sEscape = true; continue; }
						if (ch === '"') { sInString = false; continue; }
						continue;
					} else {
						if (ch === '"') { sInString = true; continue; }
					}

					if (ch === '[') bDepth++;
					if (ch === ']') {
						bDepth--;
						if (bDepth === 0) break;
					}
				}

				if (bDepth === 0) {
					const depArrayText = blockText.slice(bracketStart + 1, j);

					// split by comma at top-level (ignore nested parentheses)
					const items = [];
					let cur = '';
					let pDepth = 0;
					let dInString = false;
					let dEscape = false;
					for (let k = 0; k < depArrayText.length; k++) {
						const ch = depArrayText[k];
						if (dInString) {
							cur += ch;
							if (dEscape) { dEscape = false; continue; }
							if (ch === '\\') { dEscape = true; continue; }
							if (ch === '"') { dInString = false; continue; }
							continue;
						}
						if (ch === '"') { dInString = true; cur += ch; continue; }
						if (ch === '(') { pDepth++; cur += ch; continue; }
						if (ch === ')') { pDepth = Math.max(0, pDepth - 1); cur += ch; continue; }
						if (ch === ',' && pDepth === 0) {
							if (cur.trim()) items.push(cur.trim());
							cur = '';
							continue;
						}
						cur += ch;
					}
					if (cur.trim()) items.push(cur.trim());

					for (const it of items) {
						// "TargetName"
						const strMatch = it.match(/^"([^"]+)"$/);
						if (strMatch) {
							deps.push({ kind: 'byName', name: strMatch[1] });
							continue;
						}
						// .target(name: "X")
						const targetMatch = it.match(/\.target\s*\(\s*name:\s*"([^"]+)"/);
						if (targetMatch) {
							deps.push({ kind: 'target', name: targetMatch[1] });
							continue;
						}
						// .product(name: "X", package: "Y")
						const prodMatch = it.match(/\.product\s*\(\s*name:\s*"([^"]+)"\s*,\s*package:\s*"([^"]+)"/);
						if (prodMatch) {
							deps.push({ kind: 'product', name: prodMatch[1], package: prodMatch[2] });
							continue;
						}
						// .byName(name: "X")
						const byNameMatch = it.match(/\.byName\s*\(\s*name:\s*"([^"]+)"/);
						if (byNameMatch) {
							deps.push({ kind: 'byName', name: byNameMatch[1] });
							continue;
						}
					}
				}
			}
		}

		blocks.push({ start: blockStart, end: blockEnd, name: name });
		if (name) {
			targets.push(name);
			targetsInfo[name] = { type: 'target', dependencies: deps, path: targetPath, sources: sources };
		}

		idx = blockEnd;
	}

	return { blocks, targets, targetsInfo };
}

async function findSubHeaderPath(filePath, headerName, moduleName) {
	const codePath = path.join(filePath, 'Code');
	try {
		const stats = await fs.promises.stat(codePath);
		if (stats.isDirectory()) {
			const result = await findSubHeaderPath(codePath, headerName, null);
			if (result) {
				return result;
			}
		}
	} catch {
		// 继续查找
	}
	
	if (moduleName) {
		const includePath = path.join(filePath, 'include', moduleName);
		try {
			const stats = await fs.promises.stat(includePath);
			if (stats.isDirectory()) {
				const headerPath = path.join(includePath, `${headerName}.h`);
				try {
					await fs.promises.access(headerPath);
					return headerPath;
				} catch {
					// 继续查找
				}
			}
		} catch {
			// 继续查找
		}
	}
	
	try {
		const entries = await getDirectoryEntries(filePath);
		if (!entries) {
			return null;
		}
		
		for (const entry of entries) {
			if (entry.isFile() && entry.name === `${headerName}.h`) {
				return path.join(filePath, entry.name);
			} else if (entry.isDirectory()) {
				if (entry.name.startsWith('.') || entry.name === 'node_modules') {
					continue;
				}
				
				const result = await findSubHeaderPath(path.join(filePath, entry.name), headerName, null);
				if (result) {
					return result;
				}
			}
		}
	} catch (err) {
		// 忽略错误
	}
	
	return null;
}

async function findSubASSpecPath(filePath) {
	let resultArray = [];

	try {
		let dirPath = filePath;
		
		try {
			const stats = await fs.promises.stat(filePath);
			if (stats.isFile()) {
				dirPath = path.dirname(filePath);
			} else if (!stats.isDirectory()) {
				return resultArray;
			}
		} catch (err) {
			if (err.code === 'ENOENT' || err.code === 'EACCES') {
				if (path.basename(filePath) === HOLDER_NAME || path.extname(filePath) !== '') {
					dirPath = path.dirname(filePath);
				} else {
					return resultArray;
				}
			} else {
				return resultArray;
			}
		}
		const entries = await getDirectoryEntries(dirPath);
		if (!entries) {
			return resultArray;
		}

		for (const entry of entries) {
			if (entry.isFile() && entry.name === HOLDER_NAME) {
				resultArray.push(path.join(dirPath, entry.name));
			} else if (entry.isDirectory()) {
				if (entry.name.startsWith('.') || entry.name === 'node_modules') {
					continue;
				}
				
				const array = await findSubASSpecPath(path.join(dirPath, entry.name));
				resultArray = resultArray.concat(array);
			}
		}
	} catch (err) {
		if (err.code !== 'ENOTDIR') {
			// 忽略错误
		}
	}
	
	return resultArray;
}

async function findProjectRoot(filePath) {
	let startPath = path.resolve(filePath);
	
	try {
		const stats = await fs.promises.stat(startPath);
		if (stats.isFile()) {
			startPath = path.dirname(startPath);
		}
	} catch (err) {
		if (err.code === 'ENOENT' || err.code === 'EACCES') {
			if (path.basename(filePath).includes('.') || path.extname(filePath) !== '') {
				startPath = path.dirname(startPath);
			}
		}
	}
	
	const rootMarkerPath = await searchUpwardForFile(startPath, ROOT_MARKER_NAME);
	return rootMarkerPath ? path.dirname(rootMarkerPath) : null;
}

async function getRootSpecFilePath(filePath) {
	const projectRoot = await findProjectRoot(filePath);
	if (!projectRoot) {
		return null;
	}
	const rootSpecFile = path.join(projectRoot, ROOT_MARKER_NAME);
	
	try {
		await fs.promises.access(rootSpecFile);
	} catch (err) {
		if (err.code === 'ENOENT') {
			const specObj = {
				schemaVersion: 2,
				kind: 'root',
				root: true,
				skills: {
					dir: 'skills',
					format: 'md+frontmatter',
					index: 'skills/index.json',
				},
				list: []
			};
			const content = JSON.stringify(specObj, null, 4);
			fs.writeFileSync(rootSpecFile, content, 'utf8');
		}
	}
	
	return rootSpecFile;
}

exports.findASSpecPath = findASSpecPath;
exports.findASSpecPathAsync = findASSpecPathAsync;
exports.findPackageSwiftPath = findPackageSwiftPath;
exports.parsePackageSwift = parsePackageSwift;
exports.extractTargetBlocksFromPackageSwift = extractTargetBlocksFromPackageSwift;
exports.findSubHeaderPath = findSubHeaderPath;
exports.findSubASSpecPath = findSubASSpecPath;
exports.findProjectRoot = findProjectRoot;
exports.getRootSpecFilePath = getRootSpecFilePath;
exports.ROOT_MARKER_NAME = ROOT_MARKER_NAME;