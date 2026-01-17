#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
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
const config = require('./config.js');

// 获取配置文件路径
function getSpecFile(callback) {
	// 向上查找 AutoSnippet.boxspec.json 配置文件
	findPath.findASSpecPath(CMD_PATH, callback);
}

/**
 * 先查找包含 // ACode 标记的文件，找到后再询问
 */
async function findAndAsk(specFile) {
	console.log('正在查找包含 // ACode 标记的文件...\n');
	
	const filesWithACode = await create.findFilesWithACode(CMD_PATH);
	
	if (filesWithACode.length === 0) {
		console.log('未找到包含 // ACode 标记的文件。');
		console.log('请在代码中添加 // ACode 标记，例如：');
		console.log('');
		console.log('// ACode');
		console.log('UIView *view = [[UIView alloc] init];');
		console.log('// ACode');
		console.log('');
		return;
	}
	
	// 显示找到的文件
	console.log(`找到 ${filesWithACode.length} 个包含 // ACode 标记的文件：\n`);
	filesWithACode.forEach((file, index) => {
		console.log(`  ${index + 1}. ${file.name} (第 ${file.line} 行)`);
	});
	console.log('');
	
	// 如果只有一个文件，直接使用；如果有多个，让用户选择
	let selectedFile = null;
	if (filesWithACode.length === 1) {
		selectedFile = filesWithACode[0].path;
		console.log(`将使用文件: ${filesWithACode[0].name}\n`);
	} else {
		// 多个文件时，让用户选择（这里简化处理，使用第一个）
		// 可以后续扩展为让用户选择
		selectedFile = filesWithACode[0].path;
		console.log(`将使用第一个文件: ${filesWithACode[0].name}\n`);
	}
	
	// 找到标记后，开始询问
	askQuestions(specFile, selectedFile);
}

function askQuestions(specFile, selectedFilePath) {
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
		// 将选中的文件路径传递给 createCodeSnippets
		create.createCodeSnippets(specFile, answers, null, selectedFilePath);
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
	.action(async () => {
		// ✅ 使用异步版本查找配置文件
		const specFile = await findPath.findASSpecPathAsync(CMD_PATH);
		if (!specFile) {
			console.error('❌ 安装失败：未找到 AutoSnippet.boxspec.json 配置文件');
			console.error('请先执行 asd init 初始化工作空间');
			return;
		}
		// ✅ 先聚合子模块配置到主配置文件
		await init.mergeSubSpecs(specFile);
		// 然后安装 snippets
		const result = install.addCodeSnippets(specFile);
		
		if (result && result.success) {
			if (result.count) {
				console.log(`✅ 安装成功：已安装 ${result.count} 个代码片段`);
			} else if (result.successCount !== undefined) {
				const total = result.total || 0;
				const success = result.successCount || 0;
				const error = result.errorCount || 0;
				if (error === 0) {
					console.log(`✅ 安装成功：已安装 ${success} 个代码片段`);
				} else {
					console.log(`⚠️  安装完成：成功 ${success} 个，失败 ${error} 个，共 ${total} 个`);
				}
			} else {
				console.log('✅ 安装成功');
			}
		} else {
			console.error('❌ 安装失败：', result?.error || '未知错误');
		}
	});

commander
	.command('s')
	.description('share local Xcode Snippet')
	.action(() => {
		getSpecFile(function (specFile) {
			share.shareCodeSnippets(specFile);
		});
	});

commander
	.command('c')
	.description('create an Xcode Snippet, in the file directory marked with `// ACode` code')
	.action(() => {
		getSpecFile(function (specFile) {
			findAndAsk(specFile);
		});
	});

commander
	.command('u <word> [key] [value]')
	.description('modify the `// ACode` code corresponding to `word`')
	.action((word, key, value) => {
		getSpecFile(function (specFile) {
			create.updateCodeSnippets(specFile, word, key, value);
		});
	});

commander
	.command('w')
	.description('recognize that Snippet automatically injects dependency header files')
	.action(async () => {
		// ✅ 从执行位置向上查找 AutoSnippetRoot.boxspec.json，找到根目录
		const projectRoot = await findPath.findProjectRoot(CMD_PATH);
		
		if (!projectRoot) {
			console.error('未找到项目根目录（AutoSnippetRoot.boxspec.json）。');
			console.error('请先使用 asd root 命令在项目根目录创建根目录标记文件。');
			return;
		}
		
		console.log(`[asd w] 项目根目录: ${projectRoot}`);
		
		// ✅ 使用根目录的 AutoSnippetRoot.boxspec.json 作为配置文件
		const rootSpecFile = path.join(projectRoot, findPath.ROOT_MARKER_NAME);
		console.log(`[asd w] 使用配置文件: ${rootSpecFile}`);
		
		// 先安装 snippets
		install.addCodeSnippets(rootSpecFile);
		// 在根目录启动监听
		watch.watchFileChange(rootSpecFile, projectRoot);
	});

commander
	.command('root')
	.description('mark current directory as project root by creating AutoSnippetRoot.boxspec.json')
	.action(() => {
		const rootMarkerPath = path.join(CMD_PATH, 'AutoSnippetRoot.boxspec.json');
		
		try {
			// 检查文件是否已存在
			fs.accessSync(rootMarkerPath, fs.constants.F_OK);
			console.log(`根目录标记文件已存在: ${rootMarkerPath}`);
		} catch (err) {
			// 文件不存在，创建它
			try {
				// 创建一个空的标记文件
				fs.writeFileSync(rootMarkerPath, JSON.stringify({
					root: true,
					description: 'This file marks the project root directory for AutoSnippet'
				}, null, 2), 'utf8');
				console.log(`已创建根目录标记文件: ${rootMarkerPath}`);
			} catch (writeErr) {
				console.error(`创建根目录标记文件失败: ${writeErr.message}`);
			}
		}
	});

commander.parse(process.argv);