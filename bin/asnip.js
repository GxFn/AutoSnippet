#!/usr/bin/env node

const fs = require('fs');
// 读取输入命令
const inquirer = require('inquirer');
// 命令行工具
const commander = require('commander');
// 全局路径
const CMD_PATH = process.cwd();
const pjson = require('../package.json');
const findPath = require('./findPath.js');
const install = require('./install.js');
const create = require('./create.js');
const watch = require('./watch.js');
const cache = require('./cache.js');
const share = require('./share.js');
const init = require('./init.js');

function askQuestions(specFile) {
	// 开始问问题
	const questions = [{
			type: 'input',
			name: 'title',
			message: "What's your moudle name?",
			validate: function (answer) {
				if (answer.length < 1) {
					return 'You must input title.';
				}
				return true;
			},
		},
		{
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
		{
			type: 'input',
			name: 'summary',
			message: "What's your summary? (Optional)",
		},
		{
			type: 'input',
			name: 'link',
			message: "What's your link? (Optional)",
		},
		{
			type: 'confirm',
			name: 'header',
			message: 'Do you need to install header? ',
			default: false,
		}
	];

	inquirer.prompt(questions).then((answers) => {
		create.createCodeSnippets(specFile, answers, null);
	});
}

commander
	.version(pjson.version, '-v, --version')
	.description(pjson.description);

commander
	.command('init')
	.description('initialize the workspace, use it in the root directory of the Xcode project')
	.action(() => {
		init.initSpec().then(function () {
			console.log('init success.');
		});
	});

commander
	.command('i')
	.description('add the shared Snippet to the Xcode environment')
	.action(() => {
		findPath.findASSpecPath(CMD_PATH, function (specFile) {
			install.addCodeSnippets(specFile);
		});
	});

commander
	.command('s')
	.description('share local Xcode Snippet')
	.action(() => {
		findPath.findASSpecPath(CMD_PATH, function (specFile) {
			share.shareCodeSnippets(specFile);
		});
	});

commander
	.command('c')
	.description('create an Xcode Snippet, in the file directory marked with `// ACode` code')
	.action(() => {
		findPath.findASSpecPath(CMD_PATH, function (specFile) {
			askQuestions(specFile);
		});
	});

commander
	.command('u <word> [key] [value]')
	.description('modify the `// ACode` code corresponding to `word`')
	.action((word, key, value) => {
		findPath.findASSpecPath(CMD_PATH, function (specFile) {
			create.updateCodeSnippets(specFile, word, key, value);
		});
	});

commander
	.command('w')
	.description('recognize that Snippet automatically injects dependency header files')
	.action(() => {
		findPath.findASSpecPath(CMD_PATH, function (specFile) {
			install.addCodeSnippets(specFile);
			watch.watchFileChange(specFile);
		});
	});

commander.parse(process.argv);