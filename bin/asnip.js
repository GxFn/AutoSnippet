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
const ui = require('./ui.js');
const config = require('../lib/infra/paths.js');
const spmDepMapUpdater = require('../lib/spm/spmDepMapUpdater.js');
const { execSync } = require('child_process');

function ensureSpmDepMapFile(projectRootDir) {
	const knowledgeDir = path.join(projectRootDir, 'Knowledge');
	if (!fs.existsSync(knowledgeDir)) {
		try { fs.mkdirSync(knowledgeDir, { recursive: true }); } catch (e) {}
	}
	const mapPath = path.join(knowledgeDir, 'AutoSnippet.spmmap.json');
	
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
				recipes: {
					dir: 'Knowledge/recipes',
					format: 'md+frontmatter',
					index: 'Knowledge/recipes/index.json',
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
		console.warn(`⚠️	 读取预置输入失败: ${presetPath}`);
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
		console.log(`	 ${index + 1}. ${file.name} (第 ${file.line} 行)`);
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
					console.log(`⚠️	安装完成：成功 ${success} 个，失败 ${error} 个，共 ${total} 个`);
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
	.description('create an Xcode Snippet (AI mode: from file // as:code or clipboard, same as web)')
	.option('--clipboard', 'create snippet from clipboard content using AI')
	.option('-p, --paste', 'alias of --clipboard')
	.option('--path <relativePath>', 'for clipboard: path for header resolution (e.g. Sources/Mod/Foo.m)')
	.option('--lang <objc|swift>', 'clipboard language hint (default: objc)')
	.option('--no-ai', 'use legacy interactive/preset mode (no AI)')
	.option('--preset <path>', 'preset config JSON path (same as global --preset)')
	.option('-y, --yes', 'non-interactive mode (same as global -y)')
	.action(async (cmd) => {
		// Commander: --no-ai 会设置 cmd.ai = false，不是 cmd.noAi
		const useAi = !(cmd && cmd.ai === false);
		getSpecFile(async (specFile) => {
			// 优先用本子命令的 --preset/--yes，再回退到全局（便于 asd create --no-ai --yes --preset <path>）
			const globalOpts = getGlobalOptions(cmd);
			const presetPath = (cmd && cmd.preset) != null ? cmd.preset : globalOpts.preset;
			const yes = (cmd && cmd.yes) != null ? !!cmd.yes : globalOpts.yes;
			const preset = loadPresetConfig(presetPath);
			const createPreset = preset && preset.create;
			const useClipboard = !!(cmd && (cmd.clipboard || cmd.paste));
			const clipLang = (cmd && cmd.lang) ? String(cmd.lang).toLowerCase() : 'objc';
			const projectRoot = specFile ? await findPath.findProjectRoot(path.dirname(specFile)) : null;

			if (!useAi && createPreset) {
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
					findAndAsk(specFile, projectRoot, false);
					return;
				}
				create.createCodeSnippets(specFile, answers, null, selectedFilePath);
				return;
			}

			if (!useAi && yes) {
				console.error('❌ create 在 --yes 模式下需要预置输入，或去掉 --no-ai 使用 AI 模式。');
				return;
			}

			if (useAi && useClipboard) {
				const text = readClipboardText();
				if (!text || !text.trim()) {
					console.error('❌ 剪贴板为空');
					return;
				}
				if (!projectRoot) {
					console.error('❌ 未找到项目根目录（AutoSnippetRoot.boxspec.json）');
					return;
				}
				const relativePath = (cmd && cmd.path) ? String(cmd.path).trim() : null;
				try {
					const AiFactory = require('../lib/ai/AiFactory');
					const headerResolution = require('../lib/ai/headerResolution');
					const ai = AiFactory.create();
					console.log('AI 正在分析剪贴板内容...');
					const result = await ai.summarize(text, clipLang);
					if (result && result.error) {
						console.error('❌ AI 解析失败:', result.error);
						return;
					}
					if (relativePath) {
						const resolved = await headerResolution.resolveHeadersForText(projectRoot, relativePath, text);
						result.headers = Array.from(new Set([...(result.headers || []), ...resolved.headers]));
						result.headerPaths = resolved.headerPaths;
						result.moduleName = resolved.moduleName;
					}
					const rootSpecPath = await findPath.getRootSpecFilePath(specFile);
					const rootSpecPathResolved = rootSpecPath || path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
					await create.createFromExtracted(projectRoot, rootSpecPathResolved, result);
				} catch (err) {
					console.error('❌ 创建失败:', err.message);
				}
				return;
			}

			if (useAi && !useClipboard) {
				findAndAsk(specFile, projectRoot, true);
				return;
			}

			if (!useAi && useClipboard) {
				const questions = [{
					type: 'input', name: 'title', message: "What's your moudle name?",
					validate: (a) => (a.length < 1 ? 'You must input title.' : true),
				}, {
					type: 'input', name: 'completion_first', message: "What's your code key? (like toast)",
					validate: async (answer) => {
						if (answer.length < 1) return 'You must input code key.';
						const linkCache = await cache.getKeysCache(specFile);
						if (linkCache && linkCache.list && linkCache.list.some(el => (el.split('+')[0]) === answer)) {
							return '联想词已存在，使用 asd u <word> 可以修改。';
						}
						return true;
					},
				}, {
					type: 'checkbox', name: 'completion_more', message: 'Select your category.',
					choices: [
						new inquirer.Separator(' = 模块类型 = '),
						{ name: '@View' }, { name: '@Tool' }, { name: '@Service' }, { name: '@Template' }, { name: '@Other' },
					],
					validate: (a) => (a.length < 1 ? 'You must select category.' : true),
				}, { type: 'input', name: 'summary', message: "What's your summary? (Optional)" },
				{ type: 'input', name: 'link', message: "What's your link? (Optional)" },
				{ type: 'confirm', name: 'header', message: 'Do you need to install header?', default: false },
				];
				inquirer.prompt(questions).then((answers) => {
					const text = readClipboardText();
					create.createCodeSnippetsFromText(specFile, answers, text, { language: clipLang });
				});
				return;
			}

			findAndAsk(specFile, projectRoot, false);
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
		const res = await spmDepMapUpdater.updateSpmDepMap(projectRoot, {
			dryRun: !!(cmd && cmd.dryRun),
			allowOverwrite: !!(cmd && cmd.overwrite),
			aggressive: !!(cmd && cmd.aggressive),
		});
		if (!res.ok) {
			console.error('更新 AutoSnippet.spmmap.json 失败');
			return;
		}
		if (cmd && cmd.dryRun) {
			console.log(`ℹ️	(dry-run) 扫描 Package.swift 数量: ${res.scanned}`);
			console.log(JSON.stringify(res.map, null, 4));
			return;
		}
		if (res.changed) {
			console.log(`✅ 已更新 SPM 映射文件: ${res.path}（扫描 Package.swift: ${res.scanned}）`);
		} else {
			console.log(`ℹ️	SPM 映射文件无变化: ${res.path}（扫描 Package.swift: ${res.scanned}）`);
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
			const upd = await spmDepMapUpdater.updateSpmDepMap(projectRoot, { dryRun: false, allowOverwrite: false, aggressive: true });
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
	.command('ui')
	.description('launch the AutoSnippet Dashboard')
	.option('-p, --port <number>', 'port to run the dashboard on', '3000')
	.option('-b, --build', 'force rebuild dashboard frontend before launch')
	.action(async (cmd) => {
		const projectRoot = await findPath.findProjectRoot(CMD_PATH);
		if (!projectRoot) {
			console.error('未找到项目根目录（AutoSnippetRoot.boxspec.json）。');
			return;
		}
		const forceBuild = !!(cmd.build || process.env.ASD_UI_BUILD === '1' || process.env.ASD_UI_REBUILD === '1');
		ui.launch(projectRoot, cmd.port, { forceBuild });
	});

commander
	.command('ai-test')
	.description('test current AI provider connectivity (uses .env or boxspec in project root)')
	.action(async () => {
		const projectRoot = await findPath.findProjectRoot(CMD_PATH) || CMD_PATH;
		const AiFactory = require('../lib/ai/AiFactory');
		const config = AiFactory.getConfigSync(projectRoot);
		console.log(`当前配置: provider=${config.provider}, model=${config.model}`);
		try {
			const ai = await AiFactory.getProvider(projectRoot);
			const reply = await ai.chat('Reply with exactly one word: OK.');
			console.log('✅ 当前 AI 可用');
			console.log('   回复:', (reply || '').trim().slice(0, 80));
		} catch (err) {
			console.error('❌ AI 测试失败:', err.message);
			console.log('提示: 检查 .env 中对应 API Key 与 ASD_AI_PROVIDER/ASD_AI_MODEL，或参阅文档「Foundation-AI提供商免费Key申请与测试.md」');
		}
	});

commander
	.command('ai-scan [target]')
	.alias('ais')
	.description('AI scan specific SPM target(s) and generate knowledge candidates')
	.option('-a, --all', 'scan all targets')
	.option('-b, --batch <number>', 'scan in batches of N targets', parseInt)
	.action(async (targetName, options) => {
		const projectRoot = await findPath.findProjectRoot(CMD_PATH);
		if (!projectRoot) {
			console.error('未找到项目根目录（AutoSnippetRoot.boxspec.json）。');
			return;
		}

		const targetScanner = require('../lib/spm/targetScanner');
		const AiFactory = require('../lib/ai/AiFactory');
		const candidateService = require('../lib/ai/candidateService');
		
		const allTargets = await targetScanner.listAllTargets(projectRoot);
		let targetsToScan = [];

		if (options.all) {
			targetsToScan = allTargets;
		} else if (options.batch) {
			// 大项目分批次扫描：只扫描前 N 个尚未存在候选内容的 Target
			const existingCandidates = candidateService.listCandidates(projectRoot);
			targetsToScan = allTargets
				.filter(t => !existingCandidates[t.name])
				.slice(0, options.batch);
		} else if (targetName) {
			const target = allTargets.find(t => t.name === targetName);
			if (target) {
				targetsToScan = [target];
			} else {
				console.error(`未找到 Target: ${targetName}`);
				return;
			}
		} else {
			console.error('请指定 target 名称，或使用 --all / --batch 选项。');
			return;
		}

		if (targetsToScan.length === 0) {
			console.log('没有需要扫描的 Target。');
			return;
		}

		console.log(`准备扫描 ${targetsToScan.length} 个 Target...`);
		const ai = await AiFactory.getProvider(projectRoot);

		for (const target of targetsToScan) {
			console.log(`\n[${target.name}] 正在读取源代码...`);
			const files = await targetScanner.getTargetFilesContent(target);
			if (files.length === 0) {
				console.warn(`[${target.name}] 未找到源代码文件，跳过。`);
				continue;
			}
			// 命令行显示本次扫描的真实文件列表
			const relPaths = files.map(f => path.relative(projectRoot, f.path).replace(/\\/g, '/'));
			console.log(`[${target.name}] 本次扫描的文件 (${relPaths.length}):`);
			relPaths.forEach(p => console.log(`  - ${p}`));

			console.log(`[${target.name}] 正在将以上 ${files.length} 个文件一并发送给 AI 分析...`);
			try {
				const results = await ai.extractRecipes(target.name, files);
				if (Array.isArray(results)) {
					await candidateService.saveCandidates(projectRoot, target.name, results);
					console.log(`✅ [${target.name}] 扫描完成，发现 ${results.length} 个候选内容。`);
				} else {
					console.error(`❌ [${target.name}] AI 解析失败:`, results);
				}
			} catch (err) {
				console.error(`❌ [${target.name}] 扫描出错:`, err.message);
			}
		}

		console.log('\n✨ 所有扫描任务已完成！');
		console.log('提示: 请运行 `asd ui` 在 Dashboard 的 "Candidates" 页面进行审核。');
	});

commander
	.command('search [keyword]')
	.alias('s')
	.description('search snippets and recipes (keyword or semantic)')
	.option('-m, --semantic', 'use semantic search (requires asd embed)', false)
	.action(async (keyword, options) => {
		const projectRoot = await findPath.findProjectRoot(CMD_PATH);
		if (!projectRoot) {
			console.error('未找到项目根目录（AutoSnippetRoot.boxspec.json）。');
			return;
		}

		if (options.semantic) {
			if (!keyword) {
				console.error('使用语义搜索时必须提供关键词。');
				return;
			}
			console.log(`\n🧠 正在进行语义搜索: "${keyword}"...\n`);
			
			const VectorStore = require('../lib/ai/vectorStore');
			const AiFactory = require('../lib/ai/AiFactory');
			const store = new VectorStore(projectRoot);
			const ai = await AiFactory.getProvider(projectRoot);
			
			if (!ai) {
				console.error('未配置 AI 密钥。');
				return;
			}

			const queryVector = await ai.embed(keyword);
			const results = store.search(queryVector, 5);

			if (results.length === 0) {
				console.log('未找到语义相关的知识点。请确保已运行 asd embed 构建索引。');
				return;
			}

			console.log(`--- 语义相关知识 (Semantic Match) ---`);
			results.forEach((res, i) => {
				const score = (res.similarity * 100).toFixed(1);
				console.log(`${i + 1}. [${res.metadata.type}] ${res.metadata.name} (相关度: ${score}%)`);
				if (i === 0) {
					console.log('\n--- 最佳匹配预览 ---');
					console.log(res.content.substring(0, 300) + '...');
					console.log('-------------------\n');
				}
			});
			return;
		}

		const rootSpecFile = path.join(projectRoot, findPath.ROOT_MARKER_NAME);
		let specData = {};
		try {
			specData = JSON.parse(fs.readFileSync(rootSpecFile, 'utf8'));
		} catch (e) {
			specData = { list: [] };
		}

		console.log(`\n🔍 正在搜索: "${keyword || '所有'}"\n`);

		// 1. 搜索 Snippets
		const snippets = (specData.list || []).filter(s => {
			if (!keyword) return true;
			const k = keyword.toLowerCase();
			return (s.title && s.title.toLowerCase().includes(k)) ||
				(s.completion && s.completion.toLowerCase().includes(k)) ||
				(s.summary && s.summary.toLowerCase().includes(k));
		});

		if (snippets.length > 0) {
			console.log(`--- 代码片段 (Snippets) [${snippets.length}] ---`);
			snippets.forEach((s, i) => {
				console.log(`${i + 1}. [${s.languageShort || 'objc'}] ${s.title} (${s.completion})`);
				if (s.summary) console.log(`   摘要: ${s.summary}`);
			});
			console.log('');
		}

		// 2. 搜索 Recipes
		let matchingRecipes = [];
		const recipesDir = path.join(projectRoot, specData.recipes?.dir || specData.skills?.dir || 'Knowledge/recipes');
		if (fs.existsSync(recipesDir)) {
			const recipeFiles = fs.readdirSync(recipesDir).filter(f => f.endsWith('.md'));
			
			for (const file of recipeFiles) {
				const filePath = path.join(recipesDir, file);
				const content = fs.readFileSync(filePath, 'utf8');
				const k = keyword ? keyword.toLowerCase() : '';
				
				if (!keyword || file.toLowerCase().includes(k) || content.toLowerCase().includes(k)) {
					matchingRecipes.push({ name: file, path: filePath, content });
				}
			}

			if (matchingRecipes.length > 0) {
				console.log(`--- 配方 (Recipes) [${matchingRecipes.length}] ---`);
				matchingRecipes.forEach((s, i) => {
					console.log(`${i + 1}. ${s.name}`);
				});
				console.log('');

				if (matchingRecipes.length === 1 || (keyword && matchingRecipes.length < 5)) {
					console.log('--- 预览第一个结果 ---\n');
					console.log(matchingRecipes[0].content);
				}
			}
		}

		if (snippets.length === 0 && (!fs.existsSync(recipesDir) || matchingRecipes.length === 0)) {
			console.log('未找到匹配的内容。');
		}
	});

commander
	.command('embed')
	.description('rebuild semantic vector index for semantic search (Recipes → embed → vector_index.json)')
	.option('--clear', 'clear existing index before indexing', false)
	.action(async (options) => {
		const projectRoot = await findPath.findProjectRoot(CMD_PATH);
		if (!projectRoot) {
			console.error('未找到项目根目录。请先运行 asd root');
			return;
		}

		const VectorStore = require('../lib/ai/vectorStore');
		const AiFactory = require('../lib/ai/AiFactory');
		const store = new VectorStore(projectRoot);
		
		if (options.clear) {
			store.clear();
			console.log('已清理现有索引。');
		}

		const ai = await AiFactory.getProvider(projectRoot);
		if (!ai) {
			console.error('未配置 AI 密钥，请检查 AutoSnippet.boxspec.json 或环境变量。');
			return;
		}

		console.log('正在构建语义索引...');

		// 1. 扫描 Recipes
		const rootSpecPath = path.join(projectRoot, 'AutoSnippetRoot.boxspec.json');
		const recipesDir = fs.existsSync(rootSpecPath)
			? (() => { try { const s = JSON.parse(fs.readFileSync(rootSpecPath, 'utf8')); return path.join(projectRoot, s.recipes?.dir || s.skills?.dir || 'Knowledge/recipes'); } catch (_) { return path.join(projectRoot, 'Knowledge/recipes'); } })()
			: path.join(projectRoot, 'Knowledge/recipes');
		if (fs.existsSync(recipesDir)) {
			const files = fs.readdirSync(recipesDir).filter(f => f.endsWith('.md'));
			console.log(`正在索引 ${files.length} 个 Recipes...`);
			
			for (const file of files) {
				const content = fs.readFileSync(path.join(recipesDir, file), 'utf8');
				// 提取正文内容，去掉 frontmatter
				const body = content.replace(/^---[\s\S]*?---/, '').trim();
				const vector = await ai.embed(body || content);
				store.upsert(`recipe_${file}`, vector, body || content, { name: file, type: 'recipe' });
				process.stdout.write('.');
			}
			console.log('\nRecipes 索引完成。');
		}

		// 2. 扫描 Snippets (可选，后续支持)
		
		store.save();
		console.log('✅ 语义索引构建成功！你可以使用 asd search --semantic 进行搜索。');
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

commander
	.command('install:cursor-skill')
	.description('install AutoSnippet Agent Skills into project .cursor/skills/ (run from project root)')
	.action(() => {
		require(path.join(__dirname, '..', 'scripts', 'install-cursor-skill.js'));
	});

commander.addHelpText('after', `

Examples:
	asd setup								# 初始化 + 标记项目根目录
	asd install:cursor-skill				# 将 skills 安装到项目 .cursor/skills/
	asd install							# 等价于 asd i
	asd create							# 等价于 asd c
	asd share								# 等价于 asd s
	asd watch								# 等价于 asd w

Notes:
	- 老命令仍可用：i/c/s/u/w 只是别名，不会破坏现有脚本。
`);

commander.parse(process.argv);