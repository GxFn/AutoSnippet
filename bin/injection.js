#!/usr/bin/env node

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const readline = require('readline');
const findPath = require('./findPath.js');
const { exec } = require('child_process');

// 全局路径
const cache = require('./cache.js');

const importMark = '#import';
const importSwiftMark = 'import';
const headerMark = '// ahead ';

const importReg = /^\#import\s*<\w+\/\w+.h>$/;

function createHeader(headerLine) {
    // 格式：// ahead <Module/Header.h> [relative/path/to/Header.h]
    // 或：// ahead &lt;Module/Header.h&gt; [relative/path/to/Header.h] (转义格式)
    const content = headerLine.split(headerMark)[1].trim();
    
    // 匹配 <Module/Header.h> 或 &lt;Module/Header.h&gt; 以及可选的相对路径
    const match = content.match(/^(?:&lt;|<)(\w+)\/(\w+\.h)(?:&gt;|>)(?:\s+(.+))?$/);
    
    if (!match) {
        // 兼容旧格式：直接解析
        const headerArray = content.split('/');
        const moduleName = headerArray[0].substr(1);
        const headerName = headerArray[1].substr(0, headerArray[1].length - 1);
        
        return {
            name: content,
            specName: headerArray[0] + '/' + headerArray[0].substr(1) + '.h>',
            moduleName: moduleName,
            headerName: headerName,
            moduleStrName: '"' + moduleName + '.h"',
            headerStrName: '"' + headerName + '"',
            headRelativePathFromMark: null,
        };
    }
    
    const moduleName = match[1];
    const headerName = match[2];
    const headRelativePathFromMark = match[3] || null;  // 相对路径（如果有）
    
    return {
        name: `<${moduleName}/${headerName}>`,
        specName: `<${moduleName}/${headerName}>`,
        moduleName: moduleName,
        headerName: headerName,
        moduleStrName: `"${moduleName}.h"`,
        headerStrName: `"${headerName}"`,
        headRelativePathFromMark: headRelativePathFromMark,  // 从标记中提取的相对路径
    };
}

// swift版，相对简单
function handleHeaderLineSwift(specFile, updateFile, headerLine, importArray) {
    const header = headerLine.split(headerMark)[1].trim();

    let isAddedHeader = false;

    for (let i = 0; i < importArray.length; i++) {
		const importHeader = importArray[i].split(importSwiftMark)[1].trim();

		if (importHeader === header) {
			// 已经引入头文件
            readStream(updateFile, null, importSwiftMark);
			checkDependency(updateFile, header, '依赖头文件已存在，不需要额外引入。');
			isAddedHeader = true;
			break;
		}
	}

    if (!isAddedHeader) {
        readStream(updateFile, importSwiftMark + ' ' + header, importSwiftMark);
		checkDependency(updateFile, header, '自动注入头文件完成。');
    }
}

