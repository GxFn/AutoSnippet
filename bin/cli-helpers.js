const fs = require('fs');
const path = require('path');
const Paths = require('../lib/infrastructure/config/Paths.js');

function createCliHelpers({ CMD_PATH, findPath, cache, create, inquirer, defaults, commander, execSync }) {
	function ensureSpmDepMapFile(projectRootDir) {
		const knowledgeDir = Paths.getProjectKnowledgePath(projectRootDir);
		if (!fs.existsSync(knowledgeDir)) {
			try { fs.mkdirSync(knowledgeDir, { recursive: true }); } catch (e) {}
		}
		const mapPath = path.join(knowledgeDir, defaults.SPMMAP_FILENAME);
		
		try {
			fs.accessSync(mapPath, fs.constants.F_OK);
			return { ok: true, created: false, path: mapPath };
		} catch (_err) {
			try {
				const template = {
					schemaVersion: 1,
					packages: {},
					products: {}
				};
				fs.writeFileSync(mapPath, JSON.stringify(template, null, 4), 'utf8');
				return { ok: true, created: true, path: mapPath };
			} catch (writeErr) {
				return { ok: false, created: false, path: mapPath, error: writeErr.message };
			}
		}
	}

	function loadPresetConfig(presetPathFromCli) {
		const presetPath = presetPathFromCli || process.env.ASD_TEST_PRESET || process.env.ASD_PRESET;
		if (!presetPath) return null;
		try {
			const content = fs.readFileSync(presetPath, 'utf8');
			if (!content) return null;
			return JSON.parse(content);
		} catch (err) {
			console.warn(`⚠️\t 读取预置输入失败: ${presetPath}`);
			console.warn(err && err.message ? err.message : err);
			return null;
		}
	}

	function getGlobalOptions(subcommand) {
		try {
			// 子命令 action 内 commander.opts() 可能只含子命令选项，需从父级取 --preset / --yes
			const opts = (subcommand && subcommand.parent && subcommand.parent.opts)
				? subcommand.parent.opts()
				: (commander.opts ? commander.opts() : {});
			return {
				preset: opts.preset,
				yes: !!opts.yes,
			};
		} catch {
			return { preset: null, yes: false };
		}
	}

	function readClipboardText() {
		try {
			// macOS
			if (process.platform === 'darwin') {
				return execSync('pbpaste', { encoding: 'utf8' });
			}
			// Linux（需要 xclip）
			if (process.platform === 'linux') {
				return execSync('xclip -selection clipboard -o', { encoding: 'utf8' });
			}
			// Windows（PowerShell）
			if (process.platform === 'win32') {
				return execSync('powershell -Command Get-Clipboard', { encoding: 'utf8' });
			}
			return '';
		} catch {
			return '';
		}
	}

	// 获取配置文件路径
	function getSpecFile(callback) {
		// 向上查找 AutoSnippet.boxspec.json 配置文件
		findPath.findASSpecPath(CMD_PATH, callback);
	}

	/**
	 * 先查找包含 // autosnippet:code 标记的文件；useAi 时用 AI 提取并创建，否则走交互问答
	 */
	async function findAndAsk(specFile, projectRoot, useAi) {
		console.log('正在查找包含 // autosnippet:code 标记的文件...\n');

		const filesWithACode = await create.findFilesWithACode(CMD_PATH);

		if (filesWithACode.length === 0) {
			console.log('未找到包含 // autosnippet:code 标记的文件。');
			console.log('请在代码中添加 // autosnippet:code 标记，例如：');
			console.log('');
			console.log('// autosnippet:code');
			console.log('UIView *view = [[UIView alloc] init];');
			console.log('// autosnippet:code');
			console.log('');
			return;
		}

		console.log(`找到 ${filesWithACode.length} 个包含 // autosnippet:code 标记的文件：\n`);
		filesWithACode.forEach((file, index) => {
			console.log(`\t ${index + 1}. ${file.name} (第 ${file.line} 行)`);
		});
		console.log('');

		let selectedFile = null;
		if (filesWithACode.length === 1) {
			selectedFile = filesWithACode[0].path;
			console.log(`将使用文件: ${filesWithACode[0].name}\n`);
		} else {
			selectedFile = filesWithACode[0].path;
			console.log(`将使用第一个文件: ${filesWithACode[0].name}\n`);
		}

		if (useAi && projectRoot) {
			try {
				console.log('AI 正在分析代码并创建 snippet...');
				await create.createFromFileWithAi(projectRoot, specFile, selectedFile);
			} catch (err) {
				console.error('❌ 创建失败:', err.message);
			}
			return;
		}

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

	return {
		ensureSpmDepMapFile,
		loadPresetConfig,
		getGlobalOptions,
		readClipboardText,
		getSpecFile,
		findAndAsk,
		askQuestions,
	};
}

module.exports = {
	createCliHelpers,
};
