#!/usr/bin/env node

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
		const targetsMatch = content.match(/\.target\s*\([^)]+name:\s*"([^"]+)"/g);
		
		const packageName = packageNameMatch ? packageNameMatch[1] : null;
		const targets = [];
		
		if (targetsMatch) {
			targetsMatch.forEach(match => {
				const targetMatch = match.match(/name:\s*"([^"]+)"/);
				if (targetMatch) {
					targets.push(targetMatch[1]);
				}
			});
		}
		
		return {
			name: packageName,
			targets: targets,
			path: path.dirname(packagePath)
		};
	} catch (err) {
		return null;
	}
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
exports.findSubHeaderPath = findSubHeaderPath;
exports.findSubASSpecPath = findSubASSpecPath;
exports.findProjectRoot = findProjectRoot;
exports.getRootSpecFilePath = getRootSpecFilePath;
exports.ROOT_MARKER_NAME = ROOT_MARKER_NAME;