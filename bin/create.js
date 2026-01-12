#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const cache = require('./cache.js');
const findPath = require('./findPath.js');
const install = require('./install.js');
// 全局路径
const CMD_PATH = process.cwd();

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

function createCodeSnippets(specFile, answers, updateSnippet) {
	let snippet = updateSnippet;
	let isHaveHeader = snippet === null ? false : (snippet['{headName}'] !== undefined);

	if (snippet === null) {
		const answersKeys = answers.completion_first + answers.completion_more + answers.title;
		const answersIdBuff = Buffer.from(answersKeys, 'utf-8');
		const identifier = 'AutoSnip_' + answersIdBuff.toString('base64').replace(/\//g, '');

		snippet = {
			'{identifier}': identifier,
			'{title}': answers.title,
			'{completionKey}': answers.completion_first,
			'{completion}': '@' + answers.completion_first + answers.completion_more + '@Moudle',
			'{summary}': answers.summary,
			'{language}': 'Xcode.SourceCodeLanguage.Objective-C',
		};

		if (answers.link) {
			snippet['{link}'] = encodeURI(answers.link);
		}
		isHaveHeader = answers.header;
	}

	const filePath = CMD_PATH;
	let filePathArr = [];

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

	rl.on('close', function () {
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

				const specSlashIndex = specFile.lastIndexOf('/');
				const specFilePath = specFile.substring(0, specSlashIndex + 1);

				findPath.findBPSpacPath(thePath, function (findFilePath, specName, readme) {
					const specPureName = specName.split('.')[0];

					findPath.findSubHeaderPath(findFilePath, specPureName).then(function (headerPath) {
						snippet['{content}'] = codeList;
						snippet['{specName}'] = specPureName;
						snippet['{headName}'] = fileName;

						if (headerPath) {
							snippet['{specHeadPath}'] = encodeURI(headerPath.replace(specFilePath, ''));
						}

						if (readme) {
							const readmePath = path.join(findFilePath, readme).replace(specFilePath, '');
							snippet['{readme}'] = encodeURI(readmePath);
						}
						saveFromFile(specFile, snippet);
					});
				});
			} else {
				snippet['{content}'] = codeList;
				saveFromFile(specFile, snippet);
			}
			// 移除ACode标识
			removeAcodeMark(filePath, positionList);
		} else {
			readStream(specFile, filePathArr, snippet, isHaveHeader);
		}
	});
}

function saveFromFile(specFile, snippet) {
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
			install.addCodeSnippets(specFile);
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