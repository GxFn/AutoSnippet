#!/usr/bin/env node

/**
 * 职责：
 * - 将本地 Xcode CodeSnippets 目录里的 .codesnippet 转换为 AutoSnippet 可共享格式
 * - 支持交互选择与非交互 preset（用于自动化/测试）
 *
 * 核心流程：
 * - shareCodeSnippets(specFile): 扫描本地 snippets → 交互选择 → 读取 plist → create.saveFromFile() 写入 spec → 删除原文件
 * - shareWithPreset(specFile, preset): 直接按预置 fileName/category 等完成同样流程
 *
 * 核心方法（主要导出）：
 * - shareCodeSnippets(specFile)
 * - shareWithPreset(specFile, preset)
 */

const fs = require('fs');
const path = require('path');
const parseString = require('xml2js').parseString;
// 读取输入命令
const inquirer = require('inquirer');

const specRepository = require('../lib/snippet/specRepository.js');
const cache = require('../lib/infra/cacheStore.js');
const triggerSymbol = require('../lib/infra/triggerSymbol.js');
const config = require('../lib/infra/paths.js');

function shareCodeSnippets(specFile) {
	const SNIPPETS_PATH = config.getSnippetsPath();
	try {
		fs.accessSync(SNIPPETS_PATH, fs.F_OK);
	} catch (err) {
		console.log('不存在本地Snippet。');
		return;
	}

	const filePath = SNIPPETS_PATH;
	let filenameList = [];

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
				if (isFile
					&& !filename.startsWith('AutoSnip_')
					&& filename.endsWith('.codesnippet')) {

					filenameList.push({
						name: filename
					});
				}
			} catch (err) {
				console.error(err);
			}
		});

		if (filenameList.length > 0) {
			askQuestions(specFile, filenameList, filePath);
		} else {
			console.log('不存在本地Snippet。');
		}
	});
}

/**
 * 预置输入（非交互）分享本地 snippet
 *
 * preset 结构示例：
 * {
 *   "fileName": "LocalFixture.codesnippet",
 *   "completion_more": ["@Tool"],
 *   "completion_first": "sharee2e" // 可选，仅当本地 codesnippet completionPrefix 为空时需要
 * }
 */
function shareWithPreset(specFile, preset) {
	const SNIPPETS_PATH = config.getSnippetsPath();
	const fileName = preset && preset.fileName;
	const completionMore = preset && preset.completion_more;
	const completionFirst = preset && preset.completion_first;

	if (!fileName || !completionMore) {
		console.error('❌ share 预置输入不完整：需要 fileName / completion_more');
		return false;
	}

	const filedir = path.join(SNIPPETS_PATH, fileName);
	try {
		fs.accessSync(filedir, fs.constants.F_OK);
	} catch {
		console.error(`❌ 未找到本地 snippet 文件: ${filedir}`);
		return false;
	}

	try {
		const data = fs.readFileSync(filedir, 'utf8');
		if (!data) return false;

		let ok = false;
		parseString(data, function (_err, result) {
			if (result && result.plist && result.plist.dict && result.plist.dict[0].string) {
				const array = result.plist.dict[0].string;

				if (array[0] === '') {
					if (!completionFirst) {
						console.error('❌ 本地 snippet completionPrefix 为空，需要 preset.completion_first');
						ok = false;
						return;
					}
					array[0] = completionFirst;
					createFromLocal(specFile, filedir, array, completionMore);
					ok = true;
					return;
				}

				if (array[0].endsWith('@Moudle')) {
					console.log('这个文件已经是共享版本，不需要再处理。');
					ok = true;
					return;
				}

				createFromLocal(specFile, filedir, array, completionMore);
				ok = true;
			}
		});

		return ok;
	} catch (err) {
		console.error(err);
		return false;
	}
}

function askQuestions(specFile, filenameList, filePath) {
	// 开始问问题
	const questions = [{
			type: 'checkbox',
			name: 'shareName',
			message: 'Choose the Snippet you want to share.',
			choices: [new inquirer.Separator(' = 开头标识（空格才是选取） = ')].concat(filenameList),
			validate: function (answer) {
				if (answer.length < 1) {
					return 'You must choose the Snippet.';
				}
				return true;
			},
		},
		{
			type: 'checkbox',
			name: 'completion_more',
			message: 'Select your category.',
			choices: [
				new inquirer.Separator(' = 模块类型（空格才是选取） = '),
				{
					name: '@View',
				},
				{
					name: '@Tool',
				},
				{
					name: '@Service',
				},
				{
					name: '@Template',
				},
				{
					name: '@Other',
				},
			],
			validate: function (answer) {
				if (answer.length < 1) {
					return 'You must input select category.';
				}
				return true;
			},
		},
	];

	inquirer.prompt(questions).then((answers) => {
		if (answers.shareName) {
			shareTheSnippet(specFile, filePath, answers);
		} else {
			console.log('未选择，直接结束。');
		}
	});
}

function askQuestionsForKey(specFile, callback) {
	// 开始问问题
	const questions = [{
			type: 'input',
			name: 'completion_first',
			message: "What's your code key? (like toast)",
			validate: async function (answer) {
				if (answer.length < 1) {
					return 'You must input code key.';
				}
				let linkCache = await cache.getKeysCache(specFile);

				if (linkCache && linkCache.list) {
					let isIncludes = false;

					linkCache.list.forEach(element => {
						const array = element.split('+');
						const value = array[0];

						if (value === answer) {
							isIncludes = true;
						}
					});

					if (isIncludes) {
						return '联想词已存在，使用 asd u <word> 命令可以修改。';
					}
				}
				return true;
			},
		},
	];

	inquirer.prompt(questions).then((answers) => {
		callback(answers.completion_first);
	});
}

function shareTheSnippet(specFile, filePath, answers) {
	const filedir = path.join(filePath, answers.shareName[0]);

	try {
		// 读取AutoSnippet的占位配置
		const data = fs.readFileSync(filedir, 'utf8');
		if (data) {
			parseString(data, function (err, result) {
				if (result && result.plist && result.plist.dict
					&& result.plist.dict[0].string) {

					const array = result.plist.dict[0].string;
					if (array[0] === '') {
						askQuestionsForKey(specFile, function (completion_first) {
							array[0] = completion_first;
							createFromLocal(specFile, filedir, array, answers.completion_more);
						});
					} else if (triggerSymbol.hasTriggerPrefix(array[0]) || array[0].endsWith('@Moudle')) {
						console.log('这个文件已经是共享版本，不需要再处理。');
					} else {
						createFromLocal(specFile, filedir, array, answers.completion_more);
					}
				}
			});
		}
	} catch (err) {
		console.error(err);
	}
}

function createFromLocal(specFile, filedir, array, completion_more) {
	const xcodeLang = array[3];
	const languageShort = xcodeLang === 'Xcode.SourceCodeLanguage.Swift' ? 'swift' : 'objc';
	const prefix = triggerSymbol.TRIGGER_SYMBOL;
	const snippet = {
		identifier: 'AutoSnip_' + array[2],
		title: array[5],
		trigger: prefix + array[0],
		completion: prefix + array[0] + completion_more,
		summary: array[4],
		languageShort: languageShort,
		body: array[1].split('\n')
	};
	specRepository.saveSnippet(specFile, snippet, { syncRoot: true, installSingle: true });
	// 删除旧文件
	fs.unlink(filedir, (err, data) => {});
}

exports.shareCodeSnippets = shareCodeSnippets;
exports.shareWithPreset = shareWithPreset;