#!/usr/bin/env node

const fs = require('fs');
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
    const header = headerLine.split(headerMark)[1].trim();
    const headerArray = header.split('/');
    const moduleName = headerArray[0].substr(1);
    const headerName = headerArray[1].substr(0, headerArray[1].length - 1);

    return {
        name: header,
        specName: headerArray[0] + '/' + headerArray[0].substr(1) + '.h>',
        moduleName: moduleName,
        headerName: headerName,
        moduleStrName: '"' + moduleName + '.h"',
        headerStrName: '"' + headerName + '"',
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
function handleHeaderLine(specFile, updateFile, headerLine, importArray, isSwift) {
    if (isSwift) {
        handleHeaderLineSwift(specFile, updateFile, headerLine, importArray);
        return;
    }
	const header = createHeader(headerLine);

	// 首先识别是否是组件内部修改，默认头文件间接等于模块名
	cache.getHeadCache(specFile).then(function (headCache) {
		if (headCache) {
			const headPath = headCache[header.headerName];

			const dotIndex = headPath.lastIndexOf('.');
			const slashIndex = headPath.lastIndexOf('/');
			const currModuleName = headPath.substring(slashIndex + 1, dotIndex);
			if (currModuleName === header.moduleName) {
				handleModuleHeader(specFile, updateFile, header, importArray, false);
			} else {
				handleModuleHeader(specFile, updateFile, header, importArray, true);
			}
		}
	});
}

// isOuter区分模块内部引用""格式和模块外部引用<>格式
function handleModuleHeader(specFile, updateFile, header, importArray, isOuter) {
    const headName = isOuter ? header.name : header.headerStrName;
	const moduleName = isOuter ? header.specName : header.moduleStrName;

	let isNeedFindPCH = true;

	for (let i = 0; i < importArray.length; i++) {
		const importHeader = importArray[i].split(importMark)[1].trim();

		if (importHeader === headName) {
			// 已经引入头文件
			handelAddHeaderStatus(specFile, updateFile, header, true, false);
			isNeedFindPCH = false;
			break;
		} else if (importHeader === moduleName) {
			// 已经引入spec头文件
			handelAddHeaderStatus(specFile, updateFile, header, false, true);
			isNeedFindPCH = false;
			break;
		}
	}

	if (isNeedFindPCH) {
		// 检查被修改文件的.pch文件是否引入了spec头文件
		const slashIndex = updateFile.lastIndexOf('/');
		const thePath = updateFile.substring(0, slashIndex + 1);

		findPath.findPCHPath(thePath, function (success, pchName) {
			if (success) {
				try {
					// 读取.pch文件
					const data = fs.readFileSync(pchName, 'utf8');
					const lineArray = data.split('\n');

					let isAddedHeader = false;
					let isAddedSpecHeader = false;

					lineArray.forEach(element => {
						const lineVal = element.trim();

						if (importReg.test(lineVal)) {
							const importHeader = lineVal.split(importMark)[1].trim();

							if (importHeader === header.name
								|| importHeader === header.headerStrName) {
								isAddedHeader = true;
							} else if (importHeader === header.specName
								|| importHeader === header.moduleStrName) {
								isAddedSpecHeader = true;
							}
						}
					});

					handelAddHeaderStatus(specFile, updateFile, header, isAddedHeader, isAddedSpecHeader);
				} catch (err) {
					console.error(err);
				}
			} else {
				// 没有找到pch文件
				addHeaderToFile(updateFile, header);
			}
		});
	}
}

function handelAddHeaderStatus(specFile, updateFile, header, isAddedHeader, isAddedSpecHeader) {
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
				addHeaderToFile(updateFile, header);
			}
		});
	} else {
		// 都没找到，添加头文件
		addHeaderToFile(updateFile, header);
	}
}

function isAddedToSpecHeader(specFile, header, callback) {
	cache.getHeadCache(specFile).then(function (headCache) {
		if (headCache) {
			const specSlashIndex = specFile.lastIndexOf('/');
			const specFilePath = specFile.substring(0, specSlashIndex + 1);
			const headPath = specFilePath + headCache[header.headerName];

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
	checkDependency(updateFile, header.moduleName, string);
}

function addHeaderToFile(updateFile, header) {
	readStream(updateFile, importMark + ' ' + header.name, importMark);
	checkDependency(updateFile, header.moduleName, '自动注入头文件完成。');
}

function checkDependency(updateFile, moduleName, string) {
	const slashIndex = updateFile.lastIndexOf('/');
	const thePath = updateFile.substring(0, slashIndex + 1);

	findPath.findBPSpacPath(thePath, function (findFilePath, specName, readme) {
		const specPath = path.join(findFilePath, specName);

		try {
			// 读取当前工作空间的.spec文件
			const data = fs.readFileSync(specPath, 'utf8');
			const lineArray = data.split('\n');

			let isHaveDependency = false;

			lineArray.forEach(element => {
				const lineVal = element.trim();

				if (!lineVal.startsWith('#')
					&& lineVal.includes('dependency')
					&& lineVal.includes(moduleName)) {
					isHaveDependency = true;
				}
			});

			if (isHaveDependency) {
				displayNotification(string);
			} else {
				displayNotification(string + '\nspec文件未发现依赖项，请检查模块是否引入。');
			}
		} catch (err) {
			console.error(err);
		}
	});
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