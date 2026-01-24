#!/usr/bin/env node

/**
 * 职责：
 * - 将 spec（AutoSnippet*.boxspec.json）渲染为 Xcode .codesnippet 文件
 * - 这是对原 `bin/install.js` 的下沉实现，保持对外函数签名不变
 */

const fs = require('fs');
const path = require('path');
const cacheStore = require('../infra/cacheStore.js');
const paths = require('../infra/paths.js');

const TEMPLATE_TOKENS = ['{identifier}', '{title}', '{completion}', '{summary}', '{content}', '{language}'];

function getField(snippet, token) {
	// 新 schema：不再使用 "{...}" 作为 key；这里仅做 token → 字段映射
	if (!snippet) return undefined;
	switch (token) {
		case '{identifier}': return snippet.identifier;
		case '{title}': return snippet.title;
		case '{completion}': return snippet.completion;
		case '{summary}': return snippet.summary;
		case '{content}': return snippet.body;
		case '{language}': {
			// spec 内只保留 languageShort（objc/swift），这里转换成 Xcode 需要的值
			if (snippet.languageShort === 'swift') return 'Xcode.SourceCodeLanguage.Swift';
			return 'Xcode.SourceCodeLanguage.Objective-C';
		}
		default: return undefined;
	}
}

function escapeString(string) {
	if (typeof string !== 'string') return string;
	string = string.replace(/&/g, '&amp;');
	string = string.replace(/</g, '&lt;');
	string = string.replace(/>/g, '&gt;');
	return string;
}

function writeSingleSnippet(snippet, template) {
	if (!snippet || !template) return;

	let content = '';
	let identifier = '';
	let holderArr = [];

	holderArr.push(snippet);

	if (snippet.headName) {
		let extPlace = Object.assign({}, snippet);
		const headerFileName = path.basename(extPlace.headName);
		let header = '<' + extPlace.specName + '/' + headerFileName + '>';

		const headRelativePath = extPlace.headName;
		header = header + ' ' + headRelativePath;
		header = escapeString(header);

		if (extPlace.languageShort === 'swift') {
			header = extPlace.specName;
		}

		extPlace.identifier = extPlace.identifier + 'Ext';
		extPlace.title = extPlace.title + ' headerVersion';
		extPlace.completion = extPlace.completion + 'Z';
		extPlace.summary = extPlace.summary + header;

		let array = [];
		if (extPlace.languageShort === 'swift') {
			array = ['// autosnippet:import ' + header];
		} else {
			array = ['// autosnippet:include ' + header];
		}
		(extPlace.content || []).forEach(element => {
			array.push(element);
		});
		extPlace.content = array;

		holderArr.push(extPlace);
	}

	holderArr.forEach(function (placeVal) {
		content = '';
		template.list.forEach(function (tempVal) {
			if (TEMPLATE_TOKENS.indexOf(tempVal) === 0) {
				identifier = getField(placeVal, tempVal);
			}

			if (TEMPLATE_TOKENS.indexOf(tempVal) > -1) {
				let value = getField(placeVal, tempVal);
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
			const snippetsPath = paths.getSnippetsPath();
			try {
				fs.accessSync(snippetsPath, fs.constants.F_OK);
			} catch {
				fs.mkdirSync(snippetsPath, { recursive: true });
			}
			try {
				const snippetFile = path.join(snippetsPath, identifier + '.codesnippet');
				fs.writeFileSync(snippetFile, content);
			} catch (err) {
				console.log(err);
			}
		}
	});
}

function addCodeSnippets(specFile, singleSnippet) {
	let placeholder = null;
	let template = null;

	try {
		const data = fs.readFileSync(path.join(__dirname, '../../template.json'), 'utf8');
		if (data) {
			template = JSON.parse(data);
		}
	} catch (err) {
		console.error('安装失败：无法读取模板文件', err.message);
		return { success: false, error: err.message };
	}

	if (singleSnippet) {
		writeSingleSnippet(singleSnippet, template);
		try {
			const data = fs.readFileSync(specFile, 'utf8');
			if (data) {
				cacheStore.updateCache(specFile, data);
			}
		} catch (err) {
			console.error(err);
		}
		return { success: true, count: 1 };
	}

	try {
		const data = fs.readFileSync(specFile, 'utf8');
		if (data) {
			placeholder = JSON.parse(data);
			cacheStore.updateCache(specFile, data);
		}
	} catch (err) {
		console.error('安装失败：无法读取配置文件', err.message);
		return { success: false, error: err.message };
	}

	if (placeholder != null && template != null) {
		let holderArr = [];
		let successCount = 0;
		let errorCount = 0;

		placeholder.list.forEach(function (placeVal) {
			holderArr.push(placeVal);

			if (placeVal && placeVal.headName) {
				let extPlace = Object.assign({}, placeVal);
				const headerFileName = path.basename(extPlace.headName);
				let headerRaw = '<' + extPlace.specName + '/' + headerFileName + '>';

				const headRelativePath = extPlace.headName;
				headerRaw = headerRaw + ' ' + headRelativePath;
				const headerEscaped = escapeString(headerRaw);

				if (extPlace.languageShort === 'swift') {
					headerRaw = extPlace.specName;
				}

				extPlace.identifier = extPlace.identifier + 'Ext';
				extPlace.title = extPlace.title + ' headerVersion';
				extPlace.completion = extPlace.completion + 'Z';
				extPlace.summary = extPlace.summary + (extPlace.languageShort === 'swift' ? headerRaw : headerEscaped);

				let array = [];
				if (extPlace.languageShort === 'swift') {
					array = ['// as:import ' + headerRaw];
				} else {
					array = ['// as:include ' + headerEscaped];
				}
				(extPlace.body || []).forEach(element => {
					array.push(element);
				});
				extPlace.body = array;

				holderArr.push(extPlace);
			}
		});

		holderArr.forEach(function (placeVal) {
			let content = '';
			let identifier = '';
			template.list.forEach(function (tempVal) {
				if (TEMPLATE_TOKENS.indexOf(tempVal) === 0) {
					identifier = getField(placeVal, tempVal);
				}

				if (TEMPLATE_TOKENS.indexOf(tempVal) > -1) {
					let value = getField(placeVal, tempVal);
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
				const snippetsPath = paths.getSnippetsPath();
				try {
					fs.accessSync(snippetsPath, fs.constants.F_OK);
				} catch {
					fs.mkdirSync(snippetsPath, { recursive: true });
				}
				try {
					const snippetFile = path.join(snippetsPath, identifier + '.codesnippet');
					fs.writeFileSync(snippetFile, content);
					successCount++;
				} catch (err) {
					console.error(`安装片段失败 [${identifier}]:`, err.message);
					errorCount++;
				}
			}
		});

		return { success: true, successCount, errorCount, total: holderArr.length };
	}

	return { success: false, error: '配置文件格式错误' };
}

module.exports = {
	addCodeSnippets
};

