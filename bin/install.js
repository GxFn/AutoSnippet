#!/usr/bin/env node

const fs = require('fs');
const cache = require('./cache.js');
// 全局路径
const USER_HOME 	= process.env.HOME || process.env.USERPROFILE;
const SNIPPETS_PATH = USER_HOME + '/Library/Developer/Xcode/UserData/CodeSnippets';
const HOLDER_KEYS  	= ['{identifier}', '{title}', '{completion}', '{summary}', '{content}', '{language}'];

function addCodeSnippets(specFile) {
	let placeholder = null;
	let template = null;

	try {
		// 读取AutoSnippet的占位配置
		const data = fs.readFileSync(specFile, 'utf8');
		if (data) {
			placeholder = JSON.parse(data);
			cache.updateCache(specFile, data);
		}
	} catch (err) {
		console.error(err);
	}

	try {
		// 读取模板信息
		const data = fs.readFileSync(__dirname + '/../template.json', 'utf8');
		if (data) {
			template = JSON.parse(data);
		}
	} catch (err) {
		console.error(err);
	}

	// 拼装配置文件
	if (placeholder != null && template != null) {
		let content = '';
		let identifier = '';
		let holderArr = [];

		placeholder.list.forEach(function (placeVal) {
			holderArr.push(placeVal);

			if (placeVal['{headName}']) {
				let extPlace = Object.assign({}, placeVal);
				let header = '<' + extPlace['{specName}'] + '/' + extPlace['{headName}'] + '>';
				header = escapeString(header);

				// swift只需要考虑工作空间是否引入
				if (extPlace['{language}'] === 'Xcode.SourceCodeLanguage.Swift') {
					header = extPlace['{specName}'];
				}

				extPlace['{identifier}'] = extPlace['{identifier}'] + 'Ext';
				extPlace['{title}'] = extPlace['{title}'] + ' headerVersion';
				extPlace['{completion}'] = extPlace['{completion}'] + 'Z';
				extPlace['{summary}'] = extPlace['{summary}'] + header;

				// 添加替换header标识位
				let array = ['// ahead ' + header];
				extPlace['{content}'].forEach(element => {
					array.push(element);
				});
				extPlace['{content}'] = array;

				holderArr.push(extPlace);
			}
		});

		holderArr.forEach(function (placeVal) {
			content = '';
			template.list.forEach(function (tempVal) {

				// 保存id，文件名和id一致
				if (HOLDER_KEYS.indexOf(tempVal) === 0) {
					identifier = placeVal[tempVal];
				}

				if (HOLDER_KEYS.indexOf(tempVal) > -1) {
					let value = placeVal[tempVal];

					// 数组需要遍历取出每一行内容
					if (Array.isArray(value)) {
						let turnValue = '';

						for (var index = 0; index < value.length; index++) {
							if (index === 0) {
								turnValue += value[index] + '\n';
							} else {
								turnValue += '\t' + value[index] + '\n';
							}
						}
						value = turnValue;
					}
					tempVal = '\t<string>' + value + '</string>\n';
				}

				content += tempVal;
			});

			if (identifier && content) {
				try {
					fs.accessSync(SNIPPETS_PATH, fs.F_OK);
				} catch (err) {
					fs.mkdirSync(SNIPPETS_PATH);
				}
				try {
					fs.writeFileSync(SNIPPETS_PATH + '/' + identifier + '.codesnippet', content);
				} catch (err) {
					console.log(err);
				}
			}
		});
	}
}

function escapeString(string) {
	string = string.replace(/</g, '&lt;');
	string = string.replace(/>/g, '&gt;');
	return string;
}

exports.addCodeSnippets = addCodeSnippets;