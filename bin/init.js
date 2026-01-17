#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const CMD_PATH = process.cwd();
const findPath = require('./findPath.js');

/**
 * 聚合子模块的 AutoSnippet.boxspec.json 到主配置文件
 * @param {string} mainSpecFile - 主配置文件路径
 * @returns {Promise<void>}
 */
async function mergeSubSpecs(mainSpecFile) {
	let idsArray = [];
	let specObj = {
		list: []
	};

	const rootSpecFile = await findPath.getRootSpecFilePath(mainSpecFile);
	if (!rootSpecFile) {
		return;
	}
	
	const projectRoot = path.dirname(rootSpecFile);
	const searchRoot = projectRoot;

	const specSlashIndex = rootSpecFile.lastIndexOf('/');
	const specFilePath = rootSpecFile.substring(0, specSlashIndex + 1);

	const array = await findPath.findSubASSpecPath(searchRoot);

	for (let i = 0; i < array.length; i++) {
		const filename = array[i];

		const slashIndex = filename.lastIndexOf('/');
		let thePath = filename.substring(0, slashIndex + 1);
		if (filename === rootSpecFile) {
			// 跳过根目录的 AutoSnippetRoot.boxspec.json，避免循环引用
			continue;
		} else {
			thePath = thePath.replace(specFilePath, '');
		}

		try {
			// 读取AutoSnippet的占位配置
			const data = fs.readFileSync(filename, 'utf8');
			const config = JSON.parse(data);
			if (config && config.list) {
				const arr = config.list.filter(function (item, index, array) {
					for (let i = 0; i < idsArray.length; i++) {
						if (item['{identifier}'] === idsArray[i]) {
							return false;
						}
					}
					idsArray.push(item['{identifier}']);
					return true;
				});
				specObj.list = specObj.list.concat(arr);
			}
		} catch (err) {
			console.error(err);
		}
	}

	try {
		const content = JSON.stringify(specObj, null, 4);
		if (content) {
			fs.writeFileSync(rootSpecFile, content, 'utf8');
		}
	} catch (err) {
		// 忽略错误
	}
}

/**
 * 从目录路径确定 target 的根目录（包含 Code 或 Sources 的目录）
 * @param {string} dirPath - 目录路径
 * @returns {Promise<string|null>} target 根目录路径，如果找不到返回 null
 */
async function findTargetRootDirFromPath(dirPath) {
	let currentPath = path.resolve(dirPath);
	const maxLevels = 10;
	let levelsChecked = 0;
	
	// ✅ 向上查找包含 Code 或 Sources 目录的目录（target 根目录）
	while (currentPath && levelsChecked < maxLevels) {
		try {
			const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
			
			// 检查当前目录是否包含 Code 或 Sources 目录
			for (const entry of entries) {
				if (entry.isDirectory() && (entry.name === 'Code' || entry.name === 'Sources')) {
					// 找到包含 Code 或 Sources 的目录，这就是 target 根目录
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

async function initSpec() {
	// ✅ 查找 target 根目录（包含 Code 或 Sources 的目录），在该目录创建 AutoSnippet.boxspec.json
	let targetRootDir = await findTargetRootDirFromPath(CMD_PATH);
	
	// 如果找不到 target 根目录，尝试查找 Package.swift 作为后备
	if (!targetRootDir) {
		let packagePath = await findPath.findPackageSwiftPath(CMD_PATH);
		if (packagePath) {
			targetRootDir = path.dirname(packagePath);
		} else {
			targetRootDir = CMD_PATH;
		}
	}
	
	const filePath = path.join(targetRootDir, 'AutoSnippet.boxspec.json');
	
	try {
		await fs.promises.access(filePath);
	} catch (error) {
		const specObj = {
			list: []
		};
		const content = JSON.stringify(specObj, null, 4);
		fs.writeFileSync(filePath, content, 'utf8');
	}
	await mergeSubSpecs(filePath);
}

exports.initSpec = initSpec;
exports.mergeSubSpecs = mergeSubSpecs;