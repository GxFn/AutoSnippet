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
const fileFinder = require('../lib/infra/FileFinder');
const defaults = require('../lib/infra/defaults');

const HOLDER_NAME = 'AutoSnippet.boxspec.json';
const ROOT_MARKER_NAME = defaults.ROOT_SPEC_FILENAME;
const PACKAGE_SWIFT = 'Package.swift';
const README_NAME = defaults.README_NAMES[defaults.README_NAMES.length - 1]; // readme.md

// 检查是否为项目根目录
async function isProjectRoot(dirPath) {
	const entries = await fileFinder.getDirectoryEntries(dirPath);
	if (!entries) return false;
	
	const rootMarkers = [
		'.git',
		PACKAGE_SWIFT,
		'.xcodeproj',
		'.xcworkspace',
		'Podfile',
		'.swiftpm',
	];
	
	return entries.some(entry => rootMarkers.includes(entry.name));
}

async function searchUpwardForFile(filePath, fileName) {
	return await fileFinder.findUp(filePath, fileName);
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
	return await fileFinder.findUp(filePath, PACKAGE_SWIFT);
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
	// 优先在 include/moduleName 下查找（快速路径）
	if (moduleName) {
		const includePath = path.join(filePath, 'include', moduleName);
		try {
			const headerPath = path.join(includePath, `${headerName}.h`);
			await fs.promises.access(headerPath);
			return headerPath;
		} catch {}
	}
	
	// 通用查找
	return await fileFinder.findDown(filePath, (entry) => {
		return entry.isFile() && entry.name === `${headerName}.h`;
	}, { maxDepth: 10, firstMatch: true });
}

/**
 * 从文件路径确定 target 的根目录（包含 Code 或 Sources 的目录）
 * @param {string} filePath - 文件路径
 * @returns {Promise<string|null>} target 根目录路径，如果找不到返回 null
 */
async function findTargetRootDir(filePath) {
	let currentPath = path.dirname(path.resolve(filePath));
	const maxLevels = 10;
	let levelsChecked = 0;

	while (currentPath && levelsChecked < maxLevels) {
		try {
			const entries = await fileFinder.getDirectoryEntries(currentPath);
			for (const entry of entries) {
				if (entry.isDirectory() && (entry.name === 'Code' || entry.name === 'Sources')) {
					return currentPath;
				}
			}
			const parentPath = path.dirname(currentPath);
			if (parentPath === currentPath) break;
			currentPath = parentPath;
			levelsChecked++;
		} catch (err) {
			if (err.code === 'ENOENT' || err.code === 'EACCES') break;
			throw err;
		}
	}
	return null;
}

async function findSubASSpecPath(filePath) {
	return await fileFinder.findDown(filePath, HOLDER_NAME, { maxDepth: 15, firstMatch: false });
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
	// 先检查起始目录本身是否含根标记（避免 cwd 与异步查找的边界情况）
	const markerInStart = path.join(startPath, ROOT_MARKER_NAME);
	try {
		await fs.promises.access(markerInStart);
		return startPath;
	} catch (_) {}
	const rootMarkerPath = await searchUpwardForFile(startPath, ROOT_MARKER_NAME);
	return rootMarkerPath ? path.dirname(rootMarkerPath) : null;
}

function findProjectRootSync(filePath) {
	let currentPath = path.resolve(filePath);
	
	try {
		const stats = fs.statSync(currentPath);
		if (stats.isFile()) {
			currentPath = path.dirname(currentPath);
		}
	} catch (err) {}

	const maxLevels = 20;
	let levels = 0;
	while (levels < maxLevels) {
		const markerPath = path.join(currentPath, ROOT_MARKER_NAME);
		if (fs.existsSync(markerPath)) {
			return currentPath;
		}
		const parentPath = path.dirname(currentPath);
		if (parentPath === currentPath) break;
		currentPath = parentPath;
		levels++;
	}
	return null;
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
				recipes: {
					dir: 'Knowledge/recipes',
					format: 'md+frontmatter',
					index: 'Knowledge/recipes/index.json',
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
exports.findTargetRootDir = findTargetRootDir;
exports.findSubASSpecPath = findSubASSpecPath;
exports.findProjectRoot = findProjectRoot;
exports.findProjectRootSync = findProjectRootSync;
exports.getRootSpecFilePath = getRootSpecFilePath;
exports.ROOT_MARKER_NAME = ROOT_MARKER_NAME;