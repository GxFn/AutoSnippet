#!/usr/bin/env node

/**
 * 职责：
 * - AutoSnippet CLI 入口（命令行 asd）
 * - 负责解析参数/路由子命令，并串联 init/root/install/create/share/update/watch 等能力
 *
 * 核心流程：
 * - commander 解析命令与全局参数（--preset/--yes）
 * - 读取/查找 spec（AutoSnippet.boxspec.json / AutoSnippetRoot.boxspec.json）
 * - 调用对应模块执行实际逻辑（create/install/share/watch/...）
 *
 * 核心方法：
 * - ensureRootMarker(dir): 创建/确保 AutoSnippetRoot.boxspec.json（root 标记）
 * - loadPresetConfig(presetPath): 读取预置输入 JSON（用于非交互）
 * - getSpecFile(callback): 向上查找 AutoSnippet.boxspec.json
 *
 * 主要命令：
 * - setup / init / root
 * - install(i) / create(c) / share(s) / update(u) / watch(w)
 */

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
const install = require('../lib/snippet/snippetInstaller.js');
const create = require('./create.js');
const watch = require('../lib/watch/fileWatcher.js');
const cache = require('../lib/infra/cacheStore.js');
const share = require('./share.js');
const init = require('./init.js');
const config = require('../lib/infra/paths.js');
const spmDepMapUpdater = require('../lib/spm/spmDepMapUpdater.js');
const { execSync } = require('child_process');

