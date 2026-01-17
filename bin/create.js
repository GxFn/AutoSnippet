#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const cache = require('./cache.js');
const findPath = require('./findPath.js');
const install = require('./install.js');
// 全局常量
const README_NAME = 'readme.md';
// 全局路径
const CMD_PATH = process.cwd();

/**
 * 根据文件路径确定模块名（SPM）
 * 返回路径中最近的（最深的）target 名称
 */
function determineModuleName(filePath, packageInfo) {
	// 从路径中提取模块名
	// 例如：Business/BDNetworkAPI/Code/... -> BDNetworkAPI（不是 Business）
	const packagePath = packageInfo.path;
	const relativePath = path.relative(packagePath, filePath);
	const segments = relativePath.split(path.sep);

	// ✅ 从后向前查找匹配的 target（优先匹配路径中更深的 target）
	// 这样可以避免匹配到聚合 target（如 Business），而匹配到实际的 target（如 BDNetworkAPI）
	for (let i = segments.length - 1; i >= 0; i--) {
		const segment = segments[i];
		if (packageInfo.targets.includes(segment)) {
			return segment;
		}
	}

	// 如果找不到，使用第一个 target（排除包名，如果包名也是 target）
	const firstTarget = packageInfo.targets[0];
	if (firstTarget && firstTarget !== packageInfo.name) {
		return firstTarget;
	}
	
	// 最后回退到包名
	return packageInfo.name;
}

/**
 * 从文件路径确定 target 的根目录（包含 Code 或 Sources 的目录）
 * @param {string} filePath - 文件路径
 * @returns {Promise<string|null>} target 根目录路径，如果找不到返回 null
 */
async function findTargetRootDir(filePath) {
	const fs = require('fs');
	let currentPath = path.dirname(path.resolve(filePath));
	const maxLevels = 10;
	let levelsChecked = 0;
	
	// ✅ 向上查找包含 Code 或 Sources 目录的目录（target 根目录）
	// 例如：BDNetworkAPI/Code/xxx.m -> BDNetworkAPI/
	while (currentPath && levelsChecked < maxLevels) {
		try {
			const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
			
			// 检查当前目录是否包含 Code 或 Sources 目录
			for (const entry of entries) {
				if (entry.isDirectory() && (entry.name === 'Code' || entry.name === 'Sources')) {
					return currentPath;
				}
			}
			
			// 继续向上查找
			const parentPath = path.dirname(currentPath);
			if (parentPath === currentPath) {
				break;
			}
			currentPath = parentPath;
			levelsChecked++;
		} catch (err) {
			if (err.code === 'ENOENT' || err.code === 'EACCES') {
				break;
			}
			throw err;
		}
	}
	
	return null;
}

function updateCodeSnippets(specFile, word, key, value) {
	if (key && key !== 'title' && key !== 'link' && key !== 'summary') {
		console.log('此项属性不存在或不可修改。');
		return;
	}
	if (key === 'link') {
		value = encodeURI(value);
	}
	let placeholder = null;

	try {
		// 读取AutoSnippet的占位配置
		const data = fs.readFileSync(specFile, 'utf8');
		if (data) {
			placeholder = JSON.parse(data);
		}
	} catch (err) {
		console.error(err);
	}

	if (placeholder !== null) {
		let snippet = null;

		for (let index = 0; index < placeholder.list.length; index++) {
			let placeItem = placeholder.list[index];

			if (placeItem['{completionKey}'] === word) {
				snippet = placeItem;
				if (key) {
					snippet['{' + key + '}'] = value;
				}
				break;
			}
		}

		if (snippet !== null) {
			createCodeSnippets(specFile, null, snippet);
		} else {
			console.log('未找到此联想词。');
		}
	} else {
		console.log('执行异常。');
	}
}

/**
 * 查找包含 // ACode 标记的文件
 */