// specFile实际上是获取缓存的key，用来获取Snippet的模块空间信息，没有路径意义
// updateFile是当前修改文件路径，用来获取当前模块空间信息
async function handleHeaderLine(specFile, updateFile, headerLine, importArray, isSwift) {
    if (isSwift) {
        handleHeaderLineSwift(specFile, updateFile, headerLine, importArray);
        return;
    }
	const header = createHeader(headerLine);

	// ✅ 重新设计：区分当前模块内部和外部
	// 1. 获取当前文件所在的模块（通过 Package.swift）
	// 2. 获取头文件所在的模块（从头文件路径查找 Package.swift，确定最近的 target 模块名）
	// 3. 比较模块名：
	//    - 相同模块 -> 使用相对路径 #import "Header.h"
	//    - 不同模块 -> 使用 #import <ModuleName/Header.h>

	// 获取当前文件所在的模块
	const updateFileDir = path.dirname(updateFile);
	const currentPackagePath = await findPath.findPackageSwiftPath(updateFileDir);
	
	if (!currentPackagePath) {
		// 找不到当前模块的 Package.swift，默认使用 <> 格式
		handleModuleHeader(specFile, updateFile, header, importArray, true);
		return;
	}

	const currentPackageInfo = await findPath.parsePackageSwift(currentPackagePath);
	if (!currentPackageInfo) {
		handleModuleHeader(specFile, updateFile, header, importArray, true);
		return;
	}

	// 获取当前文件所在的模块名（通过路径判断）
	const currentModuleName = determineCurrentModuleName(updateFile, currentPackageInfo);

	// ✅ 优先从标记中获取相对路径，如果没有则从缓存获取
	// 标记格式：// ahead <Module/Header.h> relative/path/to/Header.h
	let headRelativePath = header.headRelativePathFromMark;
	if (!headRelativePath) {
		// 标记中没有相对路径，尝试从缓存获取
		const headCache = await cache.getHeadCache(specFile);
		if (headCache && headCache[header.headerName]) {
			headRelativePath = headCache[header.headerName];
		}
	}
	
	const headerInfo = await determineHeaderInfo(specFile, header, headRelativePath, currentPackageInfo, currentModuleName);

	// ✅ 更新 header 中的模块名、相对路径和 specName
	header.moduleName = headerInfo.moduleName;
	header.headRelativePath = headerInfo.headRelativePath;  // 相对于模块根目录的相对路径
	header.specName = '<' + headerInfo.moduleName + '/' + header.headerName + '>';

	// ✅ 优先检查：如果头文件路径和当前文件在同一个目录下，直接使用文件名
	const headRelativePathFromInfo = headerInfo.headRelativePath;
	let isSameDirectory = false;
	let headFullPath = null;
	let headDir = null;
	
	if (headRelativePathFromInfo) {
		// 从头文件相对路径构造完整路径
		// headRelativePathFromInfo 是相对于模块根目录的路径（如 Code/BDGlobalVideoPlayerManager.h）
		
		// 方法：从当前文件路径向上查找，直到找到包含 headRelativePathFromInfo 的路径
		const headName = path.basename(headRelativePathFromInfo);  // BDGlobalVideoPlayerManager.h
		
		// 方案1：尝试在当前文件所在目录直接查找
		const headInCurrentDir = path.join(updateFileDir, headName);
		if (fs.existsSync(headInCurrentDir)) {
			headFullPath = headInCurrentDir;
			headDir = updateFileDir;
		} else {
			// 方案2：从当前文件路径向上查找，尝试找到头文件
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
			
			// 方案3：尝试使用模块路径拼接
			if (!headFullPath) {
				const possiblePaths = [
					path.join(currentPackageInfo.path, headRelativePathFromInfo),  // 当前模块根目录
				];
				
				// 如果当前文件在 Code/ 目录下，尝试向上查找模块根目录
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
			// 检查是否在同一个目录（使用规范化路径比较）
			const normalizedUpdateDir = path.normalize(updateFileDir);
			const normalizedHeadDir = path.normalize(headDir);
			
			if (normalizedUpdateDir === normalizedHeadDir) {
				isSameDirectory = true;
				// 如果同目录，直接使用文件名
				header.relativePathToCurrentFile = header.headerName;
			}
		}
		
		// ✅ 如果能找到头文件完整路径且不同目录，计算相对路径（即使模块名不同）
		if (headFullPath && fs.existsSync(headFullPath) && !isSameDirectory) {
			// 计算从当前文件到头文件的相对路径
			const relativePathToHeader = path.relative(updateFileDir, headDir);
			
			// 如果相对路径为空或为当前目录，使用文件名
			if (!relativePathToHeader || relativePathToHeader === '.') {
				header.relativePathToCurrentFile = header.headerName;
			} else {
				// 拼接相对路径和文件名
				header.relativePathToCurrentFile = path.join(relativePathToHeader, header.headerName).replace(/\\/g, '/');
			}
		}
	}
	
	// ✅ 判断是否为同一模块
	const isSameModule = currentModuleName === headerInfo.moduleName;
	
	// ✅ 决定是否使用相对路径
	// 1. 同目录 -> 使用文件名
	// 2. 同一模块 -> 使用相对路径
	// 3. 能找到完整路径 -> 使用相对路径
	// 4. 其他 -> 使用 <> 格式
	const shouldUseRelativePath = isSameDirectory || isSameModule || (headFullPath && fs.existsSync(headFullPath));

	// 如果同目录或同一模块，使用相对路径；否则使用 <> 格式
	handleModuleHeader(specFile, updateFile, header, importArray, !shouldUseRelativePath);
}

/**
 * 根据文件路径确定当前模块名（SPM）
 */
function determineCurrentModuleName(filePath, packageInfo) {
	const relativePath = path.relative(packageInfo.path, filePath);
	const segments = relativePath.split(path.sep);

	// 查找匹配的 target（最近的 target）
	for (const segment of segments) {
		if (packageInfo.targets.includes(segment)) {
			return segment;
		}
	}

	// 如果找不到，使用第一个 target
	return packageInfo.targets[0] || packageInfo.name;
}

/**
 * 确定头文件信息（模块名、相对路径等）
 * 从头文件路径查找 Package.swift，确定最近的 target 模块名
 * 同时计算相对于当前文件的相对路径
 * @param {string} specFile - 配置文件路径
 * @param {object} header - 头文件信息对象
 * @param {string} headRelativePath - 头文件相对路径（相对于模块根目录），可能来自标记或缓存
 * @param {object} currentPackageInfo - 当前文件的 Package.swift 信息
 * @param {string} currentModuleName - 当前模块名
 */
async function determineHeaderInfo(specFile, header, headRelativePath, currentPackageInfo, currentModuleName) {
	// 默认值
	let moduleName = header.moduleName;
	let relativePathToCurrentFile = null;

	if (!headRelativePath) {
		// 没有相对路径，使用从 headerLine 解析的模块名（可能不准确）
		return {
			moduleName: moduleName,
			headRelativePath: null,
			relativePathToCurrentFile: null
		};
	}

	// ✅ specFile 可能是根目录的 AutoSnippetRoot.boxspec.json，需要找到头文件所在的模块配置
	// 尝试从根目录的配置文件查找头文件所在的模块
	const rootSpecDir = path.dirname(specFile);
	let headPath = null;
	
	// 尝试多种可能的路径
	// 1. 直接使用根目录的相对路径
	headPath = path.join(rootSpecDir, headRelativePath);
	
	// 2. 如果文件不存在，尝试从子模块中查找
	if (!fs.existsSync(headPath)) {
		// 从头文件路径向上查找 Package.swift
		const headerPackagePath = await findPath.findPackageSwiftPath(headPath);
		if (headerPackagePath) {
			const headerPackageInfo = await findPath.parsePackageSwift(headerPackagePath);
			if (headerPackageInfo) {
				// 找到 Package.swift，使用它的路径作为模块根目录
				const headerModuleRootDir = path.dirname(headerPackagePath);
				headPath = path.join(headerModuleRootDir, headRelativePath);
			}
		}
	}

	// 从头文件路径向上查找 Package.swift
	const headerPackagePath = await findPath.findPackageSwiftPath(headPath);
	if (!headerPackagePath) {
		// 找不到 Package.swift，使用从 headerLine 解析的模块名
		return {
			moduleName: moduleName,
			headRelativePath: headRelativePath,
			relativePathToCurrentFile: null
		};
	}

	// 解析 Package.swift 获取模块信息
	const headerPackageInfo = await findPath.parsePackageSwift(headerPackagePath);
	if (!headerPackageInfo) {
		return {
			moduleName: moduleName,
			headRelativePath: headRelativePath,
			relativePathToCurrentFile: null
		};
	}

	// ✅ 根据头文件路径确定最近的 target 模块名
	moduleName = determineCurrentModuleName(headPath, headerPackageInfo);

	// ✅ 如果是同一模块，计算相对于当前文件的相对路径
	// 注意：这里需要知道当前文件的路径，所以需要从外部传入
	// 但当前函数中还没有 updateFile，所以这部分逻辑在 handleHeaderLine 中完成

	return {
		moduleName: moduleName,
		headRelativePath: headRelativePath,
		relativePathToCurrentFile: null  // 将在 handleHeaderLine 中计算
	};
}

// isOuter区分模块内部引用""格式和模块外部引用<>格式
// ✅ SPM 模块：
//    - isOuter = false：同一模块内部，使用相对路径 #import "relative/path/Header.h" 或 #import "Header.h"
//    - isOuter = true：不同模块之间，使用 #import <ModuleName/Header.h>
function handleModuleHeader(specFile, updateFile, header, importArray, isOuter) {
	// ✅ 重新读取文件内容，获取最新的 import 列表（避免使用过时的 importArray）
	let currentImportArray = importArray;
	try {
		const fileContent = fs.readFileSync(updateFile, 'utf8');
		const lineArray = fileContent.split('\n');
		// ✅ 匹配 #import <> 和 #import "" 两种格式
		const importReg = /^\#import\s*(<.+>|".+")$/;
		currentImportArray = [];
		
		lineArray.forEach(element => {
			const lineVal = element.trim();
			if (importReg.test(lineVal)) {
				currentImportArray.push(lineVal);
			}
		});
		
	} catch (err) {
		console.error(`❌ 读取文件失败: ${updateFile}`, err.message);
		// 如果读取失败，使用传入的 importArray
		currentImportArray = importArray;
	}
	
	// ✅ 根据 isOuter 选择不同的引入格式，用于检查是否已存在
	let headNameToCheck;
	if (isOuter) {
		// 外部模块，使用 <> 格式
		headNameToCheck = header.name;  // <ModuleName/Header.h>
	} else {
		// 同一模块内部，使用相对路径
		if (header.relativePathToCurrentFile) {
			headNameToCheck = '"' + header.relativePathToCurrentFile + '"';  // "relative/path/Header.h"
		} else {
			headNameToCheck = header.headerStrName;  // "Header.h"
		}
	}
	const moduleName = isOuter ? header.specName : header.moduleStrName;

	// ✅ 检查是否已经引入头文件（精确匹配）
	for (let i = 0; i < currentImportArray.length; i++) {
		const importHeader = currentImportArray[i].split(importMark)[1].trim();

		if (importHeader === headNameToCheck) {
			// 已经引入头文件（完全相同的格式）
			handelAddHeaderStatus(specFile, updateFile, header, true, false, isOuter);
			return;
		} else if (importHeader === moduleName) {
			// 已经引入模块头文件（如 <ModuleName/ModuleName.h>）
			handelAddHeaderStatus(specFile, updateFile, header, false, true, isOuter);
			return;
		}
	}

	// ✅ 额外检查：通过头文件名判断是否为同一头文件（不同格式也算相同）
	const headerFileName = header.headerName;  // BDGlobalVideoPlayerManager.h
	const headerFileNameLower = headerFileName.toLowerCase();
	
	for (let i = 0; i < currentImportArray.length; i++) {
		const importHeader = currentImportArray[i].split(importMark)[1].trim();
		
		// 提取导入的头文件名（可能包含路径）
		let importedFileName = null;
		
		// 处理 <> 格式：<ModuleName/Header.h>
		const angleMatch = importHeader.match(/<([^>]+)>/);
		if (angleMatch) {
			const content = angleMatch[1];
			importedFileName = path.basename(content).toLowerCase();
		}
		
		// 处理 "" 格式："Header.h" 或 "relative/path/Header.h"
		const quoteMatch = importHeader.match(/"([^"]+)"/);
		if (quoteMatch) {
			const content = quoteMatch[1];
			importedFileName = path.basename(content).toLowerCase();
		}
		
		// 如果没有引号，可能是直接的 Header.h 格式（理论上不应该出现）
		if (!importedFileName && !importHeader.includes('<') && !importHeader.includes('"')) {
			importedFileName = path.basename(importHeader).toLowerCase();
		}
		
		// 如果导入的头文件名与要插入的头文件名相同，说明已经引用了同一头文件
		if (importedFileName && importedFileName === headerFileNameLower) {
			handelAddHeaderStatus(specFile, updateFile, header, true, false, isOuter);
			return;
		}
	}

	// 没有找到已引入的头文件，直接添加
	// addHeaderToFile 会根据 isOuter 使用不同的格式
	addHeaderToFile(updateFile, header, isOuter);
}

function handelAddHeaderStatus(specFile, updateFile, header, isAddedHeader, isAddedSpecHeader, isOuter) {
	if (isAddedHeader) {
		// 已经引入头文件
		removeMarkFromFile(updateFile, header, '依赖头文件已存在，不需要额外引入。');
	} else if (isAddedSpecHeader) {
		// 已经引入spec头文件
		isAddedToSpecHeader(specFile, header, function (isSpecEnough) {
			if (isSpecEnough) {
				// spec header足够了，不需要添加头文件
				removeMarkFromFile(updateFile, header, '依赖模块头文件已存在，不需要额外引入。');
			} else {
				// 使用传入的 isOuter 参数
				addHeaderToFile(updateFile, header, isOuter);
			}
		});
	} else {
		// 都没找到，添加头文件
		// 使用传入的 isOuter 参数
		addHeaderToFile(updateFile, header, isOuter);
	}
}

function isAddedToSpecHeader(specFile, header, callback) {
	cache.getHeadCache(specFile).then(function (headCache) {
		if (headCache) {
			// ✅ SPM 模块：headName 已经是相对于模块根目录的相对路径
			// specFile 位于模块根目录（如 ModuleRoot/AutoSnippet.boxspec.json）
			const moduleRootDir = path.dirname(specFile);
			const headRelativePath = headCache[header.headerName];
			
			if (!headRelativePath) {
				callback(false);
				return;
			}
			
			// 拼接头文件的完整路径
			const headPath = path.join(moduleRootDir, headRelativePath);

			try {
				// 读取当前头文件所在工作空间里默认暴露的头文件
				const data = fs.readFileSync(headPath, 'utf8');
				const lineArray = data.split('\n');

				let isSpecEnough = false;

				lineArray.forEach(element => {
					const lineVal = element.trim();

					if (importReg.test(lineVal)) {
						const importHeader = lineVal.split(importMark)[1].trim();

                        // 此处只判断<>格式的头文件，空间默认头文件不应该包含""格式的头文件
						if (importHeader === header.name) {
							isSpecEnough = true;
						}
					}
				});

				callback(isSpecEnough);
			} catch (err) {
				console.error(err);
			}
		}
	});
}