function ensureSpmDepMapFile(projectRootDir) {
	const mapPath = path.join(projectRootDir, 'AutoSnippet.spmmap.json');
	const oldPath = path.join(projectRootDir, 'AutoSnippet.spmdmap.json');
	try {
		fs.accessSync(mapPath, fs.constants.F_OK);
		return { ok: true, created: false, path: mapPath };
	} catch (_err) {
		try {
			// 迁移：如果旧文件存在，优先重命名到新文件名
			try {
				fs.accessSync(oldPath, fs.constants.F_OK);
				fs.renameSync(oldPath, mapPath);
				return { ok: true, created: false, migrated: true, path: mapPath };
			} catch {
				// ignore
			}

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

function ensureRootMarker(dir) {
	const rootMarkerPath = path.join(dir, 'AutoSnippetRoot.boxspec.json');
	try {
		fs.accessSync(rootMarkerPath, fs.constants.F_OK);
		const m = ensureSpmDepMapFile(dir);
		return { ok: true, created: false, path: rootMarkerPath, map: m };
	} catch (_err) {
		try {
			fs.writeFileSync(rootMarkerPath, JSON.stringify({
				schemaVersion: 2,
				kind: 'root',
				root: true,
				description: 'This file marks the project root directory for AutoSnippet',
				skills: {
					dir: 'skills',
					format: 'md+frontmatter',
					index: 'skills/index.json',
				},
				list: []
			}, null, 4), 'utf8');
			const m = ensureSpmDepMapFile(dir);
			return { ok: true, created: true, path: rootMarkerPath, map: m };
		} catch (writeErr) {
			return { ok: false, created: false, path: rootMarkerPath, error: writeErr.message };
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
		console.warn(`⚠️  读取预置输入失败: ${presetPath}`);
		console.warn(err && err.message ? err.message : err);
		return null;
	}
}

function getGlobalOptions() {
	try {
		const opts = commander.opts ? commander.opts() : {};
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
 * 先查找包含 // autosnippet:code 标记的文件，找到后再询问
 */
async function findAndAsk(specFile) {
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
	
	// 显示找到的文件
	console.log(`找到 ${filesWithACode.length} 个包含 // autosnippet:code 标记的文件：\n`);
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
	.option('--preset <path>', 'preset config JSON path (non-interactive inputs)')
	.option('-y, --yes', 'non-interactive mode: require preset/inputs, fail fast if missing');

commander
	.command('init')
	.description('initialize the workspace, use it in the root directory of the Xcode project')
	.action(() => {
		init.initSpec().then(function () {
			console.log('init success.');
		});
	});

commander
	.command('install')
	.alias('i')
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
	.command('share')
	.alias('s')
	.description('share local Xcode Snippet')
	.action(() => {
		getSpecFile(function (specFile) {
			const { preset: presetPath, yes } = getGlobalOptions();
			const preset = loadPresetConfig(presetPath);
			const sharePreset = preset && preset.share;
			if (sharePreset) {
				const ok = share.shareWithPreset(specFile, sharePreset);
				if (!ok) {
					console.error('❌ 预置分享失败，请检查 share 预置输入和本地 snippet 文件。');
				}
				return;
			}

			if (yes) {
				console.error('❌ share 在 --yes 模式下需要预置输入。');
				console.error('请使用：asd --preset <preset.json> share');
				console.error('或设置环境变量 ASD_PRESET/ASD_TEST_PRESET 指向 preset.json');
				return;
			}

			share.shareCodeSnippets(specFile);
		});
	});

commander
	.command('create')
	.alias('c')
	.description('create an Xcode Snippet, in the file directory marked with `// autosnippet:code`')
	.option('--clipboard', 'create snippet from clipboard content (no marker needed)')
	.option('-p, --paste', 'create snippet from clipboard content (alias of --clipboard)')
	.option('--lang <objc|swift>', 'clipboard language hint (default: objc)')
	.action((cmd) => {
		getSpecFile(function (specFile) {
			const { preset: presetPath, yes } = getGlobalOptions();
			const preset = loadPresetConfig(presetPath);
			const createPreset = preset && preset.create;
			const useClipboard = !!(cmd && (cmd.clipboard || cmd.paste));
			const clipLang = (cmd && cmd.lang) ? String(cmd.lang).toLowerCase() : 'objc';

			if (createPreset) {
				// 支持通过环境变量覆盖选中文件（方便测试脚本动态指定）
				const selectedFilePath = process.env.ASD_ACODE_FILE || createPreset.selectedFilePath || null;
				const answers = {
					title: createPreset.title,
					completion_first: createPreset.completion_first,
					completion_more: createPreset.completion_more,
					summary: createPreset.summary,
					link: createPreset.link,
					header: !!createPreset.header,
				};
				if (!answers.title || !answers.completion_first || !answers.completion_more) {
					console.error('❌ 预置输入 create 字段不完整：需要 title / completion_first / completion_more');
					return;
				}
				if (useClipboard) {
					const text = readClipboardText();
					create.createCodeSnippetsFromText(specFile, answers, text, { language: clipLang });
					return;
				}
				if (!selectedFilePath) {
					// 兜底：尝试自动扫描当前目录（兼容旧行为）
					findAndAsk(specFile);
					return;
				}
				// 直接走创建逻辑，跳过 inquirer 交互
				create.createCodeSnippets(specFile, answers, null, selectedFilePath);
				return;
			}

			if (yes) {
				console.error('❌ create 在 --yes 模式下需要预置输入（至少包含 title/completion_first/completion_more）。');
				console.error('请使用：asd --preset <preset.json> create');
				console.error('或设置环境变量 ASD_PRESET/ASD_TEST_PRESET 指向 preset.json');
				return;
			}

			if (useClipboard) {
				// 复用原有问题列表，但回调写入剪贴板内容
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
							{ name: '@View' },
							{ name: '@Tool' },
							{ name: '@Service' },
							{ name: '@Template' },
							{ name: '@Other' },
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
						message: 'Do you need to install header? (clipboard mode will ignore headerVersion) ',
						default: false,
					}
				];

				inquirer.prompt(questions).then((answers) => {
					const text = readClipboardText();
					create.createCodeSnippetsFromText(specFile, answers, text, { language: clipLang });
				});
				return;
			}

			findAndAsk(specFile);
		});
	});

commander
	.command('spm-map')
	.alias('spmmap')
	.description('update AutoSnippet.spmmap.json by scanning Package.swift files')
	.option('--dry-run', 'do not write file, just report')
	.option('--overwrite', 'overwrite existing entries when conflicts occur')
	.option('--aggressive', 'infer package name from url/path when .package has no name:')
	.action(async (cmd) => {
		const projectRoot = await findPath.findProjectRoot(CMD_PATH);
		if (!projectRoot) {
			console.error('未找到项目根目录（AutoSnippetRoot.boxspec.json）。');
			return;
		}
		const mapRes = ensureSpmDepMapFile(projectRoot);
		if (!mapRes.ok) {
			console.error(`创建/检查 AutoSnippet.spmmap.json 失败: ${mapRes.error || '未知错误'}`);
			return;
		}
		const res = spmDepMapUpdater.updateSpmDepMap(projectRoot, {
			dryRun: !!(cmd && cmd.dryRun),
			allowOverwrite: !!(cmd && cmd.overwrite),
			aggressive: !!(cmd && cmd.aggressive),
		});
		if (!res.ok) {
			console.error('更新 AutoSnippet.spmmap.json 失败');
			return;
		}
		if (cmd && cmd.dryRun) {
			console.log(`ℹ️  (dry-run) 扫描 Package.swift 数量: ${res.scanned}`);
			console.log(JSON.stringify(res.map, null, 4));
			return;
		}
		if (res.changed) {
			console.log(`✅ 已更新 SPM 映射文件: ${res.path}（扫描 Package.swift: ${res.scanned}）`);
		} else {
			console.log(`ℹ️  SPM 映射文件无变化: ${res.path}（扫描 Package.swift: ${res.scanned}）`);
		}
	});

commander
	.command('update <word> [key] [value]')
	.alias('u')
	.description('modify the snippet corresponding to `word`')
	.action((word, key, value) => {
		getSpecFile(function (specFile) {
			create.updateCodeSnippets(specFile, word, key, value);
		});
	});

commander
	.command('watch')
	.alias('w')
	.description('recognize that Snippet automatically injects dependency header files')
	.option('--path <relativeDir>', 'only watch files under this relative directory (from project root)')
	.option('--file <filePath>', 'only watch a single file (absolute or relative to project root)')
	.option('--ext <exts>', 'only watch specific extensions, comma-separated (e.g. m,h,swift)')
	.option('--quiet', 'reduce watch logs')
	.option('--summary', 'print watch summary on exit')
	.option('-d, --duration <seconds>', 'exit after duration seconds (for E2E tests)')
	.option('--once', 'exit after first matched injection event (for E2E tests)')
	.action(async (cmd) => {
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

		// ✅ 确保 AutoSnippet.spmmap.json 存在（跨包 product/package 依赖补齐需要）
		const mapRes = ensureSpmDepMapFile(projectRoot);
		if (mapRes && mapRes.ok && mapRes.created) {
			console.log(`✅ 已创建 SPM 映射文件: ${mapRes.path}`);
		}
		// ✅ watch 启动前自动更新映射（扫描 Package.swift 补全 products/packages）
		try {
			// 激进模式：允许从 .package(url/path...) 推断 packageName，减少手动维护成本
			const upd = spmDepMapUpdater.updateSpmDepMap(projectRoot, { dryRun: false, allowOverwrite: false, aggressive: true });
			if (upd && upd.ok && upd.changed) {
				console.log(`✅ 已自动更新 SPM 映射文件: ${upd.path}（扫描 Package.swift: ${upd.scanned}）`);
			}
		} catch {
			// ignore
		}
		
		// ✅ 先聚合子模块配置到根配置文件，确保存在 list 字段（避免 root 标记文件为空导致崩溃）
		try {
			await init.mergeSubSpecs(rootSpecFile);
		} catch (err) {
			// 继续执行（降级）
		}

		// 先安装 snippets
		install.addCodeSnippets(rootSpecFile);
		// 在根目录启动监听
		const options = {};
		let watcher = null;

		// once：发生一次事件后退出（给 watcher 一个机会完成写入）
		if (cmd && cmd.once) {
			let closed = false;
			options.onEvent = () => {
				if (closed) return;
				closed = true;
				setTimeout(() => {
					try { watcher && watcher.close && watcher.close(); } catch {}
					process.exit(0);
				}, 400);
			};
		}

		// 透传 watch 过滤/输出选项（相对路径以 projectRoot 为基准）
		if (cmd && cmd.path) options.pathPrefix = cmd.path;
		if (cmd && cmd.file) options.file = path.isAbsolute(cmd.file) ? cmd.file : path.join(projectRoot, cmd.file);
		if (cmd && cmd.ext) options.exts = String(cmd.ext).split(',').map(s => s.trim()).filter(Boolean);
		if (cmd && cmd.quiet) options.quiet = true;
		if (cmd && cmd.summary) options.summary = true;

		watcher = watch.watchFileChange(rootSpecFile, projectRoot, options);

		// duration：到点退出
		if (cmd && cmd.duration) {
			const sec = Number(cmd.duration);
			if (!Number.isNaN(sec) && sec > 0) {
				setTimeout(() => {
					try { watcher && watcher.close && watcher.close(); } catch {}
					process.exit(0);
				}, sec * 1000);
			}
		}
	});

commander
	.command('root')
	.description('mark current directory as project root by creating AutoSnippetRoot.boxspec.json')
	.action(() => {
		const res = ensureRootMarker(CMD_PATH);
		if (!res.ok) {
			console.error(`创建根目录标记文件失败: ${res.error || '未知错误'}`);
			return;
		}
		if (res.created) {
			console.log(`已创建根目录标记文件: ${res.path}`);
		} else {
			console.log(`根目录标记文件已存在: ${res.path}`);
		}
		if (res.map && res.map.ok && res.map.created) {
			console.log(`✅ 已创建 SPM 映射文件: ${res.map.path}`);
		}
	});

commander
	.command('setup')
	.description('one-shot setup: run init + create root marker (recommended in project root)')
	.action(async () => {
		await init.initSpec();
		const res = ensureRootMarker(CMD_PATH);
		if (!res.ok) {
			console.error(`❌ setup 失败：创建根目录标记文件失败: ${res.error || '未知错误'}`);
			return;
		}
		console.log(`✅ setup 完成：AutoSnippet.boxspec.json 已初始化；root 标记文件: ${res.path}`);
		if (res.map && res.map.ok && res.map.created) {
			console.log(`✅ 已创建 SPM 映射文件: ${res.map.path}`);
		}
	});

commander.addHelpText('after', `

Examples:
  asd setup               # 初始化 + 标记项目根目录
  asd install             # 等价于 asd i
  asd create              # 等价于 asd c
  asd share               # 等价于 asd s
  asd watch               # 等价于 asd w

Notes:
  - 老命令仍可用：i/c/s/u/w 只是别名，不会破坏现有脚本。
`);

commander.parse(process.argv);