async function findFilesWithACode(filePath) {
	const filesWithACode = [];
	
	try {
		const files = await fs.promises.readdir(filePath);
		
		for (const filename of files) {
			const filedir = path.join(filePath, filename);
			try {
				const stats = await fs.promises.lstat(filedir);
				if (stats.isFile()) {
					// 只检查源代码文件
					if (filename.endsWith('.m') || filename.endsWith('.h') || filename.endsWith('.swift')) {
						const content = await fs.promises.readFile(filedir, 'utf8');
						const lines = content.split('\n');
						
						// 检查是否包含 // ACode 标记
						for (let i = 0; i < lines.length; i++) {
							if (lines[i].trim().toLowerCase() === '// acode') {
								filesWithACode.push({
									path: filedir,
									name: filename,
									line: i + 1
								});
								break; // 找到标记后跳出，每个文件只记录一次
							}
						}
					}
				}
			} catch (err) {
				// 忽略无法读取的文件
				continue;
			}
		}
	} catch (err) {
		console.error('Error reading directory:', err);
	}
	
	return filesWithACode;
}

function createCodeSnippets(specFile, answers, updateSnippet, selectedFilePath) {
	let snippet = updateSnippet;
	let isHaveHeader = snippet === null ? false : (snippet['{headName}'] !== undefined);

	if (snippet === null) {
		// ✅ 处理 completion_more（可能是数组或字符串）
		const completionMoreStr = Array.isArray(answers.completion_more) 
			? answers.completion_more.join('') 
			: answers.completion_more;
		
		const answersKeys = answers.completion_first + completionMoreStr + answers.title;
		const answersIdBuff = Buffer.from(answersKeys, 'utf-8');
		const identifier = 'AutoSnip_' + answersIdBuff.toString('base64').replace(/\//g, '');

		snippet = {
			'{identifier}': identifier,
			'{title}': answers.title,
			'{completionKey}': answers.completion_first,
			'{completion}': '@' + answers.completion_first + completionMoreStr + '@Moudle',
			'{summary}': answers.summary,
			'{language}': 'Xcode.SourceCodeLanguage.Objective-C',
		};

		if (answers.link) {
			snippet['{link}'] = encodeURI(answers.link);
		}
		isHaveHeader = answers.header;
	}

	// ✅ 如果指定了文件路径，直接使用；否则查找当前目录下的所有文件
	let filePathArr = [];
	
	if (selectedFilePath) {
		// 使用指定的文件
		filePathArr = [selectedFilePath];
		readStream(specFile, filePathArr, snippet, isHaveHeader);
	} else {
		// 原有逻辑：查找当前目录下的所有文件
		const filePath = CMD_PATH;
		fs.readdir(filePath, function (err, files) {
			if (err) {
				console.log(err);
				return;
			}

			files.forEach(function (filename) {
				const filedir = path.join(filePath, filename);
				try {
					// 读取路径是否为文件
					const stats = fs.lstatSync(filedir);
					const isFile = stats.isFile();
					if (isFile) {
						filePathArr.push(filedir);
					}
				} catch (err) {
					console.error(err);
				}
			});

			readStream(specFile, filePathArr, snippet, isHaveHeader);
		});
	}
}

function readStream(specFile, filePathArr, snippet, isHaveHeader) {
	if (filePathArr.length === 0) {
		console.log('未找到由 // ACode 标识的代码块，请检查当前文件目录。');
		return;
	}

	const filePath = filePathArr.pop();
	const rl = readline.createInterface({
		input: fs.createReadStream(filePath),
		crlfDelay: Infinity
	});

	let canPush = false;
	let codeList = [];

	let lineIndex = 0;
	let positionList = [];

	rl.on('line', function (line) {
		lineIndex++;

		if (canPush) {
			codeList.push(escapeString(line));
		}
		if (line.trim().toLowerCase() === '// acode') {
			canPush = !canPush;
			positionList.push(lineIndex - 1);
		}
	});

	rl.on('close', async function () {
		if (codeList.length > 1) {
			codeList.pop();

			if (filePath.endsWith('.swift')) {
				snippet['{language}'] = 'Xcode.SourceCodeLanguage.Swift';
			}

			if (isHaveHeader) {
				const dotIndex = filePath.lastIndexOf('.');
				const slashIndex = filePath.lastIndexOf('/');
				const fileName = filePath.substring(slashIndex + 1, dotIndex + 1) + 'h';
				const thePath = filePath.substring(0, slashIndex + 1);

				// ✅ 使用 SPM 的 Package.swift 查找（替代 .boxspec）
				findPath.findPackageSwiftPath(thePath).then(async function (packagePath) {
					if (!packagePath) {
						console.log('未找到 Package.swift 文件，请检查路径。');
						snippet['{content}'] = codeList;
						// ✅ 查找 target 根目录（Code 或 Sources 的父目录）
						let targetRootDir = await findTargetRootDir(filePath);
						if (!targetRootDir) {
							// 如果找不到，使用文件所在目录的父目录作为后备
							targetRootDir = path.dirname(path.dirname(filePath));
						}
						const moduleSpecFile = path.join(targetRootDir, 'AutoSnippet.boxspec.json');
						await saveFromFile(moduleSpecFile, snippet);
						return;
					}

					// 解析 Package.swift 获取模块信息
					const packageInfo = await findPath.parsePackageSwift(packagePath);
					if (!packageInfo) {
						snippet['{content}'] = codeList;
						// ✅ 查找 target 根目录（Code 或 Sources 的父目录）
						let targetRootDir = await findTargetRootDir(filePath);
						if (!targetRootDir) {
							// 如果找不到，使用 Package.swift 所在目录作为后备
							targetRootDir = path.dirname(packagePath);
						}
						const moduleSpecFile = path.join(targetRootDir, 'AutoSnippet.boxspec.json');
						await saveFromFile(moduleSpecFile, snippet);
						return;
					}

					// 根据当前文件路径确定模块名
					const moduleName = determineModuleName(filePath, packageInfo);
					const headerNameWithoutExt = fileName.substring(0, fileName.length - 2); // 移除 .h

					// ✅ 查找 target 根目录（Code 或 Sources 的父目录）
					let targetRootDir = await findTargetRootDir(filePath);
					if (!targetRootDir) {
						// 如果找不到 target 根目录，使用 Package.swift 所在目录作为后备
						targetRootDir = packageInfo.path;
					}
					const moduleRoot = targetRootDir;

					// ✅ 查找头文件（适配 SPM 的 include/ModuleName/ 结构）
					// 在 target 根目录下查找（可能包含 Code/ 或 Sources/ 这样的结构）
					const headerPath = await findPath.findSubHeaderPath(targetRootDir, headerNameWithoutExt, moduleName);

					snippet['{content}'] = codeList;
					snippet['{specName}'] = moduleName;

					if (headerPath) {
						// ✅ headName 存储相对于 target 根目录的相对路径
						// 例如：target 根目录在 BDNetworkAPI/，头文件在 BDNetworkAPI/Code/xxx.h
						// 则 headName = "Code/xxx.h"
						const headerRelativePath = path.relative(targetRootDir, headerPath);
						snippet['{headName}'] = headerRelativePath;
					} else {
						// 如果找不到头文件，使用文件名
						snippet['{headName}'] = fileName;
					}

					// 查找 README.md（在 target 根目录）
					try {
						const readmePath = path.join(targetRootDir, README_NAME);
						await fs.promises.access(readmePath);
						const readmeRelativePath = path.relative(targetRootDir, readmePath);
						snippet['{readme}'] = encodeURI(readmeRelativePath);
					} catch {
						// README.md 不存在，跳过
					}

					// ✅ SPM 模块：.boxspec 文件位置在 target 根目录（Code 或 Sources 的父目录）
					const moduleSpecFile = path.join(targetRootDir, 'AutoSnippet.boxspec.json');
					await saveFromFile(moduleSpecFile, snippet);
				}).catch(async function (err) {
					console.error('Error finding Package.swift:', err);
					snippet['{content}'] = codeList;
					await saveFromFile(specFile, snippet);
				});
			} else {
				snippet['{content}'] = codeList;
				await saveFromFile(specFile, snippet);
			}
			// 移除ACode标识
			removeAcodeMark(filePath, positionList);
		} else {
			readStream(specFile, filePathArr, snippet, isHaveHeader);
		}
	});
}

async function saveFromFile(specFile, snippet) {
	const findPath = require('./findPath.js');
	let placeholder = null;

	try {
		// 读取AutoSnippet的占位配置
		const data = fs.readFileSync(specFile, 'utf8');
		if (data) {
			placeholder = JSON.parse(data);
		}
	} catch (err) {
		// ✅ 文件不存在或读取失败，创建新的配置文件
		if (err.code === 'ENOENT') {
			// 确保目录存在
			const specFileDir = path.dirname(specFile);
			try {
				fs.mkdirSync(specFileDir, { recursive: true });
			} catch (mkdirErr) {
				// 目录可能已存在，忽略错误
			}
			// 创建空的配置文件结构
			placeholder = {
				list: []
			};
		} else {
			console.error(err);
			return;
		}
	}

	if (placeholder != null) {
		let isChange = false;

		for (let index = 0; index < placeholder.list.length; index++) {
			let placeItem = placeholder.list[index];

			if (placeItem['{identifier}'] === snippet['{identifier}']) {
				placeholder.list[index] = snippet;
				isChange = true;
				break;
			}
		}

		if (!isChange) {
			placeholder.list.push(snippet);
		}

		const content = JSON.stringify(placeholder, null, 4);
		if (content) {
			try {
				fs.writeFileSync(specFile, content);
				console.log('create success.');
			} catch (err) {
				console.log(err);
			}
			cache.updateCache(specFile, content);
			
			// ✅ 同步到根目录的 AutoSnippetRoot.boxspec.json
			try {
				const rootSpecFile = await findPath.getRootSpecFilePath(specFile);
				if (rootSpecFile) {
					// 读取根配置文件
					let rootPlaceholder = null;
					try {
						const rootData = fs.readFileSync(rootSpecFile, 'utf8');
						if (rootData) {
							rootPlaceholder = JSON.parse(rootData);
						}
					} catch (err) {
						if (err.code === 'ENOENT') {
							rootPlaceholder = { list: [] };
						} else {
							// 忽略错误
						}
					}
					
					if (rootPlaceholder != null) {
						// 检查是否已存在相同的 identifier
						let exists = false;
						if (rootPlaceholder.list) {
							for (let i = 0; i < rootPlaceholder.list.length; i++) {
								if (rootPlaceholder.list[i]['{identifier}'] === snippet['{identifier}']) {
									// 已存在，更新它
									rootPlaceholder.list[i] = snippet;
									exists = true;
									break;
								}
							}
						} else {
							rootPlaceholder.list = [];
						}
						
						// 如果不存在，添加到列表
						if (!exists) {
							rootPlaceholder.list.push(snippet);
						}
						
						// 写入根配置文件
						const rootContent = JSON.stringify(rootPlaceholder, null, 4);
						fs.writeFileSync(rootSpecFile, rootContent, 'utf8');
					}
				}
			} catch (err) {
					// 忽略错误
			}
			
			// ✅ 只写入刚创建的单个代码片段
			install.addCodeSnippets(specFile, snippet);
		}
	}
}

function removeAcodeMark(filePath, positionList) {
	if (positionList.length === 0) {
		return;
	}
	try {
		const data = fs.readFileSync(filePath, 'utf8');
		const lineArray = data.split('\n');

		positionList = positionList.reverse();
		for (let i = 0; i < positionList.length; i++) {
			const position = positionList[i];

			if (lineArray[position].trim().toLowerCase() === '// acode') {
				lineArray.splice(position, 1);
			}
		}

		fs.writeFileSync(filePath, lineArray.join('\n'), 'utf8');
	} catch (err) {
		console.error(err);
	}
}

function escapeString(string) {
	string = string.replace(/</g, '&lt;');
	string = string.replace(/>/g, '&gt;');
	return string;
}

exports.createCodeSnippets = createCodeSnippets;
exports.updateCodeSnippets = updateCodeSnippets;
exports.saveFromFile = saveFromFile;
exports.findFilesWithACode = findFilesWithACode;