#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
// 全局常量
const HOLDER_NAME = 'AutoSnippet.boxspec.json';
const BOX_SPEC_NAME = '.boxspec';
const POD_SPEC_NAME = '.podspec';
const README_NAME = 'readme.md';
const PCH_NAME = '.pch';

// 向上查找AutoSnippet配置文件
function findASSpecPath(filePath, callback) {
	fs.readdir(filePath, function (err, files) {
		if (err) {
			console.log(err);
			return;
		}

		let isEnd = false;
        files.forEach(function (filename) {

			if (filename === HOLDER_NAME) {
				isEnd = true;
				callback(path.join(filePath, filename));
			}
        });

		if (isEnd) {
			return;
		}

		if (!isEnd && filePath !== '/' && filePath !== '/Users') {
			findASSpecPath(path.join(filePath, '/..'), callback);
		} else {
			console.log('未找到 AutoSnippet.boxspec.json 文件，请检查路径。');
		}
    });
}

// 向上查找.pch文件
function findPCHPath(filePath, callback) {
	fs.readdir(filePath, function (err, files) {
		if (err) {
			console.log(err);
			return;
		}

		let isEnd = false;
        files.forEach(function (filename) {

			if (filename.endsWith(PCH_NAME)) {
				isEnd = true;
				callback(true, path.join(filePath, filename));
			}
        });

		if (isEnd) {
			return;
		}

		if (!isEnd && filePath !== '/' && filePath !== '/Users') {
			findPCHPath(path.join(filePath, '/..'), callback);
		} else {
			callback(false, null);
		}
    });
}

// 向上查找模块.spec文件
function findBPSpacPath(filePath, callback) {
	fs.readdir(filePath, function (err, files) {
		if (err) {
			console.log(err);
			return;
		}

		let isError = false;
		let isEnd = false;
		let readme = null;
		let specName = null;

        files.forEach(function (filename) {
			if (filename === HOLDER_NAME) {
				isError = true;
			}
			if (filename.toLowerCase() === README_NAME) {
                readme = filename;
			}
			if (filename.endsWith(BOX_SPEC_NAME) || filename.endsWith(POD_SPEC_NAME)) {
                const dotIndex = filename.lastIndexOf('.');
				const ext = filename.substr(dotIndex);

                if (ext === BOX_SPEC_NAME || ext === POD_SPEC_NAME) {
                    specName = filename;
					isEnd = true;
                }
			}
        });

		if (isEnd && specName) {
			callback(filePath, specName, readme);
			return;
		}

		if (isError) {
			console.log('先找到了 AutoSnippet.boxspec.json 文件，请检查路径。');
			return;
		}

		if (!isEnd && filePath !== '/' && filePath !== '/Users' && filePath !== '/LocalModule') {
			findBPSpacPath(path.join(filePath, '/..'), callback);
		} else {
			console.log('未找到 .boxspec 文件，请检查路径。');
		}
    });
}

// 向下查找模块默认头文件
async function findSubHeaderPath(filePath, headerName) {
	let resultPath = null;

	try {
		const files = fs.readdirSync(filePath);

		for (let i = 0; i < files.length; i++) {
			const filename = files[i];
			const filedir = path.join(filePath, filename);

			if (filename === (headerName + '.h')) {
				resultPath = filedir;
				break;
			} else {
				try {
					// 读取路径是否为文件
					const stats = fs.lstatSync(filedir);
					const isDirectory = stats.isDirectory();
					if (isDirectory) {
						const result = await findSubHeaderPath(filedir, headerName);
						if (result) {
							resultPath = result;
						}
					}
				} catch (err) {
					console.error(err);
				}
			}
		}
	} catch (err) {
		console.log(err);
	}
	return resultPath;
}

// 向下查找AutoSnippet配置文件
async function findSubASSpecPath(filePath) {
	let resultArray = [];

	try {
		const files = fs.readdirSync(filePath);

		for (let i = 0; i < files.length; i++) {
			const filename = files[i];
			const filedir = path.join(filePath, filename);

			if (filename === HOLDER_NAME) {
				resultArray.push(filedir);
			} else {
				try {
					// 读取路径是否为文件
					const stats = fs.lstatSync(filedir);
					const isDirectory = stats.isDirectory();
					if (isDirectory) {
						const array = await findSubASSpecPath(filedir);
						resultArray = resultArray.concat(array);
					}
				} catch (err) {
					console.error(err);
				}
			}
		}
	} catch (err) {
		console.log(err);
	}
	return resultArray;
}

exports.findASSpecPath = findASSpecPath;
exports.findBPSpacPath = findBPSpacPath;
exports.findPCHPath = findPCHPath;
exports.findSubHeaderPath = findSubHeaderPath;
exports.findSubASSpecPath = findSubASSpecPath;