function removeMarkFromFile(updateFile, header, string) {
	readStream(updateFile, null, importMark);
	checkDependency(updateFile, header.moduleName, string).catch(err => {
		console.error('Error checking dependency:', err);
	});
}

function addHeaderToFile(updateFile, header, isOuter) {
	// ✅ 根据 isOuter 选择不同的引入格式
	// isOuter = true: 使用 <> 格式（#import <ModuleName/Header.h>）
	// isOuter = false: 使用相对路径（#import "relative/path/Header.h" 或 #import "Header.h"）
	let importLine;
	if (isOuter) {
		// 外部模块，使用 <> 格式
		importLine = importMark + ' ' + header.name;  // <ModuleName/Header.h>
	} else {
		// 同一模块内部，使用相对路径
		if (header.relativePathToCurrentFile) {
			// 使用计算出的相对路径（如 "SubDir/Header.h" 或 "../Header.h"）
			importLine = importMark + ' "' + header.relativePathToCurrentFile + '"';
		} else {
			// 如果没有相对路径，使用文件名（如 "Header.h"）
			importLine = importMark + ' ' + header.headerStrName;  // "Header.h"
		}
	}
	
	readStream(updateFile, importLine, importMark);
	checkDependency(updateFile, header.moduleName, '自动注入头文件完成。').catch(err => {
		console.error('Error checking dependency:', err);
	});
}

async function checkDependency(updateFile, moduleName, string) {
	const slashIndex = updateFile.lastIndexOf('/');
	const thePath = updateFile.substring(0, slashIndex + 1);

	try {
		// ✅ 使用 SPM 的 Package.swift 查找（替代 .boxspec）
		const packagePath = await findPath.findPackageSwiftPath(thePath);
		if (!packagePath) {
			displayNotification(string);
			return;
		}

		// 解析 Package.swift 获取模块信息
		const packageInfo = await findPath.parsePackageSwift(packagePath);
		if (!packageInfo) {
			displayNotification(string);
			return;
		}

		// 检查依赖关系（在 Package.swift 的 dependencies 中查找）
		const packageContent = await fs.promises.readFile(packagePath, 'utf8');
		
		// 检查是否在 dependencies 中
		const dependencyPattern = new RegExp(`\\.package\\([^)]*"([^"]*${moduleName}[^"]*)"`, 'g');
		const targetDependencyPattern = new RegExp(`\\.product\\([^)]*name:\\s*"([^"]*${moduleName}[^"]*)"`, 'g');
		
		const hasDependency = dependencyPattern.test(packageContent) || 
		                      targetDependencyPattern.test(packageContent) ||
		                      packageInfo.targets.includes(moduleName);

		if (hasDependency) {
			displayNotification(string);
		} else {
			displayNotification(string + '\nPackage.swift 未发现依赖项，请检查模块是否引入。');
		}
	} catch (err) {
		console.error(err);
		displayNotification(string);
	}
}

function readStream(filePath, headerName, currImportMark) {
	const rl = readline.createInterface({
		input: fs.createReadStream(filePath),
		crlfDelay: Infinity
	});

	let lineIndex = 0;
	let lineCount = 0;
	let markCount = 0;

	rl.on('line', function (line) {
		lineIndex++;

		if (line.trim().startsWith(currImportMark)) {
			lineCount = lineIndex;
		}
		if (line.trim().startsWith(headerMark)) {
			markCount = lineIndex - 1;
		}
	});

	rl.on('close', function () {
		try {
			const data = fs.readFileSync(filePath, 'utf8');
			const lineArray = data.split('\n');

			if (headerName) {
				if (markCount !== 0) {
					lineArray.splice(markCount, 1);
					if (markCount < lineCount) {
						lineCount = lineCount - 1;
					}
				}
				lineArray.splice(lineCount, 0, headerName);
			} else {
				if (markCount !== 0) {
					lineArray.splice(markCount, 1);
				}
			}

			fs.writeFileSync(filePath, lineArray.join('\n'), 'utf8');
		} catch (err) {
			console.error(err);
		}
	});
}

function displayNotification(notification) {
	const script = `display notification "${notification}" with title "" subtitle ""`;
	const command = `osascript  -e '${script}'`;

	exec(command, (err, stdout, stderr) => {
		if (err) {
			console.log(err);
			return;
		}
	});
}

exports.handleHeaderLine = handleHeaderLine;