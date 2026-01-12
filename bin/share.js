#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const parseString = require('xml2js').parseString;
// 读取输入命令
const inquirer = require('inquirer');
// 全局路径
const USER_HOME 	= process.env.HOME || process.env.USERPROFILE;
const SNIPPETS_PATH = USER_HOME + '/Library/Developer/Xcode/UserData/CodeSnippets';

const create = require('./create.js');
const cache = require('./cache.js');

function shareCodeSnippets(specFile) {
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
					} else if (array[0].endsWith('@Moudle')) {
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
	const snippet = {
		'{identifier}': 'AutoSnip_' + array[2],
		'{title}': array[5],
		'{completionKey}': array[0],
		'{completion}': '@' + array[0] + completion_more + '@Moudle',
		'{summary}': array[4],
		'{language}': array[3],
		'{content}': array[1].split('\n')
	};
	create.saveFromFile(specFile, snippet);
	// 删除旧文件
	fs.unlink(filedir, (err, data) => {});
}

exports.shareCodeSnippets = shareCodeSnippets;