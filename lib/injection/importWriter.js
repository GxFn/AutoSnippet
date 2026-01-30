#!/usr/bin/env node

/**
 * 职责：
 * - 负责把 import/#import 写入文件（并移除指令标记行）
 * - 负责判断“是否已引入同一头文件/模块头文件”，决定是否需要补充
 * - 负责通知提示（macOS osascript）
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const packageParser = require('../spm/packageParser.js');
const cacheStore = require('../infra/cacheStore.js');
const notifier = require('../infra/notifier.js');
const directiveParser = require('./directiveParser.js');

const importMark = '#import';
const importSwiftMark = 'import';
// ObjC 头文件名常见包含 `+`（Category）、`-`、`.` 等字符
const importReg = /^\#import\s*<[A-Za-z0-9_]+\/[A-Za-z0-9_+.-]+\.h>$/;

function handleModuleHeader(specFile, updateFile, header, importArray, isOuter) {
	let currentImportArray = importArray;
	try {
		const fileContent = fs.readFileSync(updateFile, 'utf8');
		const lineArray = fileContent.split('\n');
		const currImportReg = /^\#import\s*(<.+>|".+")$/;
		currentImportArray = [];

		lineArray.forEach(element => {
			const lineVal = element.trim();
			if (currImportReg.test(lineVal)) {
				currentImportArray.push(lineVal);
			}
		});
	} catch (err) {
		console.error(`❌ 读取文件失败: ${updateFile}`, err.message);
		currentImportArray = importArray;
	}

	let headNameToCheck;
	if (isOuter) {
		headNameToCheck = header.name;  // <ModuleName/Header.h>
	} else {
		if (header.relativePathToCurrentFile) {
			headNameToCheck = '"' + header.relativePathToCurrentFile + '"';
		} else {
			headNameToCheck = header.headerStrName;
		}
	}
	const moduleName = isOuter ? header.specName : header.moduleStrName;

	for (let i = 0; i < currentImportArray.length; i++) {
		const importHeader = currentImportArray[i].split(importMark)[1].trim();
		if (importHeader === headNameToCheck) {
			handelAddHeaderStatus(specFile, updateFile, header, true, false, isOuter);
			return;
		} else if (importHeader === moduleName) {
			handelAddHeaderStatus(specFile, updateFile, header, false, true, isOuter);
			return;
		}
	}

	const headerFileNameLower = String(header.headerName || '').toLowerCase();
	for (let i = 0; i < currentImportArray.length; i++) {
		const importHeader = currentImportArray[i].split(importMark)[1].trim();
		let importedFileName = null;

		const angleMatch = importHeader.match(/<([^>]+)>/);
		if (angleMatch) {
			importedFileName = path.basename(angleMatch[1]).toLowerCase();
		}

		const quoteMatch = importHeader.match(/"([^"]+)"/);
		if (quoteMatch) {
			importedFileName = path.basename(quoteMatch[1]).toLowerCase();
		}

		if (!importedFileName && !importHeader.includes('<') && !importHeader.includes('"')) {
			importedFileName = path.basename(importHeader).toLowerCase();
		}

		if (importedFileName && importedFileName === headerFileNameLower) {
			handelAddHeaderStatus(specFile, updateFile, header, true, false, isOuter);
			return;
		}
	}

	addHeaderToFile(updateFile, header, isOuter);
}

function handelAddHeaderStatus(specFile, updateFile, header, isAddedHeader, isAddedSpecHeader, isOuter) {
	if (isAddedHeader) {
		removeMarkFromFile(updateFile, header, '依赖头文件已存在，不需要额外引入。');
	} else if (isAddedSpecHeader) {
		isAddedToSpecHeader(specFile, header, function (isSpecEnough) {
			if (isSpecEnough) {
				removeMarkFromFile(updateFile, header, '依赖模块头文件已存在，不需要额外引入。');
			} else {
				addHeaderToFile(updateFile, header, isOuter);
			}
		});
	} else {
		addHeaderToFile(updateFile, header, isOuter);
	}
}

function isAddedToSpecHeader(specFile, header, callback) {
	cacheStore.getHeadCache(specFile).then(function (headCache) {
		if (headCache) {
			const moduleRootDir = path.dirname(specFile);
			const headRelativePath = headCache[header.headerName];

			if (!headRelativePath) {
				callback(false);
				return;
			}

			const headPath = path.join(moduleRootDir, headRelativePath);
			try {
				const data = fs.readFileSync(headPath, 'utf8');
				const lineArray = data.split('\n');
				let isSpecEnough = false;

				lineArray.forEach(element => {
					const lineVal = element.trim();
					if (importReg.test(lineVal)) {
						const importHeader = lineVal.split(importMark)[1].trim();
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
	let importLine;
	if (isOuter) {
		importLine = importMark + ' ' + header.name;
	} else {
		if (header.relativePathToCurrentFile) {
			importLine = importMark + ' "' + header.relativePathToCurrentFile + '"';
		} else {
			importLine = importMark + ' ' + header.headerStrName;
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
		const packagePath = await packageParser.findPackageSwiftPath(thePath);
		if (!packagePath) {
			displayNotification(string);
			return;
		}

		const packageInfo = await packageParser.parsePackageSwift(packagePath);
		if (!packageInfo) {
			displayNotification(string);
			return;
		}

		const packageContent = await fs.promises.readFile(packagePath, 'utf8');
		const dependencyPattern = new RegExp(`\\.package\\([^)]*"([^"]*${moduleName}[^"]*)"`, 'g');
		const targetDependencyPattern = new RegExp(`\\.product\\([^)]*name:\\s*"([^"]*${moduleName}[^"]*)"`, 'g');

		const hasDependency = dependencyPattern.test(packageContent)
			|| targetDependencyPattern.test(packageContent)
			|| packageInfo.targets.includes(moduleName);

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
		const t = line.trim();

		if (t.startsWith(currImportMark)) {
			lineCount = lineIndex;
		}
		if (directiveParser.isDirectiveMarkLine(t)) {
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
	notifier.notify(notification);
}

function removeMarkFromFileSwift(updateFile, moduleName, message) {
	readStream(updateFile, null, importSwiftMark);
	checkDependency(updateFile, moduleName, message).catch(() => {});
}

function addImportToFileSwift(updateFile, moduleName, message) {
	readStream(updateFile, importSwiftMark + ' ' + moduleName, importSwiftMark);
	checkDependency(updateFile, moduleName, message).catch(() => {});
}

module.exports = {
	handleModuleHeader,
	removeMarkFromFile,
	addHeaderToFile,
	readStream,
	checkDependency,
	displayNotification,
	removeMarkFromFileSwift,
	addImportToFileSwift,
};

