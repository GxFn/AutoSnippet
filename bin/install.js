#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const cache = require('./cache.js');
const config = require('./config.js');
const findPath = require('./findPath.js');
// 全局路径
const HOLDER_KEYS  	= ['{identifier}', '{title}', '{completion}', '{summary}', '{content}', '{language}'];

/**
 * 将单个代码片段写入文件
 */
function writeSingleSnippet(snippet, template) {
	if (!snippet || !template) {
		return;
	}

	let content = '';
	let identifier = '';
	let holderArr = [];

	// 添加主代码片段
	holderArr.push(snippet);

	// 如果有头文件，添加 headerVersion
	if (snippet['{headName}']) {
		let extPlace = Object.assign({}, snippet);
		// ✅ 从项目根目录找到模块，只使用模块名和头文件名
		// 例如：<BDVideoPlayer/BDVideoCacheManager.h> 而不是 <BDVideoPlayer/UI/BDVideoPlayer/Code/BDVideoCacheManager.h>
		const headerFileName = path.basename(extPlace['{headName}']);
		let header = '<' + extPlace['{specName}'] + '/' + headerFileName + '>';
		
		// ✅ 在标记中包含相对路径信息，格式：// ahead <Module/Header.h> relative/path/to/Header.h
		// 这样即使没有缓存也能解析出完整信息
		const headRelativePath = extPlace['{headName}'];  // 相对于模块根目录的相对路径
		header = header + ' ' + headRelativePath;
		header = escapeString(header);

		// swift只需要考虑工作空间是否引入
		if (extPlace['{language}'] === 'Xcode.SourceCodeLanguage.Swift') {
			header = extPlace['{specName}'];
		}

		extPlace['{identifier}'] = extPlace['{identifier}'] + 'Ext';
		extPlace['{title}'] = extPlace['{title}'] + ' headerVersion';
		extPlace['{completion}'] = extPlace['{completion}'] + 'Z';
		extPlace['{summary}'] = extPlace['{summary}'] + header;

		// 添加替换header标识位（格式：// ahead <Module/Header.h> relative/path/to/Header.h）
		let array = ['// ahead ' + header];
		extPlace['{content}'].forEach(element => {
			array.push(element);
		});
		extPlace['{content}'] = array;

		holderArr.push(extPlace);
	}

	// 处理每个代码片段（主片段和 headerVersion）
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
						// ✅ 对代码内容进行特殊字符转义
						const escapedLine = escapeString(value[index]);
						if (index === 0) {
							turnValue += escapedLine + '\n';
						} else {
							turnValue += '\t' + escapedLine + '\n';
						}
					}
					value = turnValue;
				} else {
					// ✅ 对非数组值也进行转义（如 summary）
					value = escapeString(value);
				}
				tempVal = '\t<string>' + value + '</string>\n';
			}

			content += tempVal;
		});

		if (identifier && content) {
			// ✅ 使用配置模块获取代码片段输出路径（写入 Xcode CodeSnippets）
			const snippetsPath = config.getSnippetsPath();
			
			try {
				fs.accessSync(snippetsPath, fs.constants.F_OK);
			} catch (err) {
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
		// 读取模板信息
		const data = fs.readFileSync(__dirname + '/../template.json', 'utf8');
		if (data) {
			template = JSON.parse(data);
		}
	} catch (err) {
		console.error('安装失败：无法读取模板文件', err.message);
		return { success: false, error: err.message };
	}

	// ✅ 如果指定了单个代码片段，只处理这个片段
	if (singleSnippet) {
		writeSingleSnippet(singleSnippet, template);
		// 更新缓存
		try {
			const data = fs.readFileSync(specFile, 'utf8');
			if (data) {
				cache.updateCache(specFile, data);
			}
		} catch (err) {
			console.error(err);
		}
		return { success: true, count: 1 };
	}

	// 原有逻辑：处理所有代码片段（用于 install 命令）
	try {
		// 读取AutoSnippet的占位配置
		const data = fs.readFileSync(specFile, 'utf8');
		if (data) {
			placeholder = JSON.parse(data);
			cache.updateCache(specFile, data);
		}
	} catch (err) {
		console.error('安装失败：无法读取配置文件', err.message);
		return { success: false, error: err.message };
	}

	// 拼装配置文件
	if (placeholder != null && template != null) {
		let content = '';
		let identifier = '';
		let holderArr = [];
		let successCount = 0;
		let errorCount = 0;

		placeholder.list.forEach(function (placeVal) {
			holderArr.push(placeVal);

			if (placeVal['{headName}']) {
				let extPlace = Object.assign({}, placeVal);
				// ✅ 从项目根目录找到模块，只使用模块名和头文件名
				const headerFileName = path.basename(extPlace['{headName}']);
				let header = '<' + extPlace['{specName}'] + '/' + headerFileName + '>';
				
				// ✅ 在标记中包含相对路径信息，格式：// ahead <Module/Header.h> relative/path/to/Header.h
				// 这样即使没有缓存也能解析出完整信息
				const headRelativePath = extPlace['{headName}'];  // 相对于模块根目录的相对路径
				header = header + ' ' + headRelativePath;
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
							// ✅ 对代码内容进行特殊字符转义
							const escapedLine = escapeString(value[index]);
							if (index === 0) {
								turnValue += escapedLine + '\n';
							} else {
								turnValue += '\t' + escapedLine + '\n';
							}
						}
						value = turnValue;
					} else {
						// ✅ 对非数组值也进行转义（如 summary）
						value = escapeString(value);
					}
					tempVal = '\t<string>' + value + '</string>\n';
				}

				content += tempVal;
			});

			if (identifier && content) {
				// ✅ 使用配置模块获取代码片段输出路径（写入 Xcode CodeSnippets）
				const snippetsPath = config.getSnippetsPath();
				
				try {
					fs.accessSync(snippetsPath, fs.constants.F_OK);
				} catch (err) {
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

function escapeString(string) {
	// 必须先转义 &，否则会把 &lt; 转成 &amp;lt;
	string = string.replace(/&/g, '&amp;');
	string = string.replace(/</g, '&lt;');
	string = string.replace(/>/g, '&gt;');
	return string;
}

exports.addCodeSnippets = addCodeSnippets;