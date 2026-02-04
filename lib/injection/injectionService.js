#!/usr/bin/env node

/**
 * 职责：
 * - 头文件注入主入口（handleHeaderLine）
 * - 串联：directive 解析 → module 推断 → SPM 依赖补齐（deps.ensureDependency）→ import 写入
 */

const fs = require('fs');
const path = require('path');

const compat = require('../context/ContextServiceCompat.js');
const cacheStore = require('../infrastructure/cache/CacheStore.js');
const notifier = require('../infrastructure/notification/Notifier.js');

// 获取 V2 服务的辅助函数
function getPackageParser(projectRoot) {
	return compat.getPackageParserInstance(projectRoot);
}

function getSpmDepsService(projectRoot) {
	return compat.getSpmDepsServiceInstance(projectRoot);
}

function getDirectiveParser() {
	return compat.getDirectiveParserInstance();
}

function getModuleResolver(projectRoot) {
	return compat.getModuleResolverInstance(projectRoot);
}

function getImportWriter(projectRoot) {
	return compat.getImportWriterInstance(projectRoot);
}

// 从 specFile 推断 projectRoot
function getProjectRoot(specFile) {
	// AutoSnippet.boxspec.json 所在目录（知识库目录）
	const dir = path.dirname(specFile);
	return dir;
}

// 避免 watch 反复保存导致弹窗刷屏
const shownPolicyAlerts = new Set();

function maybeAlertPolicyBlocked(fromModule, toModule, ensureResult) {
	try {
		const reason = ensureResult && ensureResult.reason ? String(ensureResult.reason) : '';
		if (reason !== 'cycleBlocked') return;
		const key = `${fromModule}=>${toModule}`;
		if (shownPolicyAlerts.has(key)) return;
		shownPolicyAlerts.add(key);

		const extra = ensureResult && ensureResult.suggestion ? `\n\n${String(ensureResult.suggestion)}` : '';
		notifier.alert(
			`已阻止依赖注入（形成反向引入/循环）\n\n${fromModule} -> ${toModule}${extra}`,
			{ title: 'AutoSnippet SPM 依赖策略', givingUpAfterSeconds: 12 }
		);
	} catch {
		// ignore
	}
}

async function handleHeaderLine(specFile, updateFile, headerLine, importArray, isSwift) {
	if (isSwift) {
		await handleHeaderLineSwift(specFile, updateFile, headerLine, importArray);
		return;
	}

	const projectRoot = getProjectRoot(specFile);
	const packageParser = getPackageParser(projectRoot);
	const directiveParser = getDirectiveParser();
	const moduleResolver = getModuleResolver(projectRoot);
	const importWriter = getImportWriter(projectRoot);
	
	const header = directiveParser.createHeader(headerLine);
	if (!header) return;

	const updateFileDir = path.dirname(updateFile);
	const currentPackagePath = await packageParser.findPackageSwiftPath(updateFileDir);

	if (!currentPackagePath) {
		await importWriter.handleModuleHeader(specFile, updateFile, header, importArray, true);
		return;
	}

	const currentPackageInfo = await packageParser.parsePackageSwift(currentPackagePath);
	if (!currentPackageInfo) {
		await importWriter.handleModuleHeader(specFile, updateFile, header, importArray, true);
		return;
	}

	const currentModuleName = moduleResolver.determineCurrentModule(updateFile, currentPackageInfo);

	let headRelativePath = header.headRelativePathFromMark;
	if (!headRelativePath) {
		const headCache = await cacheStore.getHeadCache(specFile);
		if (headCache && headCache[header.headerName]) {
			headRelativePath = headCache[header.headerName];
		}
	}

	const headerInfo = await moduleResolver.determineHeaderInfo(specFile, header, headRelativePath);

	header.moduleName = headerInfo.moduleName;
	header.headRelativePath = headerInfo.headRelativePath;
	header.specName = '<' + headerInfo.moduleName + '/' + header.headerName + '>';

	const headRelativePathFromInfo = headerInfo.headRelativePath;
	let isSameDirectory = false;
	let headFullPath = null;
	let headDir = null;

	if (headRelativePathFromInfo) {
		const headName = path.basename(headRelativePathFromInfo);
		const headInCurrentDir = path.join(updateFileDir, headName);
		if (fs.existsSync(headInCurrentDir)) {
			headFullPath = headInCurrentDir;
			headDir = updateFileDir;
		} else {
			let searchDir = updateFileDir;
			for (let i = 0; i < 5 && searchDir !== path.dirname(searchDir); i++) {
				const possiblePath = path.join(searchDir, headRelativePathFromInfo);
				if (fs.existsSync(possiblePath)) {
					headFullPath = possiblePath;
					headDir = path.dirname(possiblePath);
					break;
				}
				searchDir = path.dirname(searchDir);
			}

			if (!headFullPath) {
				const possiblePaths = [
					path.join(currentPackageInfo.path, headRelativePathFromInfo),
				];

				if (updateFileDir.endsWith('Code')) {
					const possibleModuleRoot = path.dirname(updateFileDir);
					possiblePaths.push(path.join(possibleModuleRoot, headRelativePathFromInfo));
				}

				for (const possiblePath of possiblePaths) {
					if (fs.existsSync(possiblePath)) {
						headFullPath = possiblePath;
						headDir = path.dirname(possiblePath);
						break;
					}
				}
			}
		}

		if (headDir) {
			const normalizedUpdateDir = path.normalize(updateFileDir);
			const normalizedHeadDir = path.normalize(headDir);
			if (normalizedUpdateDir === normalizedHeadDir) {
				isSameDirectory = true;
				header.relativePathToCurrentFile = header.headerName;
			}
		}

		if (headFullPath && fs.existsSync(headFullPath) && !isSameDirectory) {
			const relativePathToHeader = path.relative(updateFileDir, headDir);
			if (!relativePathToHeader || relativePathToHeader === '.') {
				header.relativePathToCurrentFile = header.headerName;
			} else {
				header.relativePathToCurrentFile = path.join(relativePathToHeader, header.headerName).replace(/\\/g, '/');
			}
		}
	}

	const isSameModule = currentModuleName === headerInfo.moduleName;
	if (!isSameModule && currentPackagePath) {
		const deps = getSpmDepsService(projectRoot);
		const ensureResult = await deps.ensureDependency(specFile, currentPackagePath, currentModuleName, headerInfo.moduleName);
		if (!ensureResult.ok) {
			const mode = ensureResult.mode || 'off';
			const reason = ensureResult.reason ? ` reason=${ensureResult.reason}` : '';
			const fileHint = ensureResult.file ? ` file=${ensureResult.file}` : '';
			console.warn(`⚠️  [AutoSnippet][SPM] 依赖缺失：${currentModuleName} -> ${headerInfo.moduleName} (mode=${mode}${reason}${fileHint})`);
			if (ensureResult.suggestion) console.warn(ensureResult.suggestion);
			if (ensureResult.error) console.warn(`error: ${ensureResult.error}`);

			// policy=block：提前拦截，禁止写入头文件/import
			if (ensureResult.reason === 'cycleBlocked') {
				maybeAlertPolicyBlocked(currentModuleName, headerInfo.moduleName, ensureResult);
				return;
			}
		} else if (ensureResult.changed) {
			console.log(`✅ [AutoSnippet][SPM] 已自动补齐依赖：${currentModuleName} -> ${headerInfo.moduleName}`);
			if (ensureResult.changes && Array.isArray(ensureResult.changes) && ensureResult.changes.length) {
				ensureResult.changes.forEach((c) => {
					if (!c) return;
					if (c.type === 'targetDependency') {
						console.log(`   - [target] ${c.fromTarget} -> ${c.toTarget} (${c.file})`);
					} else if (c.type === 'packageDependency') {
						const ref = c.packageRef && c.packageRef.kind === 'url'
							? `url=${c.packageRef.url}`
							: (c.packageRef && c.packageRef.path ? `path=${c.packageRef.path}` : '');
						console.log(`   - [package] ${c.packageName} ${ref} (${c.file})`);
					} else if (c.type === 'productDependency') {
						console.log(`   - [product] ${c.fromTarget} -> ${c.productName}@${c.packageName} (${c.file})`);
					}
				});
			}
		}
	}

	const shouldUseRelativePath = isSameDirectory || isSameModule || (headFullPath && fs.existsSync(headFullPath));
	await importWriter.handleModuleHeader(specFile, updateFile, header, importArray, !shouldUseRelativePath);
}

async function handleHeaderLineSwift(specFile, updateFile, headerLine, importArray) {
	const projectRoot = getProjectRoot(specFile);
	const packageParser = getPackageParser(projectRoot);
	const deps = getSpmDepsService(projectRoot);
	const directiveParser = getDirectiveParser();
	const moduleResolver = getModuleResolver(projectRoot);
	const importWriter = getImportWriter(projectRoot);
	
	const parsed = directiveParser.parse(headerLine);
	const moduleName = (parsed && parsed.content) ? parsed.content : '';
	if (!moduleName) return;

	// Swift import 同样需要 target 依赖；尽量与 ObjC 路径一致：跨 module 时补齐 SPM 依赖
	try {
		const updateFileDir = path.dirname(updateFile);
		const currentPackagePath = await packageParser.findPackageSwiftPath(updateFileDir);
		if (currentPackagePath) {
			const currentPackageInfo = await packageParser.parsePackageSwift(currentPackagePath);
			if (currentPackageInfo) {
				const currentModuleName = moduleResolver.determineCurrentModule(updateFile, currentPackageInfo);
				if (currentModuleName && currentModuleName !== moduleName) {
					const ensureResult = await deps.ensureDependency(specFile, currentPackagePath, currentModuleName, moduleName);
					if (!ensureResult.ok) {
						const mode = ensureResult.mode || 'off';
						const reason = ensureResult.reason ? ` reason=${ensureResult.reason}` : '';
						const fileHint = ensureResult.file ? ` file=${ensureResult.file}` : '';
						console.warn(`⚠️  [AutoSnippet][SPM] 依赖缺失：${currentModuleName} -> ${moduleName} (mode=${mode}${reason}${fileHint})`);
						if (ensureResult.suggestion) console.warn(ensureResult.suggestion);
						if (ensureResult.error) console.warn(`error: ${ensureResult.error}`);

						// policy=block：提前拦截，禁止写入 import
						if (ensureResult.reason === 'cycleBlocked') {
							maybeAlertPolicyBlocked(currentModuleName, moduleName, ensureResult);
							return;
						}
					} else if (ensureResult.changed) {
						console.log(`✅ [AutoSnippet][SPM] 已自动补齐依赖：${currentModuleName} -> ${moduleName}`);
						if (ensureResult.changes && Array.isArray(ensureResult.changes) && ensureResult.changes.length) {
							ensureResult.changes.forEach((c) => {
								if (!c) return;
								if (c.type === 'targetDependency') {
									console.log(`   - [target] ${c.fromTarget} -> ${c.toTarget} (${c.file})`);
								} else if (c.type === 'packageDependency') {
									const ref = c.packageRef && c.packageRef.kind === 'url'
										? `url=${c.packageRef.url}`
										: (c.packageRef && c.packageRef.path ? `path=${c.packageRef.path}` : '');
									console.log(`   - [package] ${c.packageName} ${ref} (${c.file})`);
								} else if (c.type === 'productDependency') {
									console.log(`   - [product] ${c.fromTarget} -> ${c.productName}@${c.packageName} (${c.file})`);
								}
							});
						}
					}
				}
			}
		}
	} catch {
		// ignore - 依赖补齐失败不应阻断 import 注入
	}

	let isAddedHeader = false;
	for (let i = 0; i < importArray.length; i++) {
		const importHeader = importArray[i].split('import')[1].trim();
		if (importHeader === moduleName) {
			await importWriter.removeMarkFromFileSwift(updateFile, moduleName, '依赖模块已存在，不需要额外 import。');
			isAddedHeader = true;
			break;
		}
	}

	if (!isAddedHeader) {
		await importWriter.addImportToFileSwift(updateFile, moduleName, '自动注入 import 完成。');
	}
}

module.exports = {
	handleHeaderLine,
	handleHeaderLineSwift,
};

exports.handleHeaderLine = handleHeaderLine